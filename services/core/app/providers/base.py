"""What the engine asks of a provider.

The engine owns every rule that can be decided without a model: closed input
validation, versions, as_of, rights, idempotency, arithmetic, roll-ups,
reference checks and head compare-and-swap. A provider only proposes:

  discover          public sources for a question/draft (search + collection)
  claims_for        claims inside one source revision, each with an exact passage
  synthesize        conflicts, unknowns, questions and their assessments for one pack
  assertions_for    the draft's sentences and their kind
  assess            one verdict per sentence against one pack
  search_question   more public sources for one open question

Everything a provider returns is checked again by the engine before it is
stored; a proposal that fails the checks is refused, not repaired.

Shapes (plain dicts):

SourceDraft   {url, title, family, rights_class, published_at|None, body|None,
               collection: "OK"|"FAILED", note?, key?, source_id?, revision_id?}
ClaimDraft    {text, start, end, epistemic_status?, scope_key?, amount?|None,
               key?, claim_id?, passage_id?}
               amount = {value:int, unit:"KRW"|..., period:int|None, role?:str}
Synthesis     {conflicts:[{key, conflict_id?, question, summary, reason_unresolved,
                           supporting_claim_ids, contradicting_claim_ids, resolved,
                           resolution_claim_ids, needed_evidence:[str], factors}],
               unknowns:[{key, unknown_id?, question, why_important, needed_evidence:str,
                          needed_list:[str], public_search_possible, human_reporting_needed,
                          factors, children:[{key, id?, question}]}],
               assessments:{question_key: {status, resolution_claim_ids, reason,
                            needed_evidence:[str], calculation_ref?|calculation?}},
               superseded:{claim_id: by_claim_id},
               overlay:[{question_key, action, ask_role}],
               claim_factors:{claim_id: factors}}
AssertionDraft {text, start, end, kind, key?}
ItemDraft     {assertion_id, status, claim_ids, conflict_ids, unknown_ids, reason_codes,
               recommendation, needed_evidence, supporting_claim_ids,
               contradicting_claim_ids, subchecks:[{kind, status, supporting_claim_ids,
               contradicting_claim_ids, expected_percent, observed_percent,
               calculation|None, calc_ref?, needed_evidence}]}
"""
from __future__ import annotations


class ProviderError(Exception):
    """A provider could not do its part. `code` becomes the job's error_code."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


class Provider:
    name = "base"
    demo = False            # True: fictional demo material only
    stage_delay = 0.0       # seconds to linger on each job stage (demo pacing)

    # ---- create-time checks (raise ApiError to refuse the request) ----
    def precheck_execution(self, eng, case, *, mode, content, subs, baseline, searched, as_of_ms, actor):
        return None

    def precheck_review(self, eng, case, *, content, pack, actor):
        return None

    def precheck_reassessment(self, eng, case, *, baseline, subs, as_of_ms, actor):
        return None

    def precheck_search(self, eng, case, *, pack, question, actor):
        return None

    def precheck_submission(self, eng, case, *, norm, actor):
        return None

    # ---- job-time work ----
    def discover(self, eng, case, *, state, content, as_of_ms, parameters) -> dict:
        raise NotImplementedError

    def source_for_submission(self, eng, case, sub) -> dict:
        """Extra fields for the source made from a submission (fixture ids, family)."""
        return {}

    def claims_for(self, eng, case, revision, source) -> list[dict]:
        raise NotImplementedError

    def synthesize(self, eng, case, *, pack, claims, parent, state, content) -> dict:
        raise NotImplementedError

    def assertions_for(self, eng, case, content) -> list[dict]:
        raise NotImplementedError

    def assess(self, eng, case, *, pack, rows, claims, state) -> list[dict]:
        raise NotImplementedError

    def search_question(self, eng, case, *, pack, question_text, question, as_of_ms, parameters) -> dict:
        raise NotImplementedError

    # ---- texts the engine shows for this provider's material ----
    def delta_reason(self, code: str) -> str | None:
        return None

    def snapshot_labels(self) -> list[str]:
        return ["AI_ASSISTED_REVIEW", "HUMAN_DECISION_REQUIRED"]

    def scope_description(self) -> str:
        return "기준 시각까지 수집하거나 등록한 공개 자료와 그 원문 구간"
