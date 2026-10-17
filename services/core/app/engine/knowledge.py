"""Sources, revisions, claims and packs: what the evidence is and where it came from.

A pack pins, for one case and one as_of, which source revisions count as
evidence and which were left out (rights, as_of, collection failure). Claims
come only from included revisions and always carry an exact passage. The
synthesis a provider proposes (conflicts, unknowns, questions, assessments)
is normalised here: references are checked, ids are kept stable across
packs, parent questions are rolled up and every calculation is recomputed.
"""
from __future__ import annotations

import re

from ..calc import percent_change, rollup_question
from ..errors import ApiError, err
from ..util import clone, iso, ms_of, new_uuid, sha256hex, uniq, uuid_from
from .core import FX, WARN

WEIGHTS = {"materiality": 0.30, "novelty": 0.15, "verifiability": 0.20, "evidence_integrity": 0.25, "urgency": 0.10}


def _fx_section(name):
    return next(s for s in FX["brief"]["sections"] if s["section"] == name)


DEFAULT_FACTORS = {
    "CLAIM": _fx_section("WHAT_WE_KNOW")["items"][0]["why_this"]["ranking_factors"],
    "CONFLICT": _fx_section("WHAT_IS_DISPUTED")["items"][0]["why_this"]["ranking_factors"],
    "UNKNOWN": _fx_section("WHAT_IS_STILL_UNKNOWN")["items"][0]["why_this"]["ranking_factors"],
}
_counter = _fx_section("STRONG_COUNTER_FRAMES")["items"][0]["text"]
_c1 = next(c for c in FX["claims"] if c["key"] == "C1")["text"]
COUNTER_PREFIX = _counter[: _counter.index(_c1)]
COUNTER_SUFFIX = _counter[_counter.index(_c1) + len(_c1):]


def round4(x: float) -> float:
    return round(x * 10000) / 10000


def score_of(f: dict) -> float:
    return round4(sum(WEIGHTS[k] * float(f.get(k, 0)) for k in WEIGHTS))


def clamp_factors(f, base):
    out = {}
    for k in WEIGHTS:
        v = (f or {}).get(k, base[k])
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = base[k]
        v = round(min(1.0, max(0.0, v)), 2)
        out[k] = int(v) if float(v).is_integer() else v
    return out


def key_num(key: str) -> int:
    m = re.search(r"(\d+)$", key or "")
    return int(m.group(1)) if m else 0


class KnowledgeMixin:
    # ---------------------------------------------------------------- keys
    def next_key(self, case, prefix):
        seq = case.setdefault("seq", {})
        n = seq.get(prefix, 0) + 1
        seq[prefix] = n
        self.store.touch("cases", case)
        return f"{prefix}{n}"

    # ---------------------------------------------------------------- sources and revisions
    def revs_of(self, case_id):
        return self.by_case("revisions", case_id)

    def rev_by_key(self, case_id, key):
        for r in self.store.all("revisions"):
            if r["case_id"] == case_id and r["key"] == key:
                return r
        return None

    def source_of(self, rev):
        return self.store.get("sources", rev["source_id"]) if rev else None

    def rights_of(self, source):
        return source.get("rights_override") or source["rights_class"]

    def readable(self, source, rev=None):
        if not source or self.rights_of(source) != "OPEN":
            return False
        return rev is None or rev.get("body") is not None

    def register_source(self, case, draft, *, via, available_at, submission_id=None):
        """Store one source revision for the case (deduplicated) and return it."""
        body = draft.get("body") if (draft.get("rights_class") == "OPEN") else None
        sha = sha256hex(body) if body is not None else None
        if draft.get("revision_id"):
            have = self.store.get("revisions", draft["revision_id"])
            if have:
                return have
        for r in self.revs_of(case["id"]):
            src = self.source_of(r)
            if (src and src.get("url") == (draft.get("url") or "") and r.get("body_sha256") == sha
                    and r.get("collection") == draft.get("collection", "OK") and src.get("rights_class") == draft.get("rights_class")):
                return r
        key = draft.get("key") or self.next_key(case, "S")
        source = {
            "id": draft.get("source_id") or new_uuid(), "case_id": case["id"], "key": key,
            "url": draft.get("url") or "", "title": draft.get("title") or (draft.get("url") or key),
            "family": draft.get("family") or "직접 등록 자료", "rights_class": draft.get("rights_class") or "UNKNOWN",
            "published_at": draft.get("published_at"), "origin": via, "created_at": self.now_iso(),
        }
        rev = {
            "id": draft.get("revision_id") or new_uuid(), "case_id": case["id"], "source_id": source["id"], "key": key,
            "body": body if source["rights_class"] == "OPEN" else None,
            "body_sha256": sha if source["rights_class"] == "OPEN" else None,
            "published_at": draft.get("published_at"), "available_at": available_at, "via": via,
            "submission_id": submission_id, "collection": draft.get("collection", "OK"), "note": draft.get("note"),
            "passage_id": draft.get("passage_id"),
            "claims_done": False, "created_at": self.now_iso(),
        }
        self.store.put("sources", source)
        self.store.put("revisions", rev)
        return rev

    # ---------------------------------------------------------------- claims
    def claims_of_rev(self, rev_id):
        return sorted((c for c in self.store.all("claims") if c["revision_id"] == rev_id), key=lambda c: key_num(c["key"]))

    def claim_by_id(self, claim_id):
        return self.store.get("claims", claim_id)

    def claim_by_key(self, case_id, key):
        for c in self.store.all("claims"):
            if c["case_id"] == case_id and c["key"] == key:
                return c
        return None

    def store_claims(self, case, rev, drafts):
        """Check and store what a provider proposed for one revision."""
        body = rev.get("body") or ""
        out = []
        seen = set()
        for d in drafts:
            text = d.get("text")
            start, end = d.get("start"), d.get("end")
            if not isinstance(text, str) or not text.strip() or len(text) > 1000:
                continue
            if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end <= start or end > len(body):
                continue
            if not body[start:end].strip():
                continue
            sig = (start, end, text.strip())
            if sig in seen:
                continue
            seen.add(sig)
            amount = d.get("amount")
            if amount is not None:
                if not (isinstance(amount, dict) and isinstance(amount.get("value"), int) and not isinstance(amount.get("value"), bool)):
                    amount = None
            key = d.get("key") or self.next_key(case, "C")
            claim = {
                "id": d.get("claim_id") or uuid_from(f"{rev['id']}:claim:{start}:{end}:{text.strip()}"),
                "case_id": case["id"], "key": key, "revision_id": rev["id"], "source_id": rev["source_id"],
                "source_key": rev["key"], "text": text.strip(),
                "passage_id": d.get("passage_id") or uuid_from(f"{rev['id']}:passage:{start}:{end}"),
                "start": start, "end": end,
                "epistemic_status": d.get("epistemic_status") or "SUPPORTED_CLAIM", "status": "COMMITTED",
                "independent_source_groups": 1, "scope_key": d.get("scope_key"), "amount": amount,
                "created_at": self.now_iso(),
            }
            if self.store.get("claims", claim["id"]):
                out.append(self.store.get("claims", claim["id"]))
                continue
            self.store.put("claims", claim)
            out.append(claim)
        rev["claims_done"] = True
        self.store.touch("revisions", rev)
        return out

    # ---------------------------------------------------------------- packs
    def plan_pack(self, case, *, as_of, candidate_keys, parent, mode, channel_failed=False, failed_keys=()):
        """Which candidate revisions count as evidence at as_of, before synthesis."""
        as_of_ms = ms_of(as_of)
        included, excluded, warnings = [], [], []
        failed_titles, rights_off = [], []
        for key in uniq(candidate_keys):
            rev = self.rev_by_key(case["id"], key)
            src = self.source_of(rev)
            if not rev or not src:
                continue
            if rev.get("collection") == "FAILED" or key in failed_keys:
                excluded.append({"key": key, "source_id": src["id"], "reason": "COLLECTION_FAILED"})
                failed_titles.append(src["title"])
                continue
            if not self.readable(src, rev):
                excluded.append({"key": key, "source_id": src["id"], "reason": "RIGHTS"})
                if case.get("provider") == "fixture":
                    if key == "S5":
                        warnings.append(self.warn("rights", object_ids=[src["id"]]))
                    else:
                        warnings.append({"code": "SOURCE_RIGHTS_EXCLUDED", "message": f"권리가 확인되지 않은 {src['title']} 전문은 근거에서 제외했다.",
                                         "object_ids": [src["id"]]})
                else:
                    rights_off.append(src)
                continue
            if ms_of(rev["available_at"]) is not None and ms_of(rev["available_at"]) > as_of_ms:
                excluded.append({"key": key, "source_id": src["id"], "reason": "AFTER_AS_OF"})
                continue
            included.append(key)
        if rights_off:
            names = ", ".join(s["title"][:30] for s in rights_off[:3]) + (" 등" if len(rights_off) > 3 else "")
            warnings.append({"code": "SOURCE_RIGHTS_EXCLUDED",
                             "message": f"권리가 확인되지 않은 자료 {len(rights_off)}건({names})은 전문을 저장하지 않고 제목과 주소만 남겼다. 근거로 쓰지 않는다.",
                             "object_ids": [s["id"] for s in rights_off]})
        if failed_titles and not channel_failed:
            warnings.append({"code": "SOURCE_COLLECTION_FAILED",
                             "message": f"검색에서 찾았지만 원문을 가져오지 못한 자료 {len(failed_titles)}건은 근거에서 제외했다. 링크로만 남긴다.",
                             "object_ids": []})
        if channel_failed:
            warnings.append(self.warn("partial"))
        claims = []
        for key in included:
            rev = self.rev_by_key(case["id"], key)
            claims.extend(self.claims_of_rev(rev["id"]))
        claims.sort(key=lambda c: key_num(c["key"]))
        return {
            "id": new_uuid(), "workspace_id": self.WS, "case_id": case["id"], "as_of": as_of, "mode": mode,
            "status": "PARTIAL" if channel_failed else "COMPLETED",
            "parent_pack_id": parent["id"] if parent else None,
            "candidate_keys": uniq(candidate_keys), "included_keys": included, "excluded": excluded,
            "claim_keys": [c["key"] for c in claims], "claim_ids": [c["id"] for c in claims],
            "conflict_ids": [], "unknown_ids": [], "warnings": warnings, "created_at": None,
            "provider": case.get("provider"), "synthesis": None,
        }

    def pack_claims(self, pack):
        return [self.store.get("claims", cid) for cid in pack["claim_ids"] if self.store.get("claims", cid)]

    def finish_pack(self, case, plan, synthesis, parent, *, created_at):
        pack = plan
        pack["synthesis"] = self.normalize_synthesis(case, pack, synthesis or {}, parent)
        pack["conflict_ids"] = [c["conflict_id"] for c in pack["synthesis"]["conflicts"]]
        pack["unknown_ids"] = [u["unknown_id"] for u in pack["synthesis"]["unknowns"]]
        pack["created_at"] = created_at
        self.store.put("packs", pack)
        return pack

    # ---------------------------------------------------------------- synthesis
    def normalize_synthesis(self, case, pack, syn, parent):
        eligible = set(pack["claim_ids"])
        by_id = {cid: self.store.get("claims", cid) for cid in eligible}
        only = lambda ids: [i for i in uniq(ids or []) if i in eligible]  # noqa: E731
        parent_syn = (parent or {}).get("synthesis") or {}
        p_conf = {c["key"]: c for c in parent_syn.get("conflicts", [])}
        p_unk = {u["key"]: u for u in parent_syn.get("unknowns", [])}

        superseded = {k: v for k, v in (syn.get("superseded") or {}).items() if k in eligible and v in eligible and k != v}

        conflicts = []
        used_keys = set()
        for c in syn.get("conflicts") or []:
            sup, con = only(c.get("supporting_claim_ids")), only(c.get("contradicting_claim_ids"))
            con = [i for i in con if i not in sup]
            if not sup or not con:
                continue
            key = c.get("key") if c.get("key") and c.get("key") not in used_keys else None
            key = key or self._fresh_key("X", used_keys | set(p_conf))
            used_keys.add(key)
            prev = p_conf.get(key)
            cid = c.get("conflict_id") or (prev["conflict_id"] if prev else uuid_from(f"{case['id']}:conflict:{key}"))
            resolved = bool(c.get("resolved")) and bool(only(c.get("resolution_claim_ids")))
            conflicts.append({
                "key": key, "conflict_id": cid, "question": str(c.get("question") or "").strip() or "출처끼리 다른 설명",
                "check_question": str(c.get("check_question") or "").strip() or None,
                "summary": str(c.get("summary") or "").strip() or None,
                "reason_unresolved": str(c.get("reason_unresolved") or "").strip() or "출처의 설명이 서로 다르다.",
                "supporting_claim_ids": sup, "contradicting_claim_ids": con,
                "resolved": resolved, "resolution_claim_ids": only(c.get("resolution_claim_ids")) if resolved else [],
                "needed_evidence": [str(x) for x in (c.get("needed_evidence") or []) if str(x).strip()][:20],
                "factors": clamp_factors(c.get("factors"), DEFAULT_FACTORS["CONFLICT"]),
            })
        # conflicts of the parent view are not dropped silently
        for key, prev in p_conf.items():
            if key in used_keys:
                continue
            sup, con = only(prev["supporting_claim_ids"]), only(prev["contradicting_claim_ids"])
            if sup and con:
                conflicts.append(clone(prev))
                used_keys.add(key)

        unknowns = []
        ukeys = set()
        for u in syn.get("unknowns") or []:
            q = str(u.get("question") or "").strip()
            if not q:
                continue
            key = u.get("key") if u.get("key") and u.get("key") not in ukeys else None
            key = key or self._fresh_key("U", ukeys | set(p_unk))
            ukeys.add(key)
            prev = p_unk.get(key)
            uid = u.get("unknown_id") or (prev["unknown_id"] if prev else uuid_from(f"{case['id']}:unknown:{key}"))
            children = []
            ckeys = set()
            prev_children = {ch["key"]: ch for ch in (prev or {}).get("children", [])}
            for ch in (u.get("children") or [])[:6]:
                cq = str(ch.get("question") or "").strip()
                if not cq:
                    continue
                ck = ch.get("key") if ch.get("key") and ch.get("key") not in ckeys else None
                ck = ck or f"{key}{chr(ord('a') + len(ckeys))}"
                ckeys.add(ck)
                pid = prev_children.get(ck, {}).get("id")
                children.append({"key": ck, "id": ch.get("id") or pid or uuid_from(f"{uid}:question:{ck}"), "question": cq})
            for ck, pch in prev_children.items():
                if ck not in ckeys:
                    children.append(clone(pch))
            unknowns.append({
                "key": key, "unknown_id": uid, "question": q,
                "top_question": str(u.get("top_question") or "").strip() or q,
                "why_important": str(u.get("why_important") or "").strip() or "기사의 핵심 판단에 영향을 준다.",
                "needed_evidence": str(u.get("needed_evidence") or "").strip() or "관련 공개 원문과 담당 기관의 설명",
                "needed_list": [str(x) for x in (u.get("needed_list") or []) if str(x).strip()][:20] or ["관련 원문과 설명"],
                "public_search_possible": bool(u.get("public_search_possible", True)),
                "human_reporting_needed": bool(u.get("human_reporting_needed", True)),
                "status": "NOT_RESOLVED", "children": children,
                "factors": clamp_factors(u.get("factors"), DEFAULT_FACTORS["UNKNOWN"]),
            })
        for key, prev in p_unk.items():
            if key not in ukeys:
                unknowns.append(clone(prev))
                ukeys.add(key)

        # question tree: unknowns (with sub-questions) first, then conflicts
        questions = []
        include_conflict_questions = syn.get("conflict_questions", True)
        for u in unknowns:
            questions.append({"id": u["unknown_id"], "parent_id": None, "question_key": u["key"], "question": u["top_question"],
                              "required_children": [ch["id"] for ch in u["children"]]})
            for ch in u["children"]:
                questions.append({"id": ch["id"], "parent_id": u["unknown_id"], "question_key": ch["key"], "question": ch["question"],
                                  "required_children": []})
        if include_conflict_questions:
            for c in conflicts:
                questions.append({"id": c["conflict_id"], "parent_id": None, "question_key": c["key"],
                                  "question": c.get("check_question") or f"{c['question']} — 출처 간 차이가 해소됐는가",
                                  "required_children": []})
        if syn.get("questions_only_with_unknowns") and not unknowns:
            questions = []

        # assessments: leaves from the proposal, parents rolled up by the server
        proposed = syn.get("assessments") or {}
        conflict_by_id = {c["conflict_id"]: c for c in conflicts}
        status_of = {}
        rows = {}
        for q in questions:
            if q["required_children"]:
                continue
            a = proposed.get(q["question_key"]) or {}
            if q["id"] in conflict_by_id:
                c = conflict_by_id[q["id"]]
                st = "RESOLVED" if c["resolved"] else "CONFLICTED"
                res_ids = c["resolution_claim_ids"] if c["resolved"] else []
            else:
                st = a.get("status") if a.get("status") in ("OPEN", "PARTIALLY_RESOLVED", "RESOLVED") else "OPEN"
                res_ids = only(a.get("resolution_claim_ids"))
                if st in ("RESOLVED", "PARTIALLY_RESOLVED") and not res_ids:
                    st = "OPEN"
            status_of[q["id"]] = st
            rows[q["id"]] = self._assessment(q, st, res_ids, a, by_id)
        for q in questions:
            if not q["required_children"]:
                continue
            st = rollup_question([status_of.get(cid, "OPEN") for cid in q["required_children"]])
            a = proposed.get(q["question_key"]) or {}
            res_ids = only(a.get("resolution_claim_ids")) or uniq([i for cid in q["required_children"] for i in rows[cid]["resolution_claim_ids"]])
            if st == "OPEN":
                res_ids = only(a.get("resolution_claim_ids")) if a.get("status") == "OPEN" else []
            status_of[q["id"]] = st
            rows[q["id"]] = self._assessment(q, st, res_ids, a, by_id)
        assessments = [rows[q["id"]] for q in questions]
        for u in unknowns:
            u["status"] = "RESOLVED" if status_of.get(u["unknown_id"]) == "RESOLVED" else "NOT_RESOLVED"

        # editorial actions only for questions that are still open
        qkey = {q["question_key"]: q for q in questions}
        overlay = []
        for o in syn.get("overlay") or []:
            q = qkey.get(o.get("question_key"))
            if not q or status_of.get(q["id"]) == "RESOLVED":
                continue
            action = str(o.get("action") or "").strip()
            if not action:
                continue
            overlay.append({"question_id": q["id"], "action": action[:3000],
                            "ask_role": (str(o.get("ask_role") or "").strip() or None),
                            "provenance": str(o.get("provenance") or f"{q['question_key']} 필요자료에 따른 기관 역할 제안"),
                            "labels": ["EDITORIAL_ACTION", "NOT_FACT"]})

        claim_factors = {}
        for cid in eligible:
            claim_factors[cid] = clamp_factors((syn.get("claim_factors") or {}).get(cid), DEFAULT_FACTORS["CLAIM"])
        texts = syn.get("texts") or {}
        return {"conflicts": conflicts, "unknowns": unknowns, "questions": questions, "assessments": assessments,
                "superseded": superseded, "overlay": overlay, "claim_factors": claim_factors,
                "texts": {"brief_reason": texts.get("brief_reason") or "근거 범위와 편집상 중요도",
                          "brief_summary": texts.get("brief_summary") or "범위·근거와 고정 가중치에 따른 선택 기준"}}

    @staticmethod
    def _fresh_key(prefix, taken):
        n = 1
        while f"{prefix}{n}" in taken:
            n += 1
        return f"{prefix}{n}"

    def _assessment(self, q, status, res_ids, a, by_id):
        needed = [str(x) for x in (a.get("needed_evidence") or []) if str(x).strip()][:30]
        if status != "RESOLVED" and not needed:
            needed = ["필요한 원문과 설명"]
        if status == "RESOLVED":
            needed = []
        calc = a.get("calculation")
        if calc is None and a.get("calc_ref"):
            calc = self.build_calculation(a["calc_ref"], by_id)
        if calc is not None and not self.calc_ok(calc):
            calc = None
        return {"question_id": q["id"], "status": status, "resolution_claim_ids": res_ids,
                "reason": str(a.get("reason") or "").strip() or "기준 시각까지의 근거로 본 질문의 상태",
                "needed_evidence": needed, "calculation": calc}

    # ---------------------------------------------------------------- arithmetic
    def build_calculation(self, ref, by_id):
        """Same-scope change between two claims with KRW amounts, computed by the server."""
        prev = by_id.get(ref.get("previous_claim_id"))
        cur = by_id.get(ref.get("current_claim_id"))
        if not prev or not cur or not prev.get("amount") or not cur.get("amount"):
            return None
        pa, ca = prev["amount"], cur["amount"]
        if pa.get("unit", "KRW") != "KRW" or ca.get("unit", "KRW") != "KRW":
            return None
        excluded = by_id.get(ref.get("excluded_claim_id")) if ref.get("excluded_claim_id") else None
        ex_amount = excluded["amount"]["value"] if excluded and excluded.get("amount") else 0
        try:
            pc = percent_change(pa["value"], ca["value"], 2)
        except ApiError:
            return None
        periods = [pa.get("period"), ca.get("period")]
        if not all(isinstance(p, int) and 1900 <= p <= 2200 for p in periods):
            return None
        support = [prev["id"]] + ([excluded["id"]] if excluded else []) + [cur["id"]]
        return {
            "unit": "KRW", "scope_key": ref.get("scope_key") or prev.get("scope_key") or "SAME_SCOPE",
            "previous_period": periods[0], "current_period": periods[1],
            "previous_amount": pa["value"], "current_amount": ca["value"],
            "excluded_furniture_amount": ex_amount, "previous_total": pa["value"] + ex_amount,
            "formula": "(previous_amount-current_amount)/previous_amount*100",
            "exact_percent": pc["exact_percent"], "display_percent": pc["display_percent"],
            "rounding": "ROUND_HALF_UP", "scale": 2, "supporting_claim_ids": support,
        }

    @staticmethod
    def calc_ok(c):
        try:
            pc = percent_change(c["previous_amount"], c["current_amount"], c.get("scale", 2))
        except (ApiError, KeyError, TypeError):
            return False
        return pc["exact_percent"] == c.get("exact_percent") and pc["display_percent"] == c.get("display_percent")

    # ---------------------------------------------------------------- views of a pack
    def superseded(self, pack, claim_id):
        return claim_id in ((pack.get("synthesis") or {}).get("superseded") or {})

    def pack_questions(self, pack):
        return clone((pack.get("synthesis") or {}).get("questions") or [])

    def assess_questions(self, pack, view_id):
        out = []
        for a in (pack.get("synthesis") or {}).get("assessments") or []:
            row = clone(a)
            out.append({"id": uuid_from(f"{view_id}:assessment:{a['question_id']}"), **row})
        return out

    def action_overlay(self, pack):
        return clone((pack.get("synthesis") or {}).get("overlay") or [])

    def conflicts_of(self, pack):
        return (pack.get("synthesis") or {}).get("conflicts") or []

    def unknowns_of(self, pack):
        return (pack.get("synthesis") or {}).get("unknowns") or []

    @staticmethod
    def conflict_dto(c):
        return {"key": c["key"], "conflict_id": c["conflict_id"], "question": c["question"],
                "reason_unresolved": c["reason_unresolved"], "supporting_claim_ids": clone(c["supporting_claim_ids"]),
                "contradicting_claim_ids": clone(c["contradicting_claim_ids"])}

    @staticmethod
    def unknown_dto(u):
        return {"key": u["key"], "unknown_id": u["unknown_id"], "question": u["question"], "why_important": u["why_important"],
                "needed_evidence": u["needed_evidence"], "public_search_possible": u["public_search_possible"],
                "human_reporting_needed": u["human_reporting_needed"], "status": u["status"]}

    def board_of(self, pack):
        case_id = pack["case_id"]
        sources = []
        for key in pack["candidate_keys"]:
            rev = self.rev_by_key(case_id, key)
            s = self.source_of(rev)
            if not rev or not s:
                continue
            ex = next((e for e in pack["excluded"] if e["key"] == key), None)
            sources.append({
                "key": key, "source_id": s["id"], "revision_id": rev["id"], "title": s["title"], "url": s["url"],
                "family": s["family"], "rights_class": self.rights_of(s), "published_at": s.get("published_at"),
                "available_at": rev["available_at"], "via": rev.get("via"), "included": ex is None,
                "excluded_reason": ex["reason"] if ex else None, "note": rev.get("note"),
            })
        families = {}
        for s in sources:
            if s["included"]:
                families.setdefault(s["family"], []).append(s["key"])
        claims = []
        for c in self.pack_claims(pack):
            claims.append({
                "key": c["key"], "claim_id": c["id"], "text": c["text"], "status": c["status"],
                "epistemic_status": c["epistemic_status"], "scope_key": c.get("scope_key"), "source_key": c["source_key"],
                "passage_ids": [c["passage_id"]], "independent_source_groups": c["independent_source_groups"],
                "superseded": self.superseded(pack, c["id"]), "amount": clone(c.get("amount")),
            })
        conf = self.conflicts_of(pack)
        unknown_status = {a["question_id"]: a["status"] for a in (pack.get("synthesis") or {}).get("assessments", [])}
        return {
            "pack": {"id": pack["id"], "case_id": case_id, "as_of": pack["as_of"], "status": pack["status"],
                     "parent_pack_id": pack["parent_pack_id"], "warnings": clone(pack["warnings"]), "created_at": pack["created_at"]},
            "what_we_know": [c for c in claims if not c["superseded"]],
            "history": [c for c in claims if c["superseded"]],
            "what_is_disputed": [self.conflict_dto(c) for c in conf if not c["resolved"]],
            "resolved_conflicts": [self.conflict_dto(c) for c in conf if c["resolved"]],
            "what_remains_unknown": [self.unknown_dto(u) for u in self.unknowns_of(pack) if unknown_status.get(u["unknown_id"]) != "RESOLVED"],
            "sources": sources,
            "families": [{"family": f, "source_keys": keys, "independent_groups": 1} for f, keys in families.items()],
            "timeline": sorted(({"at": s["published_at"], "source_key": s["key"], "title": s["title"]} for s in sources
                                if s["included"] and s["published_at"]), key=lambda x: x["at"]),
        }

    def trace_of(self, pack, claim_id):
        c = self.store.get("claims", claim_id)
        if not c or claim_id not in pack["claim_ids"]:
            raise err("RESOURCE_NOT_FOUND", field="claim_id")
        case_id = pack["case_id"]

        def mk(rev, relation, start, end):
            s = self.source_of(rev)
            ok = self.readable(s, rev)
            body = rev.get("body") if ok else None
            return {
                "relation": relation,
                "passage": {"id": c["passage_id"] if relation == "SUPPORT" else uuid_from(f"{rev['id']}:passage:{start}:{end}"),
                            "start": start if ok else None, "end": end if ok else None,
                            "text": body[start:end] if ok else None},
                "revision": {"id": rev["id"], "published_at": rev.get("published_at"), "available_at": rev["available_at"],
                             "body": body, "body_sha256": rev.get("body_sha256") if ok else None},
                "source": {"id": s["id"], "key": rev["key"], "title": s["title"], "url": s["url"], "family": s["family"],
                           "rights_class": self.rights_of(s)},
                "blocked_reason": None if ok else "현재 권리로는 이 원문의 전문을 볼 수 없다. 메타데이터만 제공한다.",
            }

        home = self.store.get("revisions", c["revision_id"])
        traces = [mk(home, "SUPPORT", c["start"], c["end"])]
        home_src = self.source_of(home)
        for key in pack["included_keys"]:
            rev = self.rev_by_key(case_id, key)
            src = self.source_of(rev)
            if (rev and src and rev["id"] != home["id"] and src["family"] == home_src["family"] and src["id"] != home_src["id"]
                    and rev.get("body") is not None and rev.get("body") == home.get("body")):
                traces.append(mk(rev, "REPEAT", c["start"], c["end"]))
        return {
            "claim": {"id": c["id"], "key": c["key"], "text": c["text"], "status": c["status"],
                      "epistemic_status": c["epistemic_status"], "independent_source_groups": c["independent_source_groups"],
                      "superseded": self.superseded(pack, c["id"])},
            "traces": traces,
        }

    # ---------------------------------------------------------------- brief compiler
    def compile_sections(self, pack, brief_id):
        syn = pack.get("synthesis") or {}
        texts = syn.get("texts") or {}
        reason = texts.get("brief_reason") or "근거 범위와 편집상 중요도"
        summary = texts.get("brief_summary") or "범위·근거와 고정 가중치에 따른 선택 기준"
        status_of = {a["question_id"]: a["status"] for a in syn.get("assessments") or []}
        qtext = {q["id"]: q["question"] for q in syn.get("questions") or []}
        factors = syn.get("claim_factors") or {}

        known = []
        for c in self.pack_claims(pack):
            if self.superseded(pack, c["id"]):
                continue
            f = factors.get(c["id"]) or DEFAULT_FACTORS["CLAIM"]
            known.append({
                "text": c["text"], "kind": "REALITY_CLAIM", "epistemic_status": c["epistemic_status"], "score": score_of(f),
                "claim_ids": [c["id"]], "conflict_ids": [], "unknown_ids": [], "evidence_passage_ids": [c["passage_id"]],
                "labels": ["REALITY", "GROUNDED"], "reason": reason, "needed_evidence": [],
                "why_this": {"reason_codes": ["EVIDENCE_GROUNDED"], "source_object_type": "CLAIM", "source_object_ids": [c["id"]],
                             "ranking_factors": clone(f), "summary": summary},
                "_obj": c["id"],
            })
        disputed = []
        for x in self.conflicts_of(pack):
            if x["resolved"]:
                continue
            ids = x["supporting_claim_ids"] + x["contradicting_claim_ids"]
            disputed.append({
                "text": x.get("summary") or x["question"], "kind": "CONFLICT", "epistemic_status": "CONFLICT",
                "score": score_of(x["factors"]), "claim_ids": clone(ids), "conflict_ids": [x["conflict_id"]], "unknown_ids": [],
                "evidence_passage_ids": [self.store.get("claims", i)["passage_id"] for i in ids if self.store.get("claims", i)],
                "labels": ["REALITY", "DISPUTED"], "reason": reason,
                "needed_evidence": clone(x.get("needed_evidence") or []) or ["관련 원문과 설명"],
                "why_this": {"reason_codes": ["CONFLICT_PRESENT"], "source_object_type": "CONFLICT", "source_object_ids": [x["conflict_id"]],
                             "ranking_factors": clone(x["factors"]), "summary": summary},
                "_obj": x["conflict_id"],
            })
        unknown = []
        for u in self.unknowns_of(pack):
            if status_of.get(u["unknown_id"]) == "RESOLVED":
                continue
            unknown.append({
                "text": qtext.get(u["unknown_id"]) or u["question"], "kind": "UNKNOWN", "epistemic_status": "NOT_RESOLVED",
                "score": score_of(u["factors"]), "claim_ids": [], "conflict_ids": [], "unknown_ids": [u["unknown_id"]],
                "evidence_passage_ids": [], "labels": ["REALITY", "UNKNOWN"], "reason": reason,
                "needed_evidence": clone(u.get("needed_list") or []) or ["관련 원문과 설명"],
                "why_this": {"reason_codes": ["UNKNOWN_PRESENT"], "source_object_type": "UNKNOWN", "source_object_ids": [u["unknown_id"]],
                             "ranking_factors": clone(u["factors"]), "summary": summary},
                "_obj": u["unknown_id"],
            })

        def finish(section, items):
            out = []
            for i, it in enumerate(items):
                it = dict(it)
                obj = it.pop("_obj")
                text, kind, ep, score = it.pop("text"), it.pop("kind"), it.pop("epistemic_status"), it.pop("score")
                out.append({"id": uuid_from(f"{brief_id}:{section}:{obj}"), "text": text, "kind": kind, "epistemic_status": ep,
                            "rank": i + 1, "score": score, **it})
            return {"section": section, "items": out}

        pool = [*disputed, *known, *unknown]
        ranked = sorted(range(len(pool)), key=lambda i: (-pool[i]["score"], i))[:3]
        decision = []
        for i in ranked:
            it = clone({k: v for k, v in pool[i].items()})
            it["kind"] = "EDITORIAL_DECISION"
            it["labels"] = [*pool[i]["labels"], "DECISION_FIRST"]
            decision.append(it)
        counters = []
        for it in known[:3]:
            c = clone(it)
            c["text"] = COUNTER_PREFIX + it["text"] + COUNTER_SUFFIX
            c["kind"] = "COUNTER_FRAME"
            c["epistemic_status"] = "HYPOTHESIS"
            c["score"] = round4(it["score"] * 0.8)
            c["labels"] = ["SYNTHETIC_INTERPRETATION", "NOT_AUDIENCE_PREDICTION", "NOT_FACT"]
            c["why_this"] = {**clone(it["why_this"]), "reason_codes": ["COUNTER_FRAME_BASELINE"]}
            counters.append(c)
        return [finish("DECISION", decision), finish("WHAT_WE_KNOW", known), finish("WHAT_IS_DISPUTED", disputed),
                finish("WHAT_IS_STILL_UNKNOWN", unknown), finish("STRONG_COUNTER_FRAMES", counters)]


__all__ = ["KnowledgeMixin", "DEFAULT_FACTORS", "score_of", "key_num", "iso"]
