"""The demo provider replays the pack's fixture path and matches its examples."""
import json

from app.calc import percent_change, rollup_question, rollup_status
from app.engine import FX
from app.errors import ApiError
from app.util import canon, sha256hex
from tests.helpers import SRC, Client, load, sub_body
from tests.symbols import assert_same, fixture_symbols, name_view, server_symbols

cf = load("core_fixtures.json")
wf = load("workflow_examples.json")
mw = load("mode_workflow_examples.json")
st = {e["label"]: e["value"] for e in load("state_response_examples.json")["examples"]}
api = {e["operation_id"]: e for e in load("api_examples.json")}
snap_example = load("editorial_snapshot.example.json")
EXEC = {"mode": "DRAFT_REVIEW", "baseline_pack_id": None, "submission_ids": [], "reporting_result_ids": [],
        "as_of": "2026-09-30T09:00:00Z", "allow_partial": False, "parameters": {"query_budget": 10, "source_budget": 20, "language": "ko"}}


def draft_through_review(c):
    c.clock("2026-09-30T09:00:00Z")
    intake = c.call("createCaseIntake", body=api["createCaseIntake"]["request"], key="intake-1")
    assert intake["status"] == 201, intake
    ids = intake["data"]
    p = {"case_id": ids["case_id"]}
    ex = c.call("createRealityExecution", p, {**EXEC, "state_version_id": ids["state_version_id"], "content_version_id": ids["content_version_id"]})
    assert ex["status"] == 202, ex
    c.drain()
    exec_ = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    rv = c.call("createDraftReview", p, {"content_version_id": ids["content_version_id"], "state_version_id": ids["state_version_id"],
                                          "reality_pack_id": exec_["result_pack_id"], "allow_partial": False}, key="review-1")
    return ids, p, exec_, rv, intake


def symbols_for(c, ids):
    got = server_symbols(ids["case_id"], c.fx)
    got.add(c.eng.WS, "ws")
    got.add(ids["case_id"], "case")
    got.add(ids["state_version_id"], "state")
    got.add(ids["content_version_id"], "content")
    return got


def test_arithmetic_and_rollups():
    assert percent_change(1250000000, 1200000000) == {"exact_percent": "4", "display_percent": "4.00"}
    assert percent_change(8, 7) == {"exact_percent": "12.5", "display_percent": "12.50"}
    assert percent_change(3, 2) == {"exact_percent": "100/3", "display_percent": "33.33"}
    assert percent_change(800, 799) == {"exact_percent": "0.125", "display_percent": "0.13"}
    assert percent_change(100, 110) == {"exact_percent": "-10", "display_percent": "-10.00"}
    try:
        percent_change(0, 10)
        raise AssertionError("expected CALCULATION_INVALID")
    except ApiError as e:
        assert e.code == "CALCULATION_INVALID"
    assert percent_change(1500000000, 1200000000)["exact_percent"] != "4"
    assert rollup_status(["CONTRADICTED", "INSUFFICIENT_EVIDENCE"]) == "CONTRADICTED"
    assert rollup_status(["CONFLICT", "CONTRADICTED"]) == "CONFLICT"
    assert rollup_status(["SUPPORTED", "SUPPORTED"]) == "SUPPORTED"
    assert rollup_question(["RESOLVED", "OPEN"]) == "PARTIALLY_RESOLVED"
    assert rollup_question(["RESOLVED", "RESOLVED"]) == "RESOLVED"
    assert rollup_question(["RESOLVED", "CONFLICTED"]) == "CONFLICTED"
    assert rollup_question(["OPEN", "OPEN"]) == "OPEN"
    assert sha256hex(cf["draft"]) == cf["raw_body_sha256"]


def test_draft_review_path_matches_the_pack(client):
    c = client
    want = fixture_symbols()
    ids, p, exec_, rv, intake = draft_through_review(c)
    got = symbols_for(c, ids)

    # --- intake and idempotency ---
    assert_same(intake["data"], api["createCaseIntake"]["response"]["data"], got, want)
    again = c.call("createCaseIntake", body=api["createCaseIntake"]["request"], key="intake-1")
    assert again["data"] == {**intake["data"], "reused": True}
    conflict = c.call("createCaseIntake", body={**api["createCaseIntake"]["request"], "question": "다른 질문"}, key="intake-1")
    assert conflict["status"] == 409 and conflict["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert len(c.call("listCases")["data"]["items"]) == 1
    assert_same(c.call("listContentVersions", p)["data"], api["listContentVersions"]["response"]["data"], got, want)
    assert_same(c.call("listStateVersions", p)["data"], api["listStateVersions"]["response"]["data"], got, want)

    # --- reality pack ---
    assert exec_["status"] == "COMPLETED" and exec_["head_updated"] is True
    got.add(exec_["result_pack_id"], "pack01")
    assert_same(exec_["warnings"], cf["reviews"][0]["warnings"], got, want)
    board = c.call("getRealityBoard", {**p, "pack_id": exec_["result_pack_id"]})["data"]
    assert [x["key"] for x in board["what_we_know"]] == ["C1", "C2", "C3", "C4"]
    assert len(board["what_is_disputed"]) == 1 and len(board["what_remains_unknown"]) == 1
    city = next(f for f in board["families"] if f["family"] == "CITY_RELEASE")
    assert city["source_keys"] == ["S1", "S4"] and city["independent_groups"] == 1
    s5 = next(s for s in board["sources"] if s["key"] == "S5")
    assert s5["included"] is False
    assert "특정 업체" not in json.dumps(board, ensure_ascii=False)

    # --- draft review ---
    got.add(rv["data"]["review_id"], "review01")
    assert_same(rv["data"], api["createDraftReview"]["response"]["data"], got, want)
    queued = c.call("getDraftReview", {**p, "review_id": rv["data"]["review_id"]})["data"]
    assert queued["status"] == "QUEUED" and queued["items"] == [] and queued["completed_at"] is None
    c.drain()
    review01 = c.call("getDraftReview", {**p, "review_id": rv["data"]["review_id"]})["data"]
    name_view(got, "review01", review01)
    assert_same(review01, cf["reviews"][0], got, want)
    assert [i["status"] for i in review01["items"]] == ["CONFLICT", "INSUFFICIENT_EVIDENCE", "SUPPORTED"]
    assert_same(c.call("getCase", p)["data"], api["getCase"]["response"]["data"], got, want)
    same_key = {"content_version_id": ids["content_version_id"], "state_version_id": ids["state_version_id"],
                "reality_pack_id": exec_["result_pack_id"], "allow_partial": False}
    r2 = c.call("createDraftReview", p, same_key, key="review-1")
    assert r2["data"]["review_id"] == rv["data"]["review_id"] and r2["data"]["reused"] is True and r2["data"]["status"] == "COMPLETED"
    r3 = c.call("createDraftReview", p, {**same_key, "allow_partial": True}, key="review-1")
    assert r3["status"] == 409 and r3["error"]["code"] == "IDEMPOTENCY_CONFLICT"

    # --- evidence trace ---
    a1 = review01["items"][0]
    sup = c.call("getEvidenceTrace", {**p, "pack_id": exec_["result_pack_id"], "claim_id": a1["supporting_claim_ids"][0]})["data"]
    con = c.call("getEvidenceTrace", {**p, "pack_id": exec_["result_pack_id"], "claim_id": a1["contradicting_claim_ids"][0]})["data"]
    assert sup["traces"][0]["source"]["key"] == "S1"
    assert sup["traces"][1]["relation"] == "REPEAT" and sup["traces"][1]["source"]["key"] == "S4"
    assert con["traces"][0]["source"]["key"] == "S2" and con["traces"][0]["passage"]["text"] == SRC["S2"]["body"]

    # --- reporting task ---
    task_req = want_req = json.loads(json.dumps(api["createReportingTask"]["request"]))
    task_req = json.loads(json.dumps(got_from(want_req, want, got)))
    task = c.call("createReportingTask", p, task_req, key="task-1")
    assert task["status"] == 201, task
    got.add(task["data"]["task"]["id"], "task")
    assert_same(task["data"]["task"], wf["task"], got, want)
    tget = c.call("getReportingTask", {**p, "task_id": task["data"]["task"]["id"]})
    assert tget["headers"]["ETag"] == '"1"'
    assert c.call("createReportingTask", p, task_req, key="task-1")["data"]["task"]["id"] == task["data"]["task"]["id"]
    assert len(c.call("listReportingTasks", p)["data"]["items"]) == 1
    vt = c.call("createReportingTask", p, task_req, who="c")
    assert vt["status"] == 403 and vt["error"]["code"] == "ROLE_FORBIDDEN"

    # --- SCN 02: receive material, store a result, close the task ---
    c.clock("2026-10-02T09:00:00Z")
    s6 = c.call("createEvidenceSubmission", p, api["createEvidenceSubmission"]["request"])
    got.add(s6["data"]["submission"]["id"], "sub:S6")
    got.add(s6["data"]["submission"]["content_version_id"], "content:S6")
    assert_same(s6["data"], api["createEvidenceSubmission"]["response"]["data"], got, want)
    s7 = c.call("createEvidenceSubmission", p, sub_body("S7"))
    got.add(s7["data"]["submission"]["id"], "sub:S7")
    got.add(s7["data"]["submission"]["content_version_id"], "content:S7")
    assert_same(c.call("getEvidenceSubmission", {**p, "submission_id": s6["data"]["submission"]["id"]})["data"],
                api["getEvidenceSubmission"]["response"]["data"], got, want)
    c.clock("2026-10-02T09:05:00Z")
    res_req = got_from(api["createReportingResult"]["request"], want, got)
    result = c.call("createReportingResult", p, res_req)
    got.add(result["data"]["result"]["id"], "result")
    assert_same(result["data"], api["createReportingResult"]["response"]["data"], got, want)
    c.clock("2026-10-02T09:06:00Z")
    done = c.call("updateReportingTask", {**p, "task_id": task["data"]["task"]["id"]}, api["updateReportingTask"]["request"], if_match='"1"')
    assert_same(done["data"], api["updateReportingTask"]["response"]["data"], got, want)
    assert_same(c.call("getDraftReview", {**p, "review_id": review01["id"]})["data"], cf["reviews"][0], got, want)
    re_req = got_from(api["createReassessment"]["request"], want, got)
    early = c.call("createReassessment", p, {**re_req, "as_of": "2026-10-02T08:00:00Z"})
    assert early["status"] == 422 and early["error"]["code"] == "AS_OF_SOURCE_UNAVAILABLE"

    # --- SCN 02: reassessment ---
    c.clock("2026-10-02T10:00:00Z")
    re_ = c.call("createReassessment", p, re_req)
    got.add(re_["data"]["resource_id"], "reassessment")
    got.add(re_["data"]["job_id"], "job")
    assert_same(re_["data"], api["createReassessment"]["response"]["data"], got, want)
    running = c.call("getReassessment", {**p, "reassessment_id": re_["data"]["resource_id"]})["data"]
    assert running["result_review_id"] is None
    c.drain()
    reass = c.call("getReassessment", {**p, "reassessment_id": re_["data"]["resource_id"]})["data"]
    got.add(reass["result_pack_id"], "pack02")
    got.add(reass["delta_id"], "delta02")
    review02 = c.call("getDraftReview", {**p, "review_id": reass["result_review_id"]})["data"]
    name_view(got, "review02", review02)
    assert_same(reass, wf["reassessment"], got, want)
    assert_same(review02, cf["reviews"][1], got, want)
    delta02 = c.call("getReviewDelta", {**p, "delta_id": reass["delta_id"]})["data"]
    assert_same(delta02, wf["review_delta"], got, want)
    a2 = review02["items"][1]
    assert a2["status"] == "CONTRADICTED"
    assert [(s["kind"], s["status"]) for s in a2["subchecks"]] == [("NUMERIC", "CONTRADICTED"), ("CAUSAL", "INSUFFICIENT_EVIDENCE")]
    assert_same(a2["subchecks"][0]["calculation"], cf["calculation"], got, want)
    head2 = c.call("getCase", p)["data"]["head"]
    assert head2["pack_id"] == reass["result_pack_id"] and head2["review_id"] == reass["result_review_id"]
    assert_same(c.call("getDraftReview", {**p, "review_id": review01["id"]})["data"], cf["reviews"][0], got, want)

    # --- monitoring is off in this product ---
    off = c.call("setMonitoringPolicy", p, {"monitoring_enabled": True})
    assert off["status"] == 409 and off["error"]["code"] == "MONITORING_DISABLED"
    assert c.call("getMonitoringPolicy", p)["data"]["environment_enabled"] is False

    # --- SCN 04: manual public search on the open causal question ---
    c.clock("2026-10-03T10:00:00Z")
    sr_req = got_from(api["createResearchSearch"]["request"], want, got)
    sr_req = {**sr_req, "baseline_pack_id": reass["result_pack_id"]}
    sr = c.call("createResearchSearch", p, sr_req)
    assert sr["status"] == 202, sr
    c.drain()
    search = c.call("getResearchSearch", {**p, "search_id": sr["data"]["search_id"]})["data"]
    got.add(search["id"], "search")
    got.add(search["job_id"], "search-job")
    zero = {**wf["zero_result_search"], "baseline_pack_id": FX["ids"]["pack02"]}
    assert_same(search, zero, got, want)
    for mode, label in (("PARTIAL", "search_PARTIAL"), ("FAILED", "search_FAILED")):
        c.fx.gateway["search"] = mode
        x = c.call("createResearchSearch", p, sr_req)
        c.drain()
        g = c.call("getResearchSearch", {**p, "search_id": x["data"]["search_id"]})["data"]
        assert g["status"] == st[label]["status"] and g["coverage"] == st[label]["coverage"] and g["error_code"] == st[label]["error_code"]
        assert [w["code"] for w in g["warnings"]] == [w["code"] for w in st[label]["warnings"]]
    c.fx.gateway["search"] = "ZERO"
    for bad in ("10", True, 21, 0, 1.5):
        x = c.call("createResearchSearch", p, {**sr_req, "parameters": {"query_budget": bad}})
        assert x["status"] == 422, bad
    assert_same(c.call("getDraftReview", {**p, "review_id": review02["id"]})["data"], cf["reviews"][1], got, want)

    # --- SCN 05: a real file from a pinned review ---
    c.clock("2026-10-03T10:01:00Z")
    xp = c.call("createEditorialExport", p, {"input_kind": "DRAFT_REVIEW", "input_id": review02["id"], "format": "DOCX"})
    assert xp["status"] == 202, xp
    q = c.call("getEditorialExport", {**p, "export_id": xp["data"]["export_id"]})["data"]
    assert q["status"] == "QUEUED" and q["filename"] is None
    nr = c.call("downloadEditorialExport", {**p, "export_id": xp["data"]["export_id"]})
    assert nr["status"] == 409
    c.drain()
    xd = c.call("getEditorialExport", {**p, "export_id": xp["data"]["export_id"]})["data"]
    assert xd["status"] == "COMPLETED", xd
    assert xd["media_type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert xd["size_bytes"] > 0
    assert xd["filename"].startswith(f"audience-lab-review-{review02['id'][:8]}-") and xd["filename"].endswith("Z.docx")
    f = c.call("downloadEditorialExport", {**p, "export_id": xp["data"]["export_id"]}, who="c")
    assert f["status"] == 200 and sha256hex(f["binary"]) == xd["sha256"]
    assert c.call("createEditorialExport", p, {"input_kind": "DRAFT_REVIEW", "input_id": review02["id"], "format": "DOCX"}, who="c")["status"] == 403
    assert c.call("createEditorialExport", p, {"input_kind": "DRAFT_REVIEW", "input_id": review02["id"], "format": "DOCX", "storage_path": "/tmp/x"})["status"] == 422
    # readback mismatch never becomes a finished file
    real_put = c.store.put_artifact
    c.store.put_artifact = lambda i, d: real_put(i, b"\0\0\0\0" + d[4:])
    bad = c.call("createEditorialExport", p, {"input_kind": "DRAFT_REVIEW", "input_id": review02["id"], "format": "PDF"})
    c.drain()
    c.store.put_artifact = real_put
    bg = c.call("getEditorialExport", {**p, "export_id": bad["data"]["export_id"]})["data"]
    assert bg["status"] == "FAILED" and bg["error_code"] == "EXPORT_ARTIFACT_INVALID" and bg["size_bytes"] is None
    # rights revoked after completion: the old file is refused as a whole
    s2 = c.store.get("sources", c.fx.fid({"id": ids["case_id"]}, SRC["S2"]["source_id"]))
    s2["rights_override"] = "RESTRICTED_LINK_ONLY"
    blocked = c.call("downloadEditorialExport", {**p, "export_id": xp["data"]["export_id"]})
    assert blocked["status"] == 403 and blocked["error"]["code"] == "EXPORT_RIGHTS_BLOCKED" and blocked.get("binary") is None
    assert c.call("getEditorialExport", {**p, "export_id": xp["data"]["export_id"]})["data"]["status"] == "BLOCKED"
    assert c.call("createEditorialExport", p, {"input_kind": "DRAFT_REVIEW", "input_id": review02["id"], "format": "JSON"})["status"] == 403
    tr = c.call("getEvidenceTrace", {**p, "pack_id": reass["result_pack_id"], "claim_id": c.fx.fid({"id": ids["case_id"]}, FX["claims"][1]["claim_id"])})["data"]
    assert tr["traces"][0]["passage"]["text"] is None and tr["traces"][0]["blocked_reason"]
    assert c.problems == []


def got_from(obj, want, got):
    """Rewrite a pack request (fixture ids) into this server's ids."""
    inverse = {}
    for ident, sym in got.map.items():
        inverse[sym] = ident
    def tr(x):
        if isinstance(x, str):
            sym = want.map.get(x)
            return inverse.get(sym, x) if sym else x
        if isinstance(x, list):
            return [tr(v) for v in x]
        if isinstance(x, dict):
            return {k: tr(v) for k, v in x.items()}
        return x
    return tr(obj)


def test_schema_checks_are_live(client):
    from tests.conftest import _ENVELOPE, schema_errors
    assert len(_ENVELOPE) >= 30
    assert schema_errors("CaseEnvelope", {"data": {"id": "x"}})


def test_draftless_flow_brief_task_and_snapshot(client):
    c = client
    want = fixture_symbols()
    ids, p, exec_, rv, intake = draft_through_review(c)
    c.drain()
    got = symbols_for(c, ids)
    got.add(exec_["result_pack_id"], "pack01")
    c.clock("2026-09-30T09:05:00Z")
    subs = [c.call("createEvidenceSubmission", p, sub_body(k))["data"]["submission"] for k in ("S1", "S2", "S3", "S4")]
    for k, s in zip(("S1", "S2", "S3", "S4"), subs):
        got.add(s["id"], f"sub:{k}")
        got.add(s["content_version_id"], f"content:{k}")
    c.clock("2026-09-30T09:06:00Z")
    sw = c.call("appendCaseIntake", p, {"mode": "SOURCE_REVIEW", "title": cf["title"], "question": cf["primary_editorial_question"],
                                         "as_of": "2026-09-30T09:10:00Z"})
    assert sw["status"] == 201 and sw["data"]["content_version_id"] is None
    got.add(sw["data"]["state_version_id"], "source-state")
    assert_same(c.call("listStateVersions", p)["data"]["items"][1], cf["draftless_flow"]["state_version"], got, want)
    c.clock("2026-09-30T09:10:00Z")
    ex = c.call("createRealityExecution", p, got_from(api["createRealityExecution"]["request"], want, got))
    assert ex["status"] == 202, ex
    got.add(ex["data"]["execution_id"], "reality-execution")
    got.add(ex["data"]["job_id"], "reality-job")
    c.drain()
    exe = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    got.add(exe["result_pack_id"], "source-pack")
    for qa in exe.get("question_assessments", []):
        pass
    assert_same(exe, cf["draftless_flow"]["reality_execution"], got, want)
    for i, s in enumerate(subs):
        assert_same(c.call("getEvidenceSubmission", {**p, "submission_id": s["id"]})["data"], cf["draftless_flow"]["submissions"][i], got, want)
    c.clock("2026-09-30T09:10:10Z")
    br = c.call("createEditorialBrief", p, got_from(api["createEditorialBrief"]["request"], want, got))
    assert br["status"] == 201, br
    name_view(got, "brief", br["data"]["brief"])
    assert_same(br["data"]["brief"], cf["draftless_flow"]["brief"], got, want)
    task_req = got_from(mw["source_initial"]["task_create"]["request"], want, got)
    task = c.call("createReportingTask", p, task_req)
    assert task["status"] == 201, task
    got.add(task["data"]["task"]["id"], "source-task")
    assert_same(task["data"]["task"], cf["draftless_flow"]["task"], got, want)
    bad = c.call("createReportingTask", p, {**task_req, "assertion_ids": [review_first_assertion(c, p, rv)]})
    assert bad["status"] == 422

    # the report snapshot of the Brief is the pack's example
    xp = c.call("createEditorialExport", p, {"input_kind": "BRIEF", "input_id": br["data"]["brief"]["id"], "format": "JSON"})
    c.drain()
    f = c.call("downloadEditorialExport", {**p, "export_id": xp["data"]["export_id"]})
    snapshot = json.loads(f["binary"].decode())
    assert snapshot["review"] is None
    want_snap = json.loads(json.dumps(snap_example))
    assert_same(snapshot, want_snap, got, want)

    # follow-up without a draft: result -> child execution -> new pinned Brief
    c.clock("2026-10-02T09:00:00Z")
    s6 = c.call("createEvidenceSubmission", p, sub_body("S6"))["data"]["submission"]
    s7 = c.call("createEvidenceSubmission", p, sub_body("S7"))["data"]["submission"]
    got.add(s6["id"], "sub:S6")
    got.add(s7["id"], "sub:S7")
    c.clock("2026-10-02T09:05:00Z")
    res = c.call("createReportingResult", p, got_from(mw["source_followup"]["requests"][0]["request"], want, got))
    assert res["status"] == 201, res
    got.add(res["data"]["result"]["id"], "source-result")
    assert_same(res["data"]["result"], mw["source_followup"]["result_snapshot"], got, want)
    c.clock("2026-10-02T10:00:00Z")
    ex2 = c.call("createRealityExecution", p, got_from(mw["source_followup"]["requests"][1]["request"], want, got))
    assert ex2["status"] == 202, ex2
    c.drain()
    e2 = c.call("getRealityExecution", {**p, "execution_id": ex2["data"]["execution_id"]})["data"]
    w = mw["source_followup"]["expected"]
    assert e2["status"] == "COMPLETED", e2
    got.add(e2["result_pack_id"], "source-child-pack")
    assert want.map[w["result_pack_id"]] == "source-child-pack"
    assert e2["baseline_pack_id"] == exe["result_pack_id"] and e2["content_version_id"] is None
    br2_req = got_from(mw["source_followup"]["requests"][2]["request"], want, got)
    br2 = c.call("createEditorialBrief", p, br2_req)["data"]["brief"]
    assert br2["reality_pack_id"] == e2["result_pack_id"]
    known = [got.map[i["claim_ids"][0]] for i in next(s for s in br2["sections"] if s["section"] == "WHAT_WE_KNOW")["items"]]
    assert known == w["known_claim_keys"]
    qk = {q["id"]: q["question_key"] for q in br2["questions"]}
    by_key = {qk[a["question_id"]]: a for a in br2["question_assessments"]}
    assert {k: a["status"] for k, a in by_key.items()} == w["question_statuses"]
    assert by_key["U1a"]["calculation"]["exact_percent"] == w["exact_percent"]
    assert by_key["U1a"]["calculation"]["display_percent"] == w["display_percent"]
    assert_same(c.call("getEditorialBrief", {**p, "brief_id": br["data"]["brief"]["id"]})["data"], cf["draftless_flow"]["brief"], got, want)
    assert c.problems == []


def review_first_assertion(c, p, rv):
    return c.call("getDraftReview", {**p, "review_id": rv["data"]["review_id"]})["data"]["items"][0]["assertion_id"]


def test_question_only_mode_ends_in_a_brief(client):
    c = client
    q = mw["question_only"]
    c.clock("2026-09-30T09:00:00Z")
    intake = c.call("createCaseIntake", body=q["requests"][0]["request"])
    assert intake["status"] == 201 and intake["data"]["content_version_id"] is None
    p = {"case_id": intake["data"]["case_id"]}
    ex = c.call("createRealityExecution", p, {**q["requests"][1]["request"], "state_version_id": intake["data"]["state_version_id"]})
    assert ex["status"] == 202, ex
    c.drain()
    exe = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    assert exe["status"] == "COMPLETED"
    brief = c.call("createEditorialBrief", p, {**q["requests"][2]["request"], "state_version_id": intake["data"]["state_version_id"],
                                               "reality_pack_id": exe["result_pack_id"]})["data"]["brief"]
    assert [s["section"] for s in brief["sections"]] == q["expected"]["brief_sections"]
    assert brief["content_version_id"] is None
    x1 = c.fx.fid({"id": p["case_id"]}, FX["conflict"]["conflict_id"])
    task = c.call("createReportingTask", p, {"brief_id": brief["id"], "review_id": None, "title": "확인", "questions": ["질문"],
                                             "assertion_ids": [], "conflict_ids": [x1], "unknown_ids": [], "assignee_id": None})
    assert task["status"] == 201 and task["data"]["task"]["brief_id"] == brief["id"] and task["data"]["task"]["content_version_id"] is None
    assert c.call("createCaseIntake", body={**q["requests"][0]["request"], "draft": "초안"})["error"]["code"] == "MODE_INPUT_INVALID"
    assert c.call("createCaseIntake", body={"mode": "DRAFT_REVIEW", "title": "t", "question": "q", "as_of": "2026-09-30T09:00:00Z"})["error"]["code"] == "MODE_INPUT_INVALID"
    src = c.call("createCaseIntake", body={**q["requests"][0]["request"], "mode": "SOURCE_REVIEW"})
    ns = c.call("createRealityExecution", {"case_id": src["data"]["case_id"]},
                {"mode": "SOURCE_REVIEW", "state_version_id": src["data"]["state_version_id"], "as_of": "2026-09-30T09:00:00Z"})
    assert ns["status"] == 422 and ns["error"]["code"] == "MODE_INPUT_INVALID"
    assert c.problems == []


def test_input_rules_scope_and_policy_refusals(client):
    c = client
    base = api["createCaseIntake"]["request"]
    c.clock("2026-09-30T09:00:00Z")

    def bad(body, code="INPUT_INVALID"):
        r = c.call("createCaseIntake", body=body)
        assert r["error"]["code"] == code, r
        return r
    bad({**base, "title": "   "})
    bad({**base, "title": "x" * 301})
    bad({**base, "question": ""})
    bad({**base, "as_of": "2026-09-30T09:00:00"})
    bad({**base, "extra": 1})
    bad({**base, "draft": "가" * 50001})
    assert c.call("createCaseIntake", body={**base, "draft": "가" * 50000})["status"] == 201
    nokey = c.client.eng.call("createCaseIntake", actor=c.client.eng.members()[0], params={"workspace_id": c.client.eng.WS}, body=base, key=None)
    assert nokey["status"] == 422
    assert c.client.eng.call("createCaseIntake", actor=None, params={"workspace_id": c.client.eng.WS}, body=base, key="x")["status"] == 401
    assert c.call("listCases", {"workspace_id": "00000000-0000-4000-8000-000000000000"})["status"] == 403

    ids, p, exec_, rv, _ = draft_through_review(c)
    c.drain()
    other = c.call("createCaseIntake", body={**base, "title": "다른 기획"})["data"]
    cross = c.call("getDraftReview", {"case_id": other["case_id"], "review_id": rv["data"]["review_id"]})
    assert cross["status"] == 404 and cross["error"]["code"] == "RESOURCE_NOT_FOUND"
    assert c.call("appendCaseIntake", p, {**base, "title": "다른 제목"})["error"]["code"] == "CASE_TITLE_MISMATCH"
    assert c.call("appendCaseIntake", p, {**base, "title": "  " + base["title"].replace(" ", "   ", 1) + " "})["status"] == 201

    def sub(**o):
        return c.call("createEvidenceSubmission", p, {**sub_body("S6"), **o})
    c.clock("2026-10-02T09:00:00Z")
    assert sub(rights_class="UNKNOWN")["error"]["code"] == "METADATA_ONLY_BODY_FORBIDDEN"
    meta = sub(rights_class="UNKNOWN", body=None)
    assert meta["status"] == 201 and meta["data"]["submission"]["access_mode"] == "METADATA_ONLY"
    assert meta["data"]["submission"]["content_version_id"] is None and meta["data"]["submission"]["body_sha256"] is None
    assert sub(rights_class="LICENSED_FULL_TEXT")["error"]["code"] == "SOURCE_POLICY_BLOCKED"
    assert sub(sensitivity="INTERNAL")["status"] == 403
    assert sub(transcript_locator="공개 회의록 3쪽")["status"] == 422
    assert sub(source_url=None)["status"] == 422
    assert sub(source_url="http://fixture.example/s6")["status"] == 422
    assert sub(recorded_at="2026-10-05T00:00:00Z")["status"] == 422
    assert sub(body="가" * 200001)["status"] == 422
    before = c.call("getCase", p)["data"]["head"]["content_version_id"]
    assert sub()["status"] == 201
    assert c.call("getCase", p)["data"]["head"]["content_version_id"] == before
    own = sub(source_url="https://example.org/own", body="직접 쓴 자료다.")
    assert own["status"] == 201
    head = c.call("getCase", p)["data"]["head"]
    blocked = c.call("createRealityExecution", p, {"mode": "DRAFT_REVIEW", "state_version_id": head["state_version_id"],
                                                   "content_version_id": head["content_version_id"], "baseline_pack_id": exec_["result_pack_id"],
                                                   "submission_ids": [own["data"]["submission"]["id"]], "as_of": "2026-10-02T10:00:00Z"})
    assert blocked["status"] == 503 and blocked["error"]["code"] == "CONFIGURATION_BLOCKED"
    assert c.problems == []


def test_partial_collection_faults_branches_and_late_workers():
    from tests.conftest import Checked
    # partial collection needs an explicit opt-in
    c = Checked(Client())
    c.fx.gateway["collect"] = "PARTIAL"
    c.clock("2026-09-30T09:00:00Z")
    intake = c.call("createCaseIntake", body=api["createCaseIntake"]["request"])["data"]
    p = {"case_id": intake["case_id"]}
    body = {"mode": "DRAFT_REVIEW", "state_version_id": intake["state_version_id"], "content_version_id": intake["content_version_id"],
            "as_of": "2026-09-30T09:00:00Z"}
    ex = c.call("createRealityExecution", p, body)
    c.drain()
    e = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    assert e["status"] == "FAILED" and e["result_pack_id"] is None and e["error_code"] == "PARTIAL_SOURCE_COLLECTION"
    ex = c.call("createRealityExecution", p, {**body, "allow_partial": True})
    c.drain()
    e = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    assert e["status"] == "PARTIAL", e
    rvb = {"content_version_id": intake["content_version_id"], "state_version_id": intake["state_version_id"], "reality_pack_id": e["result_pack_id"]}
    refused = c.call("createDraftReview", p, rvb)
    assert refused["status"] == 409 and refused["error"]["code"] == "REVIEW_PARTIAL_NOT_ALLOWED"
    rv = c.call("createDraftReview", p, {**rvb, "allow_partial": True})
    c.drain()
    partial = c.call("getDraftReview", {**p, "review_id": rv["data"]["review_id"]})["data"]
    want_p = st["review_PARTIAL"]
    assert partial["status"] == "PARTIAL"
    assert [i["status"] for i in partial["items"]] == [i["status"] for i in want_p["items"]]
    assert [w["code"] for w in partial["warnings"]] == [w["code"] for w in want_p["warnings"]]
    assert c.problems == []

    # the model proposes, the server verifies
    for fault, code in (("BAD_CLAIM", "REVIEW_REFERENCE_INVALID"), ("BAD_OFFSET", "REVIEW_OUTPUT_INVALID")):
        c = Checked(Client())
        c.fx.gateway["review"] = fault
        ids, p2, exec_, rv, _ = draft_through_review(c)
        c.drain()
        g = c.call("getDraftReview", {**p2, "review_id": rv["data"]["review_id"]})["data"]
        assert g["status"] == "FAILED" and g["error_code"] == code and g["items"] == [] and g["completed_at"] is not None, g
        assert c.call("getCase", p2)["data"]["head"]["review_id"] is None
        assert c.problems == []

    # two reassessments of one baseline: both kept, head moves once
    c = Checked(Client())
    ids, p, exec_, rv, _ = draft_through_review(c)
    c.drain()
    review01 = c.call("getDraftReview", {**p, "review_id": rv["data"]["review_id"]})["data"]
    want = fixture_symbols()
    got = symbols_for(c, ids)
    got.add(review01["id"], "review01")
    name_view(got, "review01", review01)
    task = c.call("createReportingTask", p, got_from(api["createReportingTask"]["request"], want, got))["data"]["task"]
    c.clock("2026-10-02T09:00:00Z")
    s6 = c.call("createEvidenceSubmission", p, sub_body("S6"))["data"]["submission"]
    s7 = c.call("createEvidenceSubmission", p, sub_body("S7"))["data"]["submission"]
    c.clock("2026-10-02T09:05:00Z")
    u1 = c.fx.fid({"id": p["case_id"]}, FX["unknown"]["unknown_id"])
    res = c.call("createReportingResult", p, {"task_id": task["id"], "submission_ids": [s6["id"], s7["id"]],
                                              "note": "경쟁 확대가 원인이라고 들었다.", "question_ids": [u1]})["data"]["result"]
    c.clock("2026-10-02T10:00:00Z")
    rb = {"baseline_review_id": review01["id"], "reporting_result_ids": [res["id"]], "as_of": "2026-10-02T10:00:00Z", "allow_partial": False}
    ra = c.call("createReassessment", p, rb, key="re-a")
    rb_ = c.call("createReassessment", p, rb, key="re-b")
    assert ra["data"]["resource_id"] != rb_["data"]["resource_id"]
    c.drain()
    a = c.call("getReassessment", {**p, "reassessment_id": ra["data"]["resource_id"]})["data"]
    b = c.call("getReassessment", {**p, "reassessment_id": rb_["data"]["resource_id"]})["data"]
    assert a["head_updated"] is True and b["head_updated"] is False and b["status"] == "COMPLETED"
    assert [w["code"] for w in b["warnings"]] == [w["code"] for w in st["reassessment_BRANCH_ONLY"]["warnings"]]
    assert a["result_review_id"] != b["result_review_id"]
    assert c.call("getCase", p)["data"]["head"]["review_id"] == a["result_review_id"]
    assert c.call("getDraftReview", {**p, "review_id": b["result_review_id"]})["data"]["items"][1]["status"] == "CONTRADICTED"
    k1 = [i["assertion_key"] for i in review01["items"]]
    k2 = [i["assertion_key"] for i in c.call("getDraftReview", {**p, "review_id": b["result_review_id"]})["data"]["items"]]
    assert k1 == k2
    close_a = c.call("updateReportingTask", {**p, "task_id": task["id"]}, {"status": "DONE", "reason": "확인"}, if_match='"1"')
    close_b = c.call("updateReportingTask", {**p, "task_id": task["id"]}, {"status": "CANCELLED", "reason": "중복"}, who="b", if_match='"1"')
    assert close_a["status"] == 200 and close_b["status"] == 409 and close_b["error"]["code"] == "TASK_VERSION_CONFLICT"
    assert c.call("updateReportingTask", {**p, "task_id": task["id"]}, {"status": "CANCELLED", "reason": "다시"}, if_match='"2"')["status"] == 409
    assert c.call("updateReportingTask", {**p, "task_id": task["id"]}, {"status": "DONE", "reason": "확인"})["status"] == 422
    assert c.call("createReportingResult", p, {"task_id": task["id"], "submission_ids": [s6["id"]], "question_ids": [u1]})["status"] == 201
    t2 = c.call("createReportingTask", p, {**got_from(api["createReportingTask"]["request"], want, got), "title": "두 번째 과제"})["data"]["task"]
    c.call("updateReportingTask", {**p, "task_id": t2["id"]}, {"status": "CANCELLED", "reason": "불필요"}, if_match='"1"')
    assert c.call("createReportingResult", p, {"task_id": t2["id"], "submission_ids": [s6["id"]], "question_ids": [u1]})["error"]["code"] == "TASK_CANCELLED"
    ra_review = c.call("getDraftReview", {**p, "review_id": a["result_review_id"]})["data"]
    assert "원인이라고 들었다" not in json.dumps(ra_review, ensure_ascii=False)
    assert ra_review["items"][1]["subchecks"][1]["status"] == "INSUFFICIENT_EVIDENCE"
    assert c.problems == []

    # a late worker cannot overwrite a newer active input
    c = Checked(Client())
    c.clock("2026-09-30T09:00:00Z")
    intake = c.call("createCaseIntake", body=api["createCaseIntake"]["request"])["data"]
    p = {"case_id": intake["case_id"]}
    ex = c.call("createRealityExecution", p, {"mode": "DRAFT_REVIEW", "state_version_id": intake["state_version_id"],
                                              "content_version_id": intake["content_version_id"], "as_of": "2026-09-30T09:00:00Z"})
    c.drain()
    e = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    late = c.call("createDraftReview", p, {"content_version_id": intake["content_version_id"], "state_version_id": intake["state_version_id"],
                                           "reality_pack_id": e["result_pack_id"]})
    v2 = c.call("appendCaseIntake", p, {**api["createCaseIntake"]["request"], "draft": cf["draft"] + "\n덧붙인 문장이다."})["data"]
    c.drain()
    lr = c.call("getDraftReview", {**p, "review_id": late["data"]["review_id"]})["data"]
    assert lr["status"] == "COMPLETED" and lr["content_version_id"] == intake["content_version_id"]
    assert any(w["code"] == "BRANCH_ONLY" for w in lr["warnings"])
    head = c.call("getCase", p)["data"]["head"]
    assert head["content_version_id"] == v2["content_version_id"] and head["review_id"] is None and head["row_version"] == 2
    v2r = c.call("createDraftReview", p, {"content_version_id": v2["content_version_id"], "state_version_id": v2["state_version_id"],
                                          "reality_pack_id": e["result_pack_id"]})
    assert v2r["status"] == 503
    assert c.problems == []


def test_as_of_keeps_later_material_out(client):
    c = client
    c.clock("2026-09-29T09:00:00Z")
    intake = c.call("createCaseIntake", body={**api["createCaseIntake"]["request"], "as_of": "2026-09-29T09:00:00Z"})["data"]
    p = {"case_id": intake["case_id"]}
    ex = c.call("createRealityExecution", p, {"mode": "DRAFT_REVIEW", "state_version_id": intake["state_version_id"],
                                              "content_version_id": intake["content_version_id"], "as_of": "2026-09-29T09:00:00Z"})
    c.drain()
    e = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    board = c.call("getRealityBoard", {**p, "pack_id": e["result_pack_id"]})["data"]
    assert board["what_we_know"] == []
    assert all(s["excluded_reason"] == "AFTER_AS_OF" for s in board["sources"] if s["key"] != "S5")
    rv = c.call("createDraftReview", p, {"content_version_id": intake["content_version_id"], "state_version_id": intake["state_version_id"],
                                         "reality_pack_id": e["result_pack_id"]})
    c.drain()
    r = c.call("getDraftReview", {**p, "review_id": rv["data"]["review_id"]})["data"]
    assert [i["status"] for i in r["items"]] == ["INSUFFICIENT_EVIDENCE"] * 3
    assert c.problems == []


def test_ledger_lists_everything_a_browser_follows(client):
    c = client
    ids, p, exec_, rv, _ = draft_through_review(c)
    c.drain()
    led = c.call("getCaseLedger", p)["data"]
    assert led["execution"] == [exec_["id"]] and led["review"] == [rv["data"]["review_id"]]
    assert led["modes"][ids["state_version_id"]] == "DRAFT_REVIEW"
    assert led["corr"][exec_["id"]] and led["demo"] is True
