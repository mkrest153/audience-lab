"""Draft review: the server's checks of what a provider proposed, and deltas.

The provider proposes sentences and verdicts; the server verifies offsets,
references, status consistency and every number before anything is kept.
A review either passes all checks or fails as a whole.
"""
from __future__ import annotations

from ..calc import percent_change, rollup_status
from ..errors import ApiError
from ..util import canon, clone, sha256hex, uuid_from

KINDS = ("FACTUAL", "CAUSAL", "NON_FACTUAL")
STATUSES = ("SUPPORTED", "CONFLICT", "CONTRADICTED", "INSUFFICIENT_EVIDENCE", "NON_FACTUAL")
DELTA_REASONS = {
    "UNCHANGED": "판정과 근거 유지",
    "SOURCE_CORRECTION_CONFIRMED": "출처 정정 반영",
    "NUMERIC_CLAIM_CONTRADICTED": "같은 범위 수치 근거 추가",
    "OTHER": "근거 범위 변경",
    "NOT_COMPARABLE": "초안 본문 버전이 달라 자동으로 대응시키지 않는다.",
}


class ReviewMixin:
    # ---------------------------------------------------------------- stage 1: sentences
    @staticmethod
    def validate_assertions(content, items):
        body = content["body"]
        if not isinstance(items, list) or len(items) < 1 or len(items) > 500:
            return "REVIEW_OUTPUT_INVALID"
        for a in items:
            s, e = a.get("start"), a.get("end")
            if not isinstance(s, int) or not isinstance(e, int) or isinstance(s, bool) or s < 0 or e <= s:
                return "REVIEW_OUTPUT_INVALID"
            if body[s:e] != a.get("text"):
                return "REVIEW_OUTPUT_INVALID"
            if a.get("kind") not in KINDS:
                return "REVIEW_OUTPUT_INVALID"
        return None

    @staticmethod
    def assertion_rows(content, items):
        rows = []
        for a in items:
            akey = sha256hex(canon({"content_version_id": content["id"], "raw_body_sha256": content["body_sha256"],
                                    "start": a["start"], "end": a["end"], "text": a["text"], "kind": a["kind"]}))
            rows.append({"assertion_id": uuid_from(f"assertion:{akey}"), "assertion_key": akey, "key": a.get("key"),
                         "text": a["text"], "start": a["start"], "end": a["end"], "kind": a["kind"]})
        rows.sort(key=lambda r: (r["start"], r["end"], r["assertion_id"]))
        return rows

    # ---------------------------------------------------------------- stage 2: verdicts
    def validate_items(self, pack, rows, items):
        eligible = set(pack["claim_ids"])
        superseded = set(((pack.get("synthesis") or {}).get("superseded") or {}).keys())
        if not isinstance(items, list) or len(items) != len(rows):
            return "REVIEW_OUTPUT_INVALID", "문장 수와 판정 수가 다르다."
        by_id = {r["assertion_id"]: r for r in rows}
        seen = set()
        for it in items:
            row = by_id.get(it.get("assertion_id"))
            if not row or it["assertion_id"] in seen:
                return "REVIEW_OUTPUT_INVALID", "알 수 없거나 중복된 문장 판정이 있다."
            seen.add(it["assertion_id"])
            if row["text"] != it.get("text") or row["start"] != it.get("start") or row["end"] != it.get("end"):
                return "REVIEW_OUTPUT_INVALID", "판정의 문장 위치가 초안과 다르다."
            if it.get("status") not in STATUSES:
                return "REVIEW_OUTPUT_INVALID", "허용되지 않은 판정 값이다."
            sup, con = it.get("supporting_claim_ids") or [], it.get("contradicting_claim_ids") or []
            refs = [*it.get("claim_ids", []), *sup, *con]
            if not all(i in eligible for i in refs):
                return "REVIEW_REFERENCE_INVALID", "고정한 근거 묶음에 없는 근거 진술을 참조했다."
            if not all(i in it.get("claim_ids", []) for i in [*sup, *con]):
                return "REVIEW_REFERENCE_INVALID", "뒷받침·반박 근거가 참조 목록에 없다."
            if any(i in con for i in sup):
                return "REVIEW_REFERENCE_INVALID", "같은 근거가 뒷받침과 반박에 함께 있다."
            if any(i in superseded for i in sup):
                return "REVIEW_REFERENCE_INVALID", "정정 이전 기록을 뒷받침으로 썼다."
            if not all(i in pack["conflict_ids"] for i in it.get("conflict_ids", [])):
                return "REVIEW_REFERENCE_INVALID", "근거 묶음에 없는 상충을 참조했다."
            if not all(i in pack["unknown_ids"] for i in it.get("unknown_ids", [])):
                return "REVIEW_REFERENCE_INVALID", "근거 묶음에 없는 공백을 참조했다."
            st = it["status"]
            if st == "SUPPORTED" and (not sup or con):
                return "REVIEW_OUTPUT_INVALID", "근거 있음에는 뒷받침만 있어야 한다."
            if st == "CONFLICT" and (not sup or not con):
                return "REVIEW_OUTPUT_INVALID", "상충에는 양쪽 근거가 모두 필요하다."
            if st == "CONTRADICTED" and (not con or sup):
                return "REVIEW_OUTPUT_INVALID", "반박됨에는 반박 근거만 있어야 한다."
            if st == "INSUFFICIENT_EVIDENCE" and not it.get("needed_evidence"):
                return "REVIEW_OUTPUT_INVALID", "근거 부족에는 필요한 근거가 있어야 한다."
            if st == "NON_FACTUAL" and row["kind"] != "NON_FACTUAL":
                return "REVIEW_OUTPUT_INVALID", "사실 문장을 판정 대상 아님으로 둘 수 없다."
            if not it.get("reason_codes") or not str(it.get("recommendation") or "").strip():
                return "REVIEW_OUTPUT_INVALID", "판정 이유와 권고가 필요하다."
            subs = it.get("subchecks") or []
            if subs and rollup_status([s.get("status") for s in subs]) != st:
                return "REVIEW_OUTPUT_INVALID", "세부 판정의 종합이 문장 판정과 다르다."
            for sc in subs:
                if sc.get("status") not in STATUSES or sc.get("kind") not in ("NUMERIC", "CAUSAL", "FACTUAL"):
                    return "REVIEW_OUTPUT_INVALID", "세부 판정 값이 허용되지 않는다."
                if not all(i in eligible for i in [*sc.get("supporting_claim_ids", []), *sc.get("contradicting_claim_ids", [])]):
                    return "REVIEW_REFERENCE_INVALID", "세부 판정이 근거 묶음 밖의 근거를 참조했다."
                calc = sc.get("calculation")
                if calc:
                    try:
                        pc = percent_change(calc["previous_amount"], calc["current_amount"], calc["scale"])
                    except (ApiError, KeyError, TypeError):
                        return "REVIEW_OUTPUT_INVALID", "계산 근거를 다시 계산할 수 없다."
                    if pc["exact_percent"] != calc["exact_percent"] or pc["display_percent"] != calc["display_percent"]:
                        return "REVIEW_OUTPUT_INVALID", "계산 결과가 서버 계산과 다르다."
                    if sc.get("observed_percent") != pc["exact_percent"]:
                        return "REVIEW_OUTPUT_INVALID", "근거 수치가 계산 결과와 다르다."
                    if not all(i in eligible for i in calc.get("supporting_claim_ids", [])):
                        return "REVIEW_REFERENCE_INVALID", "계산이 근거 묶음 밖의 근거를 썼다."
        return None, None

    # ---------------------------------------------------------------- deltas
    def compute_delta(self, before, after, *, created_at, source_change_ids=(), provider=None):
        reasons = dict(DELTA_REASONS)
        if provider is not None:
            for code in list(reasons):
                over = provider.delta_reason(code)
                if over:
                    reasons[code] = over
        same = before["content_version_id"] == after["content_version_id"]
        items = []
        if same:
            for a in after["items"]:
                b = next((x for x in before["items"] if x["assertion_key"] == a["assertion_key"]), None)
                if not b:
                    items.append(self._only(a, "AFTER_ONLY", reasons))
                    continue
                types = []
                if a["status"] != b["status"]:
                    types.append("STATUS_CHANGED")
                else:
                    if canon(sorted(a["claim_ids"])) != canon(sorted(b["claim_ids"])) or canon(a["subchecks"]) != canon(b["subchecks"]):
                        types.append("EVIDENCE_CHANGED")
                    if a["recommendation"] != b["recommendation"]:
                        types.append("RECOMMENDATION_CHANGED")
                if not types:
                    types.append("UNCHANGED")
                reason = reasons["UNCHANGED"]
                if types[0] != "UNCHANGED":
                    if "SOURCE_CORRECTION_CONFIRMED" in a["reason_codes"]:
                        reason = reasons["SOURCE_CORRECTION_CONFIRMED"]
                    elif "NUMERIC_CLAIM_CONTRADICTED" in a["reason_codes"]:
                        reason = reasons["NUMERIC_CLAIM_CONTRADICTED"]
                    else:
                        reason = reasons["OTHER"]
                items.append({"assertion_key": a["assertion_key"], "change_types": types, "before_status": b["status"],
                              "after_status": a["status"], "before_claim_ids": clone(b["claim_ids"]),
                              "after_claim_ids": clone(a["claim_ids"]), "before_subchecks": clone(b["subchecks"]),
                              "after_subchecks": clone(a["subchecks"]), "reason": reason})
            for b in before["items"]:
                if not any(x["assertion_key"] == b["assertion_key"] for x in after["items"]):
                    items.append(self._only(b, "BEFORE_ONLY", reasons))
        else:
            items.extend(self._only(b, "BEFORE_ONLY", reasons) for b in before["items"])
            items.extend(self._only(a, "AFTER_ONLY", reasons) for a in after["items"])
        question_changes = []
        for qa in after["question_assessments"]:
            qb = next((x for x in before["question_assessments"] if x["question_id"] == qa["question_id"]), None)
            if qb and qb["status"] != qa["status"]:
                question_changes.append({"question_id": qa["question_id"], "before_status": qb["status"], "after_status": qa["status"],
                                         "resolution_claim_ids": clone(qa["resolution_claim_ids"]), "reason": qa["reason"]})
        from ..util import new_uuid
        delta = {
            "id": new_uuid(), "workspace_id": self.WS, "case_id": after["case_id"],
            "before_review_id": before["id"], "after_review_id": after["id"],
            "before_content_version_id": before["content_version_id"], "after_content_version_id": after["content_version_id"],
            "content_version_id": after["content_version_id"] if same else None,
            "comparison_status": "COMPARABLE" if same else "NOT_COMPARABLE",
            "items": items, "question_changes": question_changes, "source_change_ids": list(source_change_ids),
            "created_at": created_at,
        }
        self.store.put("deltas", delta)
        return delta

    @staticmethod
    def _only(it, typ, reasons):
        before = typ == "BEFORE_ONLY"
        return {"assertion_key": it["assertion_key"], "change_types": [typ],
                "before_status": it["status"] if before else None, "after_status": None if before else it["status"],
                "before_claim_ids": clone(it["claim_ids"]) if before else [], "after_claim_ids": [] if before else clone(it["claim_ids"]),
                "before_subchecks": clone(it["subchecks"]) if before else [], "after_subchecks": [] if before else clone(it["subchecks"]),
                "reason": reasons["NOT_COMPARABLE"]}
