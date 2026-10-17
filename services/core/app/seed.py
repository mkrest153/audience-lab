"""Demo accounts and the fully worked 청람시 demo case."""
from __future__ import annotations

import logging

from .auth import Accounts, actor_of
from .engine import FX
from .util import iso, real_now_ms

log = logging.getLogger("audience_lab.seed")

DEMO_USERS = [
    ("reporter.a@audience-lab.example", "기자 A", "EDITOR"),
    ("editor.b@audience-lab.example", "에디터 B", "EDITOR"),
    ("viewer.c@audience-lab.example", "열람자 C", "VIEWER"),
]


def ensure_demo_accounts(accounts: Accounts, password: str):
    for email, name, role in DEMO_USERS:
        if not accounts.by_email(email):
            accounts.create(email=email, name=name, role=role, password=password, workspace="demo", demo_only=True)


def ensure_admin(accounts: Accounts, email: str, password: str, name: str):
    if not email or not password:
        return None
    u = accounts.by_email(email)
    if u:
        return u
    log.info("creating administrator %s", email)
    return accounts.create(email=email, name=name, role="ADMIN", password=password, workspace="main")


def _ok(res, what):
    if not res["ok"]:
        raise RuntimeError(f"seed step {what} failed: {res['status']} {res['error']}")
    return res["data"]


def seed_demo_case(engine, accounts: Accounts):
    """Run the specification's fixture path once so visitors see every screen filled."""
    if engine.store.all("cases"):
        return None
    reporter = accounts.by_email(DEMO_USERS[0][0])
    if not reporter:
        return None
    actor = actor_of(reporter)
    fx_provider = engine.providers.get("fixture")
    delay = fx_provider.stage_delay
    fx_provider.stage_delay = 0
    ws = engine.WS
    n = [0]

    def call(op, params=None, body=None, if_match=None):
        n[0] += 1
        return engine.call(op, actor=actor, params={"workspace_id": ws, **(params or {})}, body=body, key=f"seed-{n[0]}", if_match=if_match)

    try:
        intake = _ok(call("createCaseIntake", body={"mode": "DRAFT_REVIEW", "title": FX["intake"]["title"], "question": FX["intake"]["question"],
                                                     "as_of": FX["intake"]["as_of"], "draft": FX["intake"]["draft"]}), "intake")
        p = {"case_id": intake["case_id"]}
        ex = _ok(call("createRealityExecution", p, {"mode": "DRAFT_REVIEW", "state_version_id": intake["state_version_id"],
                                                    "content_version_id": intake["content_version_id"], "baseline_pack_id": None,
                                                    "submission_ids": [], "reporting_result_ids": [], "as_of": FX["intake"]["as_of"],
                                                    "allow_partial": False, "parameters": {"query_budget": 10, "source_budget": 20, "language": "ko"}}), "execution")
        engine.drain()
        exe = _ok(call("getRealityExecution", {**p, "execution_id": ex["execution_id"]}), "execution read")
        rv = _ok(call("createDraftReview", p, {"content_version_id": intake["content_version_id"], "state_version_id": intake["state_version_id"],
                                               "reality_pack_id": exe["result_pack_id"], "allow_partial": False}), "review")
        engine.drain()
        review = _ok(call("getDraftReview", {**p, "review_id": rv["review_id"]}), "review read")
        _ok(call("createEditorialBrief", p, {"state_version_id": intake["state_version_id"], "reality_pack_id": exe["result_pack_id"],
                                            "content_version_id": intake["content_version_id"], "allow_partial": False}), "brief 1")
        pack = engine.store.get("packs", exe["result_pack_id"])
        x1 = pack["conflict_ids"][0]
        u1 = pack["unknown_ids"][0]
        task = _ok(call("createReportingTask", p, {"review_id": review["id"], "brief_id": None, "title": FX["task_default"]["title"],
                                                   "questions": FX["task_default"]["questions"],
                                                   "assertion_ids": [review["items"][0]["assertion_id"], review["items"][1]["assertion_id"]],
                                                   "conflict_ids": [x1], "unknown_ids": [u1], "assignee_id": actor["actor_id"]}), "task")["task"]
        subs = []
        for key in ("S6", "S7"):
            s = next(x for x in FX["sources"] if x["key"] == key)
            subs.append(_ok(call("createEvidenceSubmission", p, {"title": s["title"], "source_url": s["url"], "transcript_locator": None,
                                                                 "recorded_at": s["published_at"], "sensitivity": "PUBLIC", "rights_class": "OPEN",
                                                                 "body": s["body"]}), key)["submission"])
        qids = [q["id"] for q in review["questions"] if q["question_key"] in ("U1", "U1a", "U1b")]
        result = _ok(call("createReportingResult", p, {"task_id": task["id"], "submission_ids": [s["id"] for s in subs],
                                                       "note": FX["result_note"], "question_ids": qids}), "result")["result"]
        _ok(call("updateReportingTask", {**p, "task_id": task["id"]}, {"status": "DONE", "reason": FX["task_done_reason"]}, if_match='"1"'), "task done")
        re_ = _ok(call("createReassessment", p, {"baseline_review_id": review["id"], "reporting_result_ids": [result["id"]],
                                                 "as_of": iso(real_now_ms()), "allow_partial": False}), "reassessment")
        engine.drain()
        rea = _ok(call("getReassessment", {**p, "reassessment_id": re_["resource_id"]}), "reassessment read")
        if rea["status"] != "COMPLETED":
            raise RuntimeError(f"seed reassessment ended {rea['status']} {rea['error_code']}")
        _ok(call("createEditorialBrief", p, {"state_version_id": intake["state_version_id"], "reality_pack_id": rea["result_pack_id"],
                                            "content_version_id": intake["content_version_id"], "allow_partial": False}), "brief 2")
        for fmt in ("PDF", "DOCX"):
            if engine.renderers.get(fmt):
                _ok(call("createEditorialExport", p, {"input_kind": "DRAFT_REVIEW", "input_id": rea["result_review_id"], "format": fmt}), f"export {fmt}")
        engine.drain()
        log.info("demo case seeded: %s", intake["case_id"])
        return intake["case_id"]
    finally:
        fx_provider.stage_delay = delay
