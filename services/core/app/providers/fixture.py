"""The fictional 청람시 demo: a provider that answers only for the pack's fixture.

It reproduces the specification's expected outputs exactly (sources S1-S8,
claims C1-C8, conflict X1, unknown U1 and its sub-questions, verdicts for
A1-A3) so the whole flow can be tried without a model key. Anything outside
the fixture is refused with CONFIGURATION_BLOCKED instead of being invented.
Fixture ids are namespaced per case so several demo cases can coexist.
"""
from __future__ import annotations

from ..engine.core import FX
from ..errors import err
from ..util import clone, ms_of, sha256hex, uniq, uuid_from
from .base import Provider, ProviderError

SRC = {s["key"]: s for s in FX["sources"]}
CLAIM = {c["key"]: c for c in FX["claims"]}
CLAIM_ORDER = [c["key"] for c in FX["claims"]]
QK = {q["question_key"]: q for q in FX["questions"]}
X1, U1 = FX["conflict"], FX["unknown"]
BASE = ["C1", "C2", "C3", "C4"]


def sig(keys):
    return ",".join(k for k in CLAIM_ORDER if k in keys)


RECOGNIZED = {"", sig(BASE), sig([*BASE, "C5", "C6", "C7"]), sig([*BASE, "C8"]), sig([*BASE, "C5", "C6", "C7", "C8"])}


def _sec(name):
    return next(s for s in FX["brief"]["sections"] if s["section"] == name)


BRIEF_REASON = _sec("WHAT_WE_KNOW")["items"][0]["reason"]
BRIEF_SUMMARY = _sec("WHAT_WE_KNOW")["items"][0]["why_this"]["summary"]
CONFLICT_TEXT = _sec("WHAT_IS_DISPUTED")["items"][0]["text"]
CONFLICT_NEEDED = _sec("WHAT_IS_DISPUTED")["items"][0]["needed_evidence"]
UNKNOWN_NEEDED = _sec("WHAT_IS_STILL_UNKNOWN")["items"][0]["needed_evidence"]
FACTORS = {
    "CLAIM": _sec("WHAT_WE_KNOW")["items"][0]["why_this"]["ranking_factors"],
    "CONFLICT": _sec("WHAT_IS_DISPUTED")["items"][0]["why_this"]["ranking_factors"],
    "UNKNOWN": _sec("WHAT_IS_STILL_UNKNOWN")["items"][0]["why_this"]["ranking_factors"],
}


def _fixture_ids():
    ids = set()
    for s in FX["sources"]:
        ids.update(x for x in (s["source_id"], s["revision_id"], s["passage_id"], s.get("submission_id")) if x)
    for c in FX["claims"]:
        ids.add(c["claim_id"])
        ids.update(c["passage_ids"])
    ids.update([X1["conflict_id"], U1["unknown_id"]])
    for q in FX["questions"]:
        ids.add(q["id"])
    return ids


FIXTURE_IDS = _fixture_ids()
BLOCKED = "이 시연 기획은 청람시 시연 자료와 시연 초안만 판정합니다. 실제 자료로 검토하려면 다른 제목으로 새 기획을 만드세요."


class FixtureProvider(Provider):
    name = "fixture"
    demo = True

    def __init__(self, stage_delay: float = 0.0):
        self.stage_delay = stage_delay
        # test hooks, like the prototype's gateway switches
        self.gateway = {"search": "ZERO", "review": "OK", "collect": "OK"}

    # ---------------------------------------------------------------- ids
    @staticmethod
    def fid(case, fixture_id):
        return uuid_from(f"{case['id']}:fx:{fixture_id}")

    def remap(self, case, obj):
        if isinstance(obj, str):
            return self.fid(case, obj) if obj in FIXTURE_IDS else obj
        if isinstance(obj, list):
            return [self.remap(case, x) for x in obj]
        if isinstance(obj, dict):
            return {k: self.remap(case, v) for k, v in obj.items()}
        return obj

    # ---------------------------------------------------------------- submissions
    def match_submission(self, eng, case, norm):
        if norm["rights_class"] != "OPEN":
            s = next((s for s in FX["sources"] if s["rights"] != "OPEN" and s["url"] == norm["source_url"]), None)
        else:
            h = sha256hex(norm["body"])
            s = next((s for s in FX["sources"] if s["body_sha256"] == h and (not norm["source_url"] or s["url"] == norm["source_url"])), None)
        return s["key"] if s else None

    def source_for_submission(self, eng, case, sub):
        if not sub.get("fx_key"):
            return {}
        s = SRC[sub["fx_key"]]
        return {"key": s["key"], "source_id": self.fid(case, s["source_id"]), "revision_id": self.fid(case, s["revision_id"]),
                "passage_id": self.fid(case, s["passage_id"]) if s.get("passage_id") else None, "title": s["title"], "url": s["url"], "family": s["family"], "rights_class": s["rights"],
                "published_at": s["published_at"], "body": s["body"]}

    # ---------------------------------------------------------------- what the fixture can judge
    def prospective(self, eng, case, keys, as_of_ms, extra_avail=None):
        extra_avail = extra_avail or {}
        included = []
        for key in uniq(keys):
            s = SRC[key]
            rev = eng.rev_by_key(case["id"], key)
            src = eng.source_of(rev)
            rights = eng.rights_of(src) if src else s["rights"]
            avail = ms_of((rev and rev["available_at"]) or extra_avail.get(key) or s["available_at"])
            if rights != "OPEN" or avail > as_of_ms:
                continue
            included.append(key)
        return [k for k in CLAIM_ORDER if CLAIM[k]["source_key"] in included]

    @staticmethod
    def assert_recognized(claim_keys):
        if sig(claim_keys) not in RECOGNIZED:
            raise err("CONFIGURATION_BLOCKED", reason=BLOCKED)

    def _need_fixture(self, subs):
        if any(not s.get("fx_key") for s in subs):
            raise err("CONFIGURATION_BLOCKED", reason=BLOCKED)

    def precheck_execution(self, eng, case, *, mode, content, subs, baseline, searched, as_of_ms, actor):
        self._need_fixture(subs)
        cand = list(baseline["candidate_keys"]) if baseline else []
        cand += [s["fx_key"] for s in subs]
        if searched:
            cand += ["S1", "S2", "S3", "S4", "S5"]
        self.assert_recognized(self.prospective(eng, case, cand, as_of_ms, {s["fx_key"]: s["received_at"] for s in subs}))

    def precheck_review(self, eng, case, *, content, pack, actor):
        if content["body_sha256"] != FX["raw_body_sha256"]:
            raise err("CONFIGURATION_BLOCKED", reason=BLOCKED)
        self.assert_recognized(pack["claim_keys"])

    def precheck_reassessment(self, eng, case, *, baseline, subs, as_of_ms, actor):
        self._need_fixture(subs)
        base = eng.store.get("packs", baseline["reality_pack_id"])
        keys = [*base["candidate_keys"], *[s["fx_key"] for s in subs]]
        self.assert_recognized(self.prospective(eng, case, keys, as_of_ms, {s["fx_key"]: s["received_at"] for s in subs}))

    # ---------------------------------------------------------------- collection
    def _draft(self, case, key, collection="OK"):
        s = SRC[key]
        return {"key": key, "source_id": self.fid(case, s["source_id"]), "revision_id": self.fid(case, s["revision_id"]),
                "passage_id": self.fid(case, s["passage_id"]) if s.get("passage_id") else None, "url": s["url"], "title": s["title"], "family": s["family"], "rights_class": s["rights"],
                "published_at": s["published_at"], "available_at": s["available_at"], "body": s["body"], "collection": collection}

    def discover(self, eng, case, *, state, content, as_of_ms, parameters):
        partial = self.gateway["collect"] == "PARTIAL"
        sources = [self._draft(case, k) for k in ("S1", "S2", "S3", "S4", "S5")]
        # one collection channel failed: the re-post (S4) could not be fetched this time
        return {"sources": sources, "channel_failed": partial, "failed_keys": ["S4"] if partial else [], "warnings": [], "query_used": 1}

    def claims_for(self, eng, case, revision, source):
        out = []
        for c in FX["claims"]:
            if c["source_key"] != revision["key"]:
                continue
            s = SRC[c["source_key"]]
            amount = None
            if c.get("amount"):
                a = c["amount"]
                amount = {"value": a["amount"], "unit": "KRW", "period": a.get("period"), "role": a.get("role")}
                if a.get("total") is not None:
                    amount["total"] = a["total"]
            out.append({"key": c["key"], "claim_id": self.fid(case, c["claim_id"]), "passage_id": self.fid(case, c["passage_ids"][0]),
                        "text": c["text"], "start": s["start"], "end": s["end"], "epistemic_status": c["epistemic_status"],
                        "scope_key": c["scope_key"], "amount": amount})
        return out

    # ---------------------------------------------------------------- synthesis
    def synthesize(self, eng, case, *, pack, claims, parent, state, content):
        keys = set(pack["claim_keys"])
        has = keys.__contains__
        f = lambda x: self.fid(case, x)  # noqa: E731
        T = FX["assessment_templates"]
        conflicts, unknowns, assessments, overlay = [], [], {}, []
        superseded = {f(CLAIM["C1"]["claim_id"]): f(CLAIM["C8"]["claim_id"])} if has("C8") and has("C1") else {}
        if has("C1") and has("C2"):
            conflicts.append({
                "key": "X1", "conflict_id": f(X1["conflict_id"]), "question": X1["question"], "check_question": QK["X1"]["question"],
                "summary": CONFLICT_TEXT, "reason_unresolved": X1["reason_unresolved"],
                "supporting_claim_ids": self.remap(case, X1["supporting_claim_ids"]),
                "contradicting_claim_ids": self.remap(case, X1["contradicting_claim_ids"]),
                "resolved": has("C8"),
                "resolution_claim_ids": self.remap(case, T["X1"]["RESOLVED"]["resolution_claim_ids"]) if has("C8") else [],
                "needed_evidence": clone(CONFLICT_NEEDED), "factors": FACTORS["CONFLICT"],
            })
        if all(has(k) for k in BASE):
            unknowns.append({
                "key": "U1", "unknown_id": f(U1["unknown_id"]), "question": U1["question"], "top_question": QK["U1"]["question"],
                "why_important": U1["why_important"], "needed_evidence": U1["needed_evidence"], "needed_list": clone(UNKNOWN_NEEDED),
                "public_search_possible": U1["public_search_possible"], "human_reporting_needed": U1["human_reporting_needed"],
                "children": [{"key": "U1a", "id": f(QK["U1a"]["id"]), "question": QK["U1a"]["question"]},
                             {"key": "U1b", "id": f(QK["U1b"]["id"]), "question": QK["U1b"]["question"]}],
                "factors": FACTORS["UNKNOWN"],
            })
            st_a = "RESOLVED" if has("C5") and has("C7") else "OPEN"
            st_u1 = "PARTIALLY_RESOLVED" if st_a == "RESOLVED" else "OPEN"
            for qk, st in (("U1", st_u1), ("U1a", st_a), ("U1b", "OPEN"), ("X1", "RESOLVED" if has("C8") else "CONFLICTED")):
                a = self.remap(case, clone(T[qk][st]))
                if a.get("calculation"):
                    a.pop("calculation")
                    a["calc_ref"] = {"previous_claim_id": f(CLAIM["C5"]["claim_id"]), "current_claim_id": f(CLAIM["C7"]["claim_id"]),
                                     "excluded_claim_id": f(CLAIM["C6"]["claim_id"]), "scope_key": CLAIM["C5"]["scope_key"]}
                else:
                    a["calculation"] = None
                assessments[qk] = a
            base = clone(FX["brief"]["action_overlay"][0])
            item = {"question_key": "U1", "action": base["action"], "ask_role": base["ask_role"], "provenance": base["provenance"]}
            if has("C5") and has("C7"):
                item = {"question_key": "U1b", "action": "경쟁 확대가 비용 변화의 원인인지 확인할 근거를 요청한다.",
                        "ask_role": base["ask_role"], "provenance": "U1b 필요자료에 따른 기관 역할 제안"}
            overlay.append(item)
        return {"conflicts": conflicts, "unknowns": unknowns, "assessments": assessments, "superseded": superseded,
                "overlay": overlay, "claim_factors": {cid: FACTORS["CLAIM"] for cid in pack["claim_ids"]},
                "texts": {"brief_reason": BRIEF_REASON, "brief_summary": BRIEF_SUMMARY},
                "conflict_questions": True, "questions_only_with_unknowns": True}

    # ---------------------------------------------------------------- review
    def assertions_for(self, eng, case, content):
        if content["body_sha256"] != FX["raw_body_sha256"]:
            raise ProviderError("CONFIGURATION_BLOCKED", BLOCKED)
        out = [{"text": a["text"], "start": a["start"], "end": a["end"], "kind": a["kind"], "key": a["key"]} for a in FX["assertions"]]
        if self.gateway["review"] == "BAD_OFFSET":
            out[1] = {**out[1], "start": out[1]["start"] + 2}
        return out

    def assess(self, eng, case, *, pack, rows, claims, state):
        keys = set(pack["claim_keys"])
        has = keys.__contains__
        T = FX["item_templates"]
        items = []
        for row in rows:
            tmpl = None
            if row.get("key") == "A1":
                tmpl = T["A1"]["CONTRADICTED"] if has("C8") else (T["A1"]["CONFLICT"] if has("C1") and has("C2") else None)
            elif row.get("key") == "A2":
                tmpl = (T["A2"]["CONTRADICTED"] if has("C5") and has("C7")
                        else (T["A2"]["INSUFFICIENT_EVIDENCE"] if has("C3") and has("C4") else None))
            elif row.get("key") == "A3":
                tmpl = T["A3"]["SUPPORTED"] if has("C3") else None
            it = self.remap(case, clone(tmpl)) if tmpl else self._generic(row)
            items.append({"assertion_id": row["assertion_id"], "status": it["status"], "claim_ids": it["claim_ids"],
                          "conflict_ids": it["conflict_ids"], "unknown_ids": it["unknown_ids"], "reason_codes": it["reason_codes"],
                          "recommendation": it["recommendation"], "needed_evidence": it["needed_evidence"],
                          "supporting_claim_ids": it["supporting_claim_ids"], "contradicting_claim_ids": it["contradicting_claim_ids"],
                          "assertion_key": row["assertion_key"], "text": row["text"], "start": row["start"], "end": row["end"],
                          "kind": row["kind"], "subchecks": it["subchecks"]})
        if self.gateway["review"] == "BAD_CLAIM" and items:
            invented = uuid_from("invented-claim")
            items[0]["claim_ids"] = [*items[0]["claim_ids"], invented]
            items[0]["supporting_claim_ids"] = [*items[0]["supporting_claim_ids"], invented]
        return items

    @staticmethod
    def _generic(row):
        need = ["관련 공개 원문"]
        return {"status": "INSUFFICIENT_EVIDENCE", "claim_ids": [], "conflict_ids": [], "unknown_ids": [],
                "reason_codes": ["NO_RELEVANT_EVIDENCE"], "recommendation": "기준 시각까지 확인된 근거가 없어 이 문장의 단정을 보류한다.",
                "needed_evidence": need, "supporting_claim_ids": [], "contradicting_claim_ids": [],
                "subchecks": [{"kind": k, "status": "INSUFFICIENT_EVIDENCE", "supporting_claim_ids": [], "contradicting_claim_ids": [],
                               "expected_percent": None, "observed_percent": None, "calculation": None, "needed_evidence": need}
                              for k in ("NUMERIC", "CAUSAL")] if row["kind"] == "CAUSAL" else []}

    # ---------------------------------------------------------------- research search
    def search_question(self, eng, case, *, pack, question_text, question, as_of_ms, parameters):
        plan = clone(FX["search"]["plan"]) if question and question["question_key"] == "U1b" else [
            {"purpose": "UNKNOWN_DRIVEN", "query": f"{case['title']} {question_text}"}]
        mode = self.gateway["search"]
        fx = FX["search"]["partial" if mode == "PARTIAL" else "failed" if mode == "FAILED" else "zero"]
        out = {"plan": plan, "coverage": clone(fx["coverage"]), "query_used": fx["query_used"], "sources": [],
               "status": "COMPLETED", "warnings": [], "error_code": None}
        if mode == "PARTIAL":
            out.update(status="PARTIAL", warnings=[clone(FX["warnings"]["search_channel"])])
        elif mode == "FAILED":
            out.update(status="FAILED", warnings=[clone(FX["warnings"]["search_channel"])], error_code=fx["error_code"])
        return out

    # ---------------------------------------------------------------- texts
    def delta_reason(self, code):
        return FX["delta_reasons"].get(code) or ({"NUMERIC_CLAIM_CONTRADICTED": FX["delta_reasons"]["NUMERIC_CLAIM_CONTRADICTED"]}).get(code)

    def snapshot_labels(self):
        return clone(FX["snapshot"]["labels"])

    def scope_description(self):
        return FX["snapshot"]["scope_description"]

    def configured(self):
        return True
