"""The real pipeline: OpenAI web search over public-record domains, server-side
collection, and structured model proposals that the server then verifies.

Stages
  discover        web_search limited to the open-licence domains (+ related
                  coverage as links only), then each page is fetched here
  claims_for      quotes proposed by the model are located in the stored text;
                  anything not found verbatim is dropped
  synthesize      conflicts, unknowns, question assessments for one pack
  assertions_for  sentences are split by the server; the model only gives a kind
  assess          verdict proposals; numbers are recomputed by the server
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor

from ..calc import percent_value, rollup_status
from ..errors import err
from ..util import host_of, iso, ms_of, uniq
from . import prompts as P
from .base import Provider, ProviderError
from .fetch import fetch_document, host_allowed, url_allowed
from .korean import PERCENT, amount_in, locate, sentences

log = logging.getLogger("audience_lab.openai")

NON_FACTUAL_ITEM = {
    "status": "NON_FACTUAL", "reason_codes": ["NON_FACTUAL_TEXT"],
    "recommendation": "의견·질문 문장이라 사실 판정을 하지 않는다. 사실처럼 읽히지 않는지만 확인한다.", "needed_evidence": [],
}
DEFAULT_REASON = {"SUPPORTED": "DIRECT_SUPPORT", "CONTRADICTED": "DIRECT_CONTRADICTION", "CONFLICT": "SOURCES_DISAGREE",
                  "INSUFFICIENT_EVIDENCE": "NO_RELEVANT_EVIDENCE"}
FAMILY_NAMES = {"korea.kr": "대한민국 정책브리핑", "kosis.kr": "국가통계포털", "law.go.kr": "국가법령정보센터",
                "data.go.kr": "공공데이터포털", "assembly.go.kr": "국회", "scourt.go.kr": "대법원", "nec.go.kr": "중앙선거관리위원회"}


def _family(host: str, site: str) -> str:
    h = (host or "").lower()
    for d, name in FAMILY_NAMES.items():
        if h == d or h.endswith("." + d):
            return name
    if site and len(site) <= 40:
        return site
    return h[4:] if h.startswith("www.") else h or "공개 자료"


class OpenAIProvider(Provider):
    name = "openai"
    demo = False

    def __init__(self, settings, accounts=None):
        self.s = settings
        self.accounts = accounts
        self._client = None
        self._no_reasoning = set()

    # ---------------------------------------------------------------- plumbing
    def configured(self):
        return self.s.llm_configured

    def client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(api_key=self.s.openai_api_key, timeout=self.s.openai_timeout, max_retries=2)
        return self._client

    def _meter(self, kind):
        if not self.accounts:
            return
        limit = self.s.daily_model_calls if kind == "model_calls" else self.s.daily_search_calls
        n = self.accounts.count_usage(kind)
        if limit and n > limit:
            raise ProviderError("USAGE_LIMIT_REACHED", "오늘 쓸 수 있는 모델 호출량을 모두 썼다. 내일 다시 시도하거나 관리자에게 한도 조정을 요청한다.")

    def _call(self, **kw):
        from openai import (APIConnectionError, APITimeoutError, AuthenticationError, BadRequestError, NotFoundError,
                            PermissionDeniedError, RateLimitError)
        model = kw["model"]
        if model in self._no_reasoning:
            kw.pop("reasoning", None)
        for attempt in range(3):
            try:
                return self.client().responses.create(store=False, **kw)
            except BadRequestError as e:
                msg = str(e)
                if "reasoning" in msg and "reasoning" in kw:
                    self._no_reasoning.add(model)
                    kw.pop("reasoning", None)
                    continue
                raise ProviderError("MODEL_REQUEST_INVALID", f"모델 요청이 거절됐다: {msg[:300]}") from e
            except AuthenticationError as e:
                raise ProviderError("MODEL_AUTH_FAILED", "OpenAI 키가 유효하지 않다. 관리자가 키를 확인해야 한다.") from e
            except PermissionDeniedError as e:
                raise ProviderError("MODEL_ACCESS_DENIED", f"이 키로는 모델이나 도구를 쓸 수 없다: {str(e)[:200]}") from e
            except NotFoundError as e:
                raise ProviderError("MODEL_NOT_FOUND", f"설정한 모델을 찾을 수 없다: {model}") from e
            except RateLimitError as e:
                if "insufficient_quota" in str(e):
                    raise ProviderError("MODEL_QUOTA_EXCEEDED", "OpenAI 사용 한도나 잔액이 부족하다.") from e
                if attempt < 2:
                    time.sleep(4 * (attempt + 1))
                    continue
                raise ProviderError("MODEL_RATE_LIMITED", "모델 호출이 잠시 제한됐다. 조금 뒤 다시 시도한다.") from e
            except (APITimeoutError, APIConnectionError) as e:
                if attempt < 2:
                    time.sleep(2)
                    continue
                raise ProviderError("MODEL_UNAVAILABLE", "모델 서버에 연결하지 못했다.") from e
        raise ProviderError("MODEL_REQUEST_INVALID", "모델 요청을 처리하지 못했다.")

    def structured(self, *, name, schema, system, user, effort=None, max_tokens=12000):
        self._meter("model_calls")
        kw = {"model": self.s.openai_model, "instructions": system,
              "input": json.dumps(user, ensure_ascii=False) if not isinstance(user, str) else user,
              "text": {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": True}},
              "max_output_tokens": max_tokens}
        eff = effort or self.s.openai_reasoning
        if eff and eff != "off":
            kw["reasoning"] = {"effort": eff}
        resp = self._call(**kw)
        text = getattr(resp, "output_text", "") or ""
        try:
            return json.loads(text)
        except ValueError as e:
            raise ProviderError("MODEL_OUTPUT_INVALID", "모델 응답을 읽을 수 없다.") from e

    def web_search(self, prompt, *, domains=None, blocked=None, max_calls=4, context="medium"):
        self._meter("search_calls")
        tool = {"type": "web_search", "search_context_size": context,
                "user_location": {"type": "approximate", "country": "KR", "timezone": "Asia/Seoul"}}
        filters = {}
        if domains:
            filters["allowed_domains"] = list(domains)[:100]
        if blocked:
            filters["blocked_domains"] = list(blocked)[:100]
        if filters:
            tool["filters"] = filters
        resp = self._call(model=self.s.openai_search_model, input=prompt, tools=[tool], tool_choice="required",
                          include=["web_search_call.action.sources"], max_tool_calls=max(1, max_calls),
                          reasoning={"effort": "low"}, max_output_tokens=4000)
        data = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
        queries, found, calls = [], [], 0
        for item in data.get("output") or []:
            if item.get("type") == "web_search_call":
                calls += 1
                act = item.get("action") or {}
                for q in [act.get("query"), *(act.get("queries") or [])]:
                    if q and q not in queries:
                        queries.append(q)
                for src in act.get("sources") or []:
                    if src.get("url"):
                        found.append({"url": src["url"], "title": src.get("title") or ""})
            elif item.get("type") == "message":
                for part in item.get("content") or []:
                    for ann in part.get("annotations") or []:
                        if ann.get("type") == "url_citation" and ann.get("url"):
                            found.append({"url": ann["url"], "title": ann.get("title") or "", "cited": True})
        seen, results = set(), []
        for f in sorted(found, key=lambda x: not x.get("cited")):
            u = f["url"].split("#")[0]
            for tail in ("?utm_source=openai", "&utm_source=openai"):
                u = u.replace(tail, "")
            if u in seen:
                continue
            seen.add(u)
            results.append({**f, "url": u})
        return {"queries": queries, "results": results, "calls": calls}

    # ---------------------------------------------------------------- prechecks
    def _ready(self, actor):
        if actor and actor.get("demo_only"):
            raise err("DEMO_ACCOUNT_LIMITED")
        if not self.configured():
            raise err("CONFIGURATION_BLOCKED", reason="OpenAI API 키가 설정되지 않아 실제 검색과 판정을 실행할 수 없다. "
                                                      "관리자가 서버 환경변수 OPENAI_API_KEY를 넣어야 한다.")
        if self.accounts:
            used = self.accounts.usage_today()
            if self.s.daily_model_calls and used.get("model_calls", 0) >= self.s.daily_model_calls:
                raise err("USAGE_LIMIT_REACHED")

    def precheck_execution(self, eng, case, **kw):
        self._ready(kw.get("actor"))

    def precheck_review(self, eng, case, **kw):
        self._ready(kw.get("actor"))

    def precheck_reassessment(self, eng, case, **kw):
        self._ready(kw.get("actor"))

    def precheck_search(self, eng, case, **kw):
        self._ready(kw.get("actor"))

    # ---------------------------------------------------------------- collection
    def _collect(self, results, as_of_ms, budget, skip_urls=()):
        """Fetch allowed pages in parallel; return SourceDrafts (failures included)."""
        domains = self.s.open_domains
        urls = [r for r in results if url_allowed(r["url"], domains) and r["url"] not in skip_urls][:budget]
        deferred = max(0, len([r for r in results if url_allowed(r["url"], domains)]) - budget)
        with ThreadPoolExecutor(max_workers=4) as pool:
            pages = list(pool.map(lambda r: (r, fetch_document(r["url"], domains)), urls))
        drafts = []
        as_of = iso(as_of_ms)
        for r, page in pages:
            host = host_of(page["final_url"] or r["url"])
            title = (page["title"] or r.get("title") or r["url"])[:300]
            published = page["published_at"]
            if page["ok"]:
                available = published if published and ms_of(published) > as_of_ms else as_of
                drafts.append({"url": r["url"], "title": title, "family": _family(host, page["site"]), "rights_class": "OPEN",
                               "published_at": published, "available_at": available, "body": page["text"], "collection": "OK",
                               "note": "국가·지방자치단체 공개 자료(저작권법 제24조의2)로 보고 전문을 보관했다."})
            else:
                drafts.append({"url": r["url"], "title": title, "family": _family(host, ""), "rights_class": "OPEN",
                               "published_at": None, "available_at": as_of, "body": None, "collection": "FAILED",
                               "note": f"원문을 가져오지 못했다({page['error']})."})
        return drafts, deferred

    def _related(self, title, question, as_of_ms):
        """Coverage elsewhere, kept as links only (rights unknown: no body is stored)."""
        if not self.s.related_search:
            return [], None
        try:
            out = self.web_search(P.related_prompt(title, question), blocked=self.s.open_domains, max_calls=2, context="low")
        except ProviderError as e:
            if e.code in ("MODEL_AUTH_FAILED", "MODEL_QUOTA_EXCEEDED", "USAGE_LIMIT_REACHED"):
                raise
            return [], e
        drafts = []
        for r in out["results"]:
            if host_allowed(host_of(r["url"]), self.s.open_domains) or not r["url"].startswith("https://"):
                continue
            drafts.append({"url": r["url"], "title": (r.get("title") or r["url"])[:300], "family": _family(host_of(r["url"]), ""),
                           "rights_class": "UNKNOWN", "published_at": None, "available_at": iso(as_of_ms), "body": None,
                           "collection": "OK", "note": "권리가 확인되지 않아 제목과 주소만 남겼다."})
            if len(drafts) >= 5:
                break
        return drafts, None

    def discover(self, eng, case, *, state, content, as_of_ms, parameters):
        question = state["state"]["primary_editorial_question"]
        draft_lines = [s["text"] for s in sentences(content["body"])] if content else []
        prompt = P.discover_prompt(case["title"], question, draft_lines, iso(as_of_ms), self.s.open_domains)
        warnings, channel_failed = [], False
        try:
            res = self.web_search(prompt, domains=self.s.open_domains, max_calls=min(parameters["query_budget"], 6))
            drafts, deferred = self._collect(res["results"], as_of_ms, parameters["source_budget"])
        except ProviderError as e:
            if e.code in ("MODEL_AUTH_FAILED", "MODEL_QUOTA_EXCEEDED", "USAGE_LIMIT_REACHED", "MODEL_NOT_FOUND", "MODEL_ACCESS_DENIED"):
                raise
            log.warning("public records search failed: %s", e.message)
            res, drafts, deferred, channel_failed = {"queries": [], "results": [], "calls": 0}, [], 0, True
        related, rel_err = self._related(case["title"], question, as_of_ms)
        if channel_failed and rel_err is not None:
            return {"all_failed": True, "error_code": "ALL_SEARCH_CHANNELS_FAILED", "warnings": [], "sources": []}
        if not drafts and not channel_failed:
            warnings.append({"code": "NO_PUBLIC_RECORD_FOUND", "message": "공개 기록 검색에서 근거로 쓸 원문을 찾지 못했다. 직접 확보한 원문을 등록해 다시 검토할 수 있다.",
                             "object_ids": []})
        if deferred:
            warnings.append({"code": "SOURCE_BUDGET_DEFERRED", "message": f"자료 예산을 넘어 {deferred}건은 가져오지 않았다.", "object_ids": []})
        return {"sources": drafts + related, "channel_failed": channel_failed, "warnings": warnings, "query_used": res["calls"]}

    # ---------------------------------------------------------------- claims
    def claims_for(self, eng, case, revision, source):
        body = revision.get("body") or ""
        if not body.strip():
            return []
        state = eng.store.get("states", (eng.store.get("heads", case["id"]) or {}).get("state_version_id"))
        question = state["state"]["primary_editorial_question"] if state else case["title"]
        content_id = (eng.store.get("heads", case["id"]) or {}).get("content_version_id")
        content = eng.store.get("contents", content_id) if content_id else None
        draft = [s["text"] for s in sentences(content["body"])][:30] if content else []
        chunks = [body[i:i + 14000] for i in range(0, min(len(body), 42000), 13500)] or [body]
        out = []
        for chunk in chunks:
            res = self.structured(name="claims", schema=P.CLAIMS_SCHEMA, system=P.CLAIMS_SYSTEM, user={
                "기획 제목": case["title"], "기획 질문": question, "초안 문장": draft,
                "원문": {"제목": source["title"], "주소": source["url"], "발행": source.get("published_at"), "본문": chunk}})
            for c in res.get("claims") or []:
                span = locate(body, c.get("quote") or "")
                if not span:
                    continue
                amount = c.get("amount")
                if amount:
                    passage = body[span[0]:span[1]]
                    if amount.get("unit") != "KRW" or not amount_in(passage, amount.get("value")):
                        amount = None
                    else:
                        amount = {"value": amount["value"], "unit": "KRW", "period": amount.get("period")}
                out.append({"text": (c.get("statement") or "").strip()[:1000], "start": span[0], "end": span[1],
                            "scope_key": (c.get("scope") or None), "amount": amount})
            if len(out) >= 8:
                break
        return out[:10]

    # ---------------------------------------------------------------- synthesis
    def synthesize(self, eng, case, *, pack, claims, parent, state, content):
        question = state["state"]["primary_editorial_question"]
        by_key = {c["key"]: c for c in claims}
        id_of = lambda keys: [by_key[k]["id"] for k in (keys or []) if k in by_key]  # noqa: E731
        psyn = (parent or {}).get("synthesis") or {}
        if not claims:
            ref = next(iter(psyn.get("unknowns") or []), None)
            return {"unknowns": [{
                "key": ref["key"] if ref else "U1", "question": question, "top_question": question,
                "why_important": "기획 질문에 답할 공개 근거가 아직 없다.",
                "needed_evidence": "질문과 직접 관련된 공개 원문(보도자료, 통계, 계약·예산 자료, 회의록)",
                "needed_list": ["질문과 직접 관련된 공개 원문"], "public_search_possible": True, "human_reporting_needed": True, "children": []}],
                "overlay": [{"question_key": ref["key"] if ref else "U1", "action": "담당 기관에 관련 자료의 공개 여부와 위치를 확인한다.",
                             "ask_role": "담당 기관의 자료 공개 창구"}]}
        src_title = {}
        for key in pack["included_keys"]:
            rev = eng.rev_by_key(case["id"], key)
            s = eng.source_of(rev)
            if s:
                src_title[key] = (s["title"], s["family"], s.get("published_at"))
        user = {
            "기획 제목": case["title"], "기획 질문": question,
            "초안 문장": [s["text"] for s in sentences(content["body"])][:40] if content else [],
            "근거 진술": [{"key": c["key"], "진술": c["text"], "원문 구간": (eng.store.get("revisions", c["revision_id"])["body"] or "")[c["start"]:c["end"]],
                        "출처": src_title.get(c["source_key"], ("", "", None))[0], "출처 계열": src_title.get(c["source_key"], ("", "", None))[1],
                        "발행": src_title.get(c["source_key"], ("", "", None))[2],
                        "금액": c["amount"]} for c in claims],
            "이전 상충": [{"key": x["key"], "question": x["question"], "side_a": [eng.store.get("claims", i)["key"] for i in x["supporting_claim_ids"] if eng.store.get("claims", i)],
                       "side_b": [eng.store.get("claims", i)["key"] for i in x["contradicting_claim_ids"] if eng.store.get("claims", i)],
                       "resolved": x["resolved"]} for x in psyn.get("conflicts") or []],
            "이전 공백": [{"key": u["key"], "question": u["question"], "sub_questions": [{"key": ch["key"], "question": ch["question"]} for ch in u["children"]]}
                       for u in psyn.get("unknowns") or []],
        }
        res = self.structured(name="synthesis", schema=P.SYNTH_SCHEMA, system=P.SYNTH_SYSTEM, user=user, effort="medium", max_tokens=16000)
        conflicts = [{"key": x["key"], "question": x["question"], "check_question": x["check_question"], "summary": x["summary"],
                      "reason_unresolved": x["reason_unresolved"], "supporting_claim_ids": id_of(x["side_a"]),
                      "contradicting_claim_ids": id_of(x["side_b"]), "resolved": x["resolved"], "resolution_claim_ids": id_of(x["resolution"]),
                      "needed_evidence": x["needed_evidence"], "factors": x["factors"]} for x in res.get("conflicts") or []]
        unknowns = [{"key": u["key"], "question": u["question"], "top_question": u["top_question"], "why_important": u["why_important"],
                     "needed_evidence": u["needed_evidence"], "needed_list": u["needed_list"], "public_search_possible": u["public_search_possible"],
                     "human_reporting_needed": u["human_reporting_needed"],
                     "children": [{"key": ch["key"], "question": ch["question"]} for ch in u["sub_questions"]], "factors": u["factors"]}
                    for u in res.get("unknowns") or []]
        assessments = {}
        for a in res.get("assessments") or []:
            calc = a.get("calculation")
            ref = None
            if calc and calc.get("previous") in by_key and calc.get("current") in by_key:
                ref = {"previous_claim_id": by_key[calc["previous"]]["id"], "current_claim_id": by_key[calc["current"]]["id"],
                       "excluded_claim_id": by_key[calc["excluded"]]["id"] if calc.get("excluded") in by_key else None,
                       "scope_key": by_key[calc["previous"]].get("scope_key")}
            assessments[a["question"]] = {"status": a["status"], "resolution_claim_ids": id_of(a["resolution"]), "reason": a["reason"],
                                          "needed_evidence": a["needed_evidence"], "calc_ref": ref}
        superseded = {by_key[x["claim"]]["id"]: by_key[x["by"]]["id"] for x in res.get("superseded") or []
                      if x["claim"] in by_key and x["by"] in by_key}
        return {"conflicts": conflicts, "unknowns": unknowns, "assessments": assessments, "superseded": superseded,
                "overlay": [{"question_key": o["question"], "action": o["action"], "ask_role": o["ask_role"]} for o in res.get("actions") or []],
                "claim_factors": {by_key[f["claim"]]["id"]: f for f in res.get("claim_factors") or [] if f["claim"] in by_key},
                "texts": {"brief_reason": "기준 시각까지의 공개 근거와 편집상 중요도",
                          "brief_summary": "근거의 직접성·범위와 고정 가중치에 따른 정렬 기준"}}

    # ---------------------------------------------------------------- review: sentences
    def assertions_for(self, eng, case, content):
        segs = sentences(content["body"])[:400]
        if not segs:
            return []
        kinds = {}
        for i in range(0, len(segs), 80):
            batch = segs[i:i + 80]
            res = self.structured(name="kinds", schema=P.KINDS_SCHEMA, system=P.KINDS_SYSTEM, effort="low",
                                  user={"문장": [{"id": f"A{i + j + 1}", "text": s["text"]} for j, s in enumerate(batch)]})
            for it in res.get("items") or []:
                kinds[it["id"]] = it["kind"]
        out = []
        for n, s in enumerate(segs, 1):
            k = kinds.get(f"A{n}")
            if k not in ("FACTUAL", "CAUSAL", "NON_FACTUAL"):
                k = "FACTUAL"
            out.append({"text": s["text"], "start": s["start"], "end": s["end"], "kind": k})
        return out

    # ---------------------------------------------------------------- review: verdicts
    def assess(self, eng, case, *, pack, rows, claims, state):
        by_key = {c["key"]: c for c in claims}
        superseded = set(((pack.get("synthesis") or {}).get("superseded") or {}).keys())
        syn = pack.get("synthesis") or {}
        conf_key = {c["key"]: c["conflict_id"] for c in syn.get("conflicts") or []}
        unk_key = {u["key"]: u["unknown_id"] for u in syn.get("unknowns") or []}
        for u in syn.get("unknowns") or []:
            for ch in u.get("children") or []:
                unk_key.setdefault(ch["key"], u["unknown_id"])
        context = {
            "기획 질문": state["state"]["primary_editorial_question"],
            "근거 진술": [{"key": c["key"], "진술": c["text"], "원문 구간": (eng.store.get("revisions", c["revision_id"])["body"] or "")[c["start"]:c["end"]],
                        "금액": c["amount"], "정정 이전 기록": c["id"] in superseded} for c in claims],
            "상충": [{"key": c["key"], "question": c["question"], "resolved": c["resolved"]} for c in syn.get("conflicts") or []],
            "공백": [{"key": u["key"], "question": u["question"], "sub": [ch["key"] for ch in u.get("children") or []]} for u in syn.get("unknowns") or []],
        }
        todo = [r for r in rows if r["kind"] != "NON_FACTUAL"]
        proposals = {}
        if todo and claims:
            for i in range(0, len(todo), 12):
                batch = todo[i:i + 12]
                proposals.update(self._assess_batch(context, batch))
        items = []
        for r in rows:
            if r["kind"] == "NON_FACTUAL":
                items.append(self._item(r, NON_FACTUAL_ITEM, [], [], [], [], [], []))
                continue
            p = proposals.get(r["assertion_id"])
            if not p:
                items.append(self._insufficient(r, "관련 공개 원문" if not claims else "이 문장을 확인할 같은 범위의 공개 원문"))
                continue
            items.append(self._from_proposal(eng, r, p, by_key, superseded, conf_key, unk_key))
        return items

    def _assess_batch(self, context, batch):
        ids = {f"A{n + 1}": r for n, r in enumerate(batch)}
        user = {**context, "판정할 문장": [{"id": k, "text": r["text"], "kind": r["kind"]} for k, r in ids.items()]}
        res = self.structured(name="verdicts", schema=P.assess_schema(), system=P.ASSESS_SYSTEM, user=user, effort="medium", max_tokens=16000)
        out = {}
        for it in res.get("items") or []:
            r = ids.get(it["id"])
            if r:
                out[r["assertion_id"]] = it
        return out

    @staticmethod
    def _item(r, base, claim_ids, sup, con, conflicts, unknowns, subchecks):
        return {"assertion_id": r["assertion_id"], "status": base["status"], "claim_ids": claim_ids, "conflict_ids": conflicts,
                "unknown_ids": unknowns, "reason_codes": base["reason_codes"], "recommendation": base["recommendation"],
                "needed_evidence": base["needed_evidence"], "supporting_claim_ids": sup, "contradicting_claim_ids": con,
                "assertion_key": r["assertion_key"], "text": r["text"], "start": r["start"], "end": r["end"], "kind": r["kind"],
                "subchecks": subchecks}

    def _insufficient(self, r, need):
        subs = []
        if r["kind"] == "CAUSAL":
            subs = [{"kind": "CAUSAL", "status": "INSUFFICIENT_EVIDENCE", "supporting_claim_ids": [], "contradicting_claim_ids": [],
                     "expected_percent": None, "observed_percent": None, "calculation": None, "needed_evidence": ["인과를 보여주는 근거"]}]
        return self._item(r, {"status": "INSUFFICIENT_EVIDENCE", "reason_codes": ["NO_RELEVANT_EVIDENCE"],
                              "recommendation": "기준 시각까지 확인된 근거가 없어 이 문장의 단정을 보류하고 원문을 확보한다.",
                              "needed_evidence": [need]}, [], [], [], [], [], subs)

    def _from_proposal(self, eng, r, p, by_key, superseded, conf_key, unk_key):
        ids = lambda keys: uniq([by_key[k]["id"] for k in (keys or []) if k in by_key])  # noqa: E731
        sup = [i for i in ids(p.get("supporting")) if i not in superseded]
        con = [i for i in ids(p.get("contradicting")) if i not in sup]
        related = ids(p.get("related"))
        subchecks = []
        num = p.get("numeric")
        expected = None
        if num and num.get("expected_percent") and percent_value(num["expected_percent"]) is not None:
            expected = str(num["expected_percent"]).strip().rstrip("%").strip()
        if expected is not None:
            calc = None
            if num.get("previous") in by_key and num.get("current") in by_key:
                calc = eng.build_calculation({"previous_claim_id": by_key[num["previous"]]["id"], "current_claim_id": by_key[num["current"]]["id"],
                                              "excluded_claim_id": by_key[num["excluded"]]["id"] if num.get("excluded") in by_key else None,
                                              "scope_key": by_key[num["previous"]].get("scope_key")},
                                             {c["id"]: c for c in by_key.values()})
            if calc:
                observed = calc["exact_percent"]
                ok = abs(percent_value(expected) - percent_value(observed)) <= 0.5
                cids = calc["supporting_claim_ids"]
                subchecks.append({"kind": "NUMERIC", "status": "SUPPORTED" if ok else "CONTRADICTED",
                                  "supporting_claim_ids": cids if ok else [], "contradicting_claim_ids": [] if ok else cids,
                                  "expected_percent": expected, "observed_percent": observed, "calculation": calc, "needed_evidence": []})
            else:
                # no amounts to compute from: a source that states the same rate is direct support
                magnitude = expected.lstrip("-")
                stating = [i for i in sup if self._states_rate(eng, i, magnitude)]
                if stating:
                    subchecks.append({"kind": "NUMERIC", "status": "SUPPORTED", "supporting_claim_ids": stating, "contradicting_claim_ids": [],
                                      "expected_percent": expected, "observed_percent": expected, "calculation": None, "needed_evidence": []})
                else:
                    subchecks.append({"kind": "NUMERIC", "status": "INSUFFICIENT_EVIDENCE", "supporting_claim_ids": [], "contradicting_claim_ids": [],
                                      "expected_percent": expected, "observed_percent": None, "calculation": None,
                                      "needed_evidence": ["같은 범위의 이전·현재 수치"]})
        cz = p.get("causal")
        if r["kind"] == "CAUSAL":
            if cz:
                csup = [i for i in ids(cz.get("supporting")) if i not in superseded]
                ccon = [i for i in ids(cz.get("contradicting")) if i not in csup]
                st = cz.get("status")
                if st == "SUPPORTED" and (not csup or ccon):
                    st = "INSUFFICIENT_EVIDENCE"
                if st == "CONTRADICTED" and (not ccon or csup):
                    st = "CONFLICT" if (ccon and csup) else "INSUFFICIENT_EVIDENCE"
                if st == "CONFLICT" and (not ccon or not csup):
                    st = "INSUFFICIENT_EVIDENCE"
                need = cz.get("needed_evidence") or (["인과를 보여주는 근거"] if st == "INSUFFICIENT_EVIDENCE" else [])
                subchecks.append({"kind": "CAUSAL", "status": st, "supporting_claim_ids": csup if st in ("SUPPORTED", "CONFLICT") else [],
                                  "contradicting_claim_ids": ccon if st in ("CONTRADICTED", "CONFLICT") else [],
                                  "expected_percent": None, "observed_percent": None, "calculation": None, "needed_evidence": need})
            else:
                subchecks.append({"kind": "CAUSAL", "status": "INSUFFICIENT_EVIDENCE", "supporting_claim_ids": [], "contradicting_claim_ids": [],
                                  "expected_percent": None, "observed_percent": None, "calculation": None, "needed_evidence": ["인과를 보여주는 근거"]})
        if subchecks:
            status = rollup_status([s["status"] for s in subchecks])
            sub_sup = uniq([i for s in subchecks for i in s["supporting_claim_ids"]])
            sub_con = uniq([i for s in subchecks for i in s["contradicting_claim_ids"]])
            if status == "SUPPORTED":
                sup, con = uniq(sup + sub_sup), []
            elif status == "CONTRADICTED":
                sup, con = [], uniq(con + sub_con)
            elif status == "CONFLICT":
                sup, con = uniq(sup + sub_sup), uniq(con + sub_con)
                con = [i for i in con if i not in sup]
            else:
                sup, con = [], []
        else:
            status = p.get("status")
            if status == "SUPPORTED" and (not sup or con):
                status = "CONFLICT" if (sup and con) else "INSUFFICIENT_EVIDENCE"
            if status == "CONTRADICTED" and (not con or sup):
                status = "CONFLICT" if (sup and con) else "INSUFFICIENT_EVIDENCE"
            if status == "CONFLICT" and (not sup or not con):
                status = "INSUFFICIENT_EVIDENCE"
            if status == "INSUFFICIENT_EVIDENCE":
                sup, con = [], []
        claim_ids = uniq(sup + con + related + [i for s in subchecks for i in (s["supporting_claim_ids"] + s["contradicting_claim_ids"])]
                         + [i for s in subchecks if s.get("calculation") for i in s["calculation"]["supporting_claim_ids"]])
        reasons = [c for c in (p.get("reason_codes") or []) if c in P.REASON_CODES][:3] or [DEFAULT_REASON[status]]
        need = [str(x) for x in (p.get("needed_evidence") or []) if str(x).strip()][:20]
        if status == "INSUFFICIENT_EVIDENCE" and not need:
            need = ["이 문장을 확인할 같은 범위의 공개 원문"]
        rec = (p.get("recommendation") or "").strip() or "근거 범위를 밝히고 확인되지 않은 부분은 보류한다."
        return self._item(r, {"status": status, "reason_codes": reasons, "recommendation": rec[:2000], "needed_evidence": need},
                          claim_ids, sup, con, uniq([conf_key[k] for k in p.get("conflicts") or [] if k in conf_key]),
                          uniq([unk_key[k] for k in p.get("unknowns") or [] if k in unk_key]), subchecks)

    @staticmethod
    def _states_rate(eng, claim_id, magnitude):
        c = eng.store.get("claims", claim_id)
        rev = eng.store.get("revisions", c["revision_id"]) if c else None
        if not rev or not rev.get("body"):
            return False
        passage = rev["body"][c["start"]:c["end"]]
        return any(abs(float(m.group(1)) - float(magnitude)) < 1e-9 for m in PERCENT.finditer(passage)) if magnitude.replace(".", "", 1).isdigit() else False

    # ---------------------------------------------------------------- research search
    def search_question(self, eng, case, *, pack, question_text, question, as_of_ms, parameters):
        claims = eng.pack_claims(pack)
        state = eng.store.get("states", (eng.store.get("heads", case["id"]) or {}).get("state_version_id"))
        cq = state["state"]["primary_editorial_question"] if state else case["title"]
        prompt = P.question_prompt(case["title"], cq, question_text, [c["text"] for c in claims], self.s.open_domains)
        known_urls = {(eng.source_of(eng.store.get("revisions", c["revision_id"])) or {}).get("url") for c in claims}
        known_urls |= {s.get("source_url") for s in eng.by_case("submissions", case["id"])}
        coverage = {"planned_channels": ["PUBLIC_RECORDS"], "completed_channels": [], "failed_channels": [], "deferred_source_count": 0}
        try:
            res = self.web_search(prompt, domains=self.s.open_domains, max_calls=min(parameters["query_budget"], 6))
        except ProviderError as e:
            if e.code in ("MODEL_AUTH_FAILED", "MODEL_QUOTA_EXCEEDED", "USAGE_LIMIT_REACHED"):
                raise
            coverage["failed_channels"] = ["PUBLIC_RECORDS"]
            return {"status": "FAILED", "error_code": "ALL_SEARCH_CHANNELS_FAILED", "coverage": coverage, "query_used": 0,
                    "sources": [], "plan": [], "warnings": [{"code": "SEARCH_CHANNEL_FAILED", "message": "공개 자료 채널 호출이 실패했다.", "object_ids": []}]}
        coverage["completed_channels"] = ["PUBLIC_RECORDS"]
        drafts, deferred = self._collect(res["results"], as_of_ms, parameters["source_budget"], skip_urls=known_urls)
        coverage["deferred_source_count"] = deferred
        usable = [d for d in drafts if d["collection"] == "OK" and (ms_of(d.get("published_at")) or 0) <= as_of_ms]
        failed = [d for d in drafts if d["collection"] != "OK"]
        warnings = []
        if failed:
            warnings.append({"code": "SOURCE_COLLECTION_FAILED", "message": f"찾았지만 원문을 가져오지 못한 자료 {len(failed)}건은 등록하지 않았다.",
                             "object_ids": []})
        plan = [{"purpose": "UNKNOWN_DRIVEN", "query": q} for q in res["queries"][:10]] or [{"purpose": "UNKNOWN_DRIVEN", "query": question_text}]
        return {"status": "COMPLETED", "error_code": None, "coverage": coverage, "query_used": res["calls"], "sources": usable,
                "plan": plan, "warnings": warnings}

    # ---------------------------------------------------------------- diagnosis
    def self_test(self, search=False):
        out = {"configured": self.configured(), "model": self.s.openai_model, "search_model": self.s.openai_search_model}
        if not self.configured():
            return {**out, "ok": False, "error": "OPENAI_API_KEY가 설정되지 않았다."}
        t = time.time()
        try:
            r = self.structured(name="ping", schema={"type": "object", "additionalProperties": False, "properties": {"ok": {"type": "boolean"}},
                                                     "required": ["ok"]}, system="JSON으로만 답한다.", user="ok를 true로 답하라.", effort="low", max_tokens=200)
            out.update(ok=bool(r.get("ok")), latency_ms=int((time.time() - t) * 1000))
        except ProviderError as e:
            return {**out, "ok": False, "error": f"{e.code}: {e.message}"}
        except Exception as e:  # noqa: BLE001 — a diagnosis endpoint reports, it does not fail
            log.exception("self test: model call")
            return {**out, "ok": False, "error": f"{type(e).__name__}: {str(e)[:300]}"}
        if search:
            t = time.time()
            try:
                s = self.web_search("대한민국 정책브리핑 최신 보도자료 하나의 제목과 주소", domains=["korea.kr"], max_calls=1, context="low")
                out["search"] = {"ok": True, "results": len(s["results"]), "latency_ms": int((time.time() - t) * 1000),
                                 "sample": s["results"][:2]}
            except ProviderError as e:
                out["search"] = {"ok": False, "error": f"{e.code}: {e.message}"}
                return out
            except Exception as e:  # noqa: BLE001
                log.exception("self test: search")
                out["search"] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:300]}"}
                return out
            # can this server reach and read a public-record page itself?
            first = next((r["url"] for r in s["results"] if url_allowed(r["url"], self.s.open_domains)), None)
            if first:
                t = time.time()
                page = fetch_document(first, self.s.open_domains)
                out["fetch"] = {"ok": page["ok"], "url": page.get("final_url") or first, "chars": len(page.get("text") or ""),
                                "error": page.get("error"), "latency_ms": int((time.time() - t) * 1000)}
            else:
                out["fetch"] = {"ok": False, "error": "검색 결과에 허용 도메인 주소가 없어 원문 받기를 확인하지 못했다."}
        return out
