"""The real pipeline end to end, with the OpenAI client and page fetches replaced
by recorded answers. Checks what the server itself guarantees: quotes are
located verbatim, numbers are recomputed, references are resolved, rights are
applied, and the review passes the same validation as the demo."""
import json
from types import SimpleNamespace

import pytest

from app.auth import Accounts
from app.config import Settings
from app.engine import Engine
from app.providers import openai_provider as op
from app.providers.fixture import FixtureProvider
from app.store import Store
from app.util import uuid_from
from tests.conftest import Checked

WS = uuid_from("live-ws")
ACTOR = {"actor_id": uuid_from("live-a"), "name": "기자 A", "role": "EDITOR", "active": True}
DEMO = {"actor_id": uuid_from("live-d"), "name": "시연", "role": "EDITOR", "active": True, "demo_only": True}

DRAFT = ("가상시는 올해 청년 월세 지원 대상자를 3000명으로 늘렸다.\n"
         "지원 확대 덕분에 청년 주거비 부담이 전년보다 30% 줄었다.\n"
         "청년 정책은 더 과감해져야 한다.")
PAGE_A = ("가상시 보도자료 2026.9.1\n가상시는 2026년 청년 월세 지원 대상자를 3000명으로 확대한다고 밝혔다. "
          "지원 금액은 1인당 월 20만 원이다.\n문의: 청년정책과")
PAGE_B = ("가상시 청년 주거비 실태조사 결과\n2025년 청년 1인 가구 월평균 주거비는 50만 원이었다. "
          "2026년 같은 조사에서 월평균 주거비는 45만 원으로 나타났다. 조사 범위와 방법은 2025년과 같다.")
URL_A = "https://www.gasang.go.kr/news/1"
URL_B = "https://www.gasang.go.kr/stat/2"
URL_NEWS = "https://news.example.com/article/9"


class FakeResponses:
    """Answers responses.create by stage name, like the real API would."""

    def __init__(self):
        self.calls = []

    def create(self, **kw):
        self.calls.append(kw)
        if kw.get("tools"):
            tool = kw["tools"][0]
            blocked = (tool.get("filters") or {}).get("blocked_domains")
            if blocked:
                out = [{"type": "web_search_call", "action": {"type": "search", "query": "가상시 청년 월세 기사", "sources": [{"type": "url", "url": URL_NEWS}]}},
                       {"type": "message", "content": [{"type": "output_text", "text": "기사", "annotations": [
                           {"type": "url_citation", "url": URL_NEWS, "title": "청년 월세 지원 늘어", "start_index": 0, "end_index": 2}]}]}]
            else:
                out = [{"type": "web_search_call", "action": {"type": "search", "query": "가상시 청년 월세 지원 대상자 보도자료",
                                                             "sources": [{"type": "url", "url": URL_A}, {"type": "url", "url": URL_B}]}},
                       {"type": "message", "content": [{"type": "output_text", "text": "자료", "annotations": [
                           {"type": "url_citation", "url": URL_A + "?utm_source=openai", "title": "가상시 보도자료", "start_index": 0, "end_index": 2}]}]}]
            return SimpleNamespace(output_text="", model_dump=lambda: {"output": out})
        name = kw["text"]["format"]["name"]
        if name == "ping":
            return SimpleNamespace(output_text='{"ok": true}')
        user = json.loads(kw["input"])
        if name == "claims":
            body = user["원문"]["본문"]
            if "보도자료" in body:
                claims = [{"quote": "가상시는 2026년 청년 월세 지원 대상자를 3000명으로 확대한다고 밝혔다.",
                           "statement": "가상시 보도자료는 2026년 청년 월세 지원 대상자를 3000명으로 확대한다고 밝혔다.", "scope": "2026 청년 월세 지원", "amount": None},
                          {"quote": "이 문장은 원문에 없다.", "statement": "지어낸 진술", "scope": None, "amount": None}]
            else:
                claims = [{"quote": "2025년 청년 1인 가구 월평균 주거비는 50만 원이었다.", "statement": "실태조사에 따르면 2025년 청년 1인 가구 월평균 주거비는 500000원이다.",
                           "scope": "청년 1인 가구 월평균 주거비", "amount": {"value": 500000, "unit": "KRW", "period": 2025}},
                          {"quote": "2026년 같은 조사에서 월평균 주거비는 45만 원으로 나타났다.", "statement": "실태조사에 따르면 2026년 같은 범위 월평균 주거비는 450000원이다.",
                           "scope": "청년 1인 가구 월평균 주거비", "amount": {"value": 450000, "unit": "KRW", "period": 2026}},
                          {"quote": "조사 범위와 방법은 2025년과 같다.", "statement": "실태조사는 2025년과 같은 범위와 방법으로 했다.", "scope": None,
                           "amount": {"value": 999, "unit": "KRW", "period": 2025}}]
            return SimpleNamespace(output_text=json.dumps({"claims": claims}, ensure_ascii=False))
        if name == "synthesis":
            keys = [c["key"] for c in user["근거 진술"]]
            f = {"materiality": 0.8, "novelty": 0.5, "verifiability": 0.8, "evidence_integrity": 0.7, "urgency": 0.2}
            res = {"superseded": [], "conflicts": [],
                   "unknowns": [{"key": "U1", "question": "주거비 감소가 지원 확대 때문인가", "top_question": "주거비 변화와 지원 확대의 인과를 확인할 수 있는가",
                                 "why_important": "기사의 인과 주장이 결론을 좌우한다.", "needed_evidence": "지원 수혜자와 비수혜자의 주거비 비교",
                                 "needed_list": ["수혜자·비수혜자 주거비 비교"], "public_search_possible": True, "human_reporting_needed": True,
                                 "sub_questions": [{"key": "U1a", "question": "같은 범위 주거비는 얼마나 변했는가"},
                                                   {"key": "U1b", "question": "지원 확대가 주거비 변화의 원인인가"}], "factors": f}],
                   "assessments": [{"question": "U1a", "status": "RESOLVED", "resolution": [keys[1], keys[2]], "reason": "같은 조사 범위의 두 해 수치가 있다.",
                                    "needed_evidence": [], "calculation": {"previous": keys[1], "current": keys[2], "excluded": None}},
                                   {"question": "U1b", "status": "OPEN", "resolution": [], "reason": "인과 근거가 없다.", "needed_evidence": ["인과 분석"],
                                    "calculation": None}],
                   "actions": [{"question": "U1b", "action": "수혜자와 비수혜자의 주거비 변화 비교 자료를 요청한다.", "ask_role": "청년정책 담당 부서"}],
                   "claim_factors": [{"claim": k, **f} for k in keys] + [{"claim": "C99", **f}]}
            return SimpleNamespace(output_text=json.dumps(res, ensure_ascii=False))
        if name == "kinds":
            kinds = {0: "FACTUAL", 1: "CAUSAL", 2: "NON_FACTUAL"}
            return SimpleNamespace(output_text=json.dumps({"items": [{"id": s["id"], "kind": kinds.get(i, "FACTUAL")} for i, s in enumerate(user["문장"])]}))
        if name == "verdicts":
            keys = [c["key"] for c in user["근거 진술"]]
            items = []
            for s in user["판정할 문장"]:
                if "3000명" in s["text"]:
                    items.append({"id": s["id"], "status": "SUPPORTED", "supporting": [keys[0]], "contradicting": [], "related": [], "conflicts": [],
                                  "unknowns": [], "reason_codes": ["DIRECT_SUPPORT"], "recommendation": "보도자료 출처를 밝혀 쓴다.", "needed_evidence": [],
                                  "numeric": None, "causal": None})
                else:
                    items.append({"id": s["id"], "status": "SUPPORTED", "supporting": [keys[1], "C77"], "contradicting": [], "related": [],
                                  "conflicts": ["X9"], "unknowns": ["U1"], "reason_codes": ["NUMERIC_CLAIM_CONTRADICTED", "BOGUS"],
                                  "recommendation": "같은 범위 수치는 10% 감소다. 인과는 보류한다.", "needed_evidence": ["인과 분석"],
                                  "numeric": {"expected_percent": "30", "previous": keys[1], "current": keys[2], "excluded": None},
                                  "causal": {"status": "SUPPORTED", "supporting": [], "contradicting": [], "needed_evidence": ["인과 분석"]}})
            return SimpleNamespace(output_text=json.dumps({"items": items}, ensure_ascii=False))
        if name == "ping":
            return SimpleNamespace(output_text='{"ok": true}')
        raise AssertionError(f"unexpected stage {name}")


def fake_fetch(url, domains, timeout=15):
    pages = {URL_A: PAGE_A, URL_B: PAGE_B}
    if url not in pages:
        return {"ok": False, "url": url, "final_url": url, "title": "", "site": "", "text": "", "published_at": None,
                "content_type": "", "error": "HTTP_404"}
    return {"ok": True, "url": url, "final_url": url, "title": "가상시 " + ("보도자료" if url == URL_A else "실태조사"), "site": "가상시",
            "text": pages[url], "published_at": "2026-09-01T00:00:00Z", "content_type": "text/html", "error": None}


@pytest.fixture
def live(monkeypatch):
    monkeypatch.setattr(op, "fetch_document", fake_fetch)
    store = Store(None)
    accounts = Accounts(store)
    s = Settings()
    s.openai_api_key = "sk-test"
    s.related_search = True
    prov = op.OpenAIProvider(s, accounts)
    fake = FakeResponses()
    prov._client = SimpleNamespace(responses=fake)
    eng = Engine(store, workspace_id=WS, providers={"fixture": FixtureProvider(0), "openai": prov}, settings=s)
    eng.member_source = lambda: [ACTOR]
    from tests.helpers import fake_renderers
    eng.renderers = fake_renderers()

    class C:
        pass
    c = C()
    c.eng, c.store, c.prov, c.fake, c.problems = eng, store, prov, fake, []

    def call(op_, params=None, body=None, actor=ACTOR, key="auto", if_match=None):
        from app.engine import ALL_OPS
        if key == "auto":
            key = None if ALL_OPS[op_]["method"] != "POST" else f"k{len(c.fake.calls)}-{op_}-{json.dumps(body, sort_keys=True)[:40]}"
        return eng.call(op_, actor=actor, params={"workspace_id": WS, **(params or {})}, body=body, key=key, if_match=if_match)
    c.call = call
    return c


def test_real_pipeline_reviews_a_draft_against_public_records(live):
    c = live
    checked = Checked(SimpleNamespace(call=lambda op_, params=None, body=None, who=None, key=None, if_match=None: c.call(op_, params, body)))
    intake = c.call("createCaseIntake", body={"mode": "DRAFT_REVIEW", "title": "가상시 청년 월세 지원 점검", "question": "지원 확대로 주거비가 줄었다고 쓸 수 있는가",
                                              "as_of": "2026-10-10T00:00:00Z", "draft": DRAFT})
    assert intake["status"] == 201, intake
    ids = intake["data"]
    p = {"case_id": ids["case_id"]}
    assert c.store.get("cases", ids["case_id"])["provider"] == "openai"
    # a demo account cannot spend the newsroom's model budget
    blocked = c.call("createRealityExecution", p, {"mode": "DRAFT_REVIEW", "state_version_id": ids["state_version_id"],
                                                   "content_version_id": ids["content_version_id"], "as_of": "2026-10-10T00:00:00Z"}, actor=DEMO)
    assert blocked["status"] == 403 and blocked["error"]["code"] == "DEMO_ACCOUNT_LIMITED"
    ex = c.call("createRealityExecution", p, {"mode": "DRAFT_REVIEW", "state_version_id": ids["state_version_id"],
                                              "content_version_id": ids["content_version_id"], "as_of": "2026-10-10T00:00:00Z"})
    assert ex["status"] == 202, ex
    c.eng.drain()
    e = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    assert e["status"] == "COMPLETED", e
    board = c.call("getRealityBoard", {**p, "pack_id": e["result_pack_id"]})["data"]
    texts = [x["text"] for x in board["what_we_know"]]
    assert len(texts) == 4 and not any("지어낸" in t for t in texts)          # an invented quote never becomes a claim
    amounts = [x["amount"] for x in board["what_we_know"]]
    assert {"value": 500000, "unit": "KRW", "period": 2025} in amounts
    assert all(a is None or a["value"] != 999 for a in amounts)               # an amount not written in the passage is dropped
    news = next(s for s in board["sources"] if s["url"] == URL_NEWS)
    assert news["included"] is False and news["excluded_reason"] == "RIGHTS" and news["rights_class"] == "UNKNOWN"
    assert any(w["code"] == "SOURCE_RIGHTS_EXCLUDED" for w in e["warnings"])
    assert next(s for s in board["sources"] if s["url"] == URL_A)["family"] == "가상시"
    # the trace shows the exact passage inside the stored page
    claim = board["what_we_know"][0]
    tr = c.call("getEvidenceTrace", {**p, "pack_id": e["result_pack_id"], "claim_id": claim["claim_id"]})["data"]
    t0 = tr["traces"][0]
    assert t0["revision"]["body"][t0["passage"]["start"]:t0["passage"]["end"]] == t0["passage"]["text"]
    assert t0["passage"]["text"] in PAGE_A
    # questions: the parent rolls up from its children on the server
    q = {x["question_key"]: x for x in c.store.get("packs", e["result_pack_id"])["synthesis"]["questions"]}
    a = {x["question_id"]: x for x in c.store.get("executions", e["id"])["question_assessments"]}
    assert a[q["U1a"]["id"]]["status"] == "RESOLVED" and a[q["U1b"]["id"]]["status"] == "OPEN"
    assert a[q["U1"]["id"]]["status"] == "PARTIALLY_RESOLVED"
    calc = a[q["U1a"]["id"]]["calculation"]
    assert calc["exact_percent"] == "10" and calc["display_percent"] == "10.00"

    rv = c.call("createDraftReview", p, {"content_version_id": ids["content_version_id"], "state_version_id": ids["state_version_id"],
                                         "reality_pack_id": e["result_pack_id"]})
    assert rv["status"] == 202, rv
    c.eng.drain()
    r = c.call("getDraftReview", {**p, "review_id": rv["data"]["review_id"]})["data"]
    assert r["status"] == "COMPLETED", r
    assert [i["status"] for i in r["items"]] == ["SUPPORTED", "CONTRADICTED", "NON_FACTUAL"]
    a2 = r["items"][1]
    numeric = a2["subchecks"][0]
    assert numeric["kind"] == "NUMERIC" and numeric["status"] == "CONTRADICTED"
    assert numeric["expected_percent"] == "30" and numeric["observed_percent"] == "10"
    assert numeric["calculation"]["previous_amount"] == 500000 and numeric["calculation"]["current_amount"] == 450000
    causal = a2["subchecks"][1]
    assert causal["kind"] == "CAUSAL" and causal["status"] == "INSUFFICIENT_EVIDENCE"   # "SUPPORTED" without support is not accepted
    assert a2["supporting_claim_ids"] == [] and a2["contradicting_claim_ids"]
    assert a2["conflict_ids"] == [] and a2["reason_codes"] == ["NUMERIC_CLAIM_CONTRADICTED"]
    assert r["items"][2]["reason_codes"] == ["NON_FACTUAL_TEXT"]
    for it in r["items"]:
        assert DRAFT[it["start"]:it["end"]] == it["text"]
    assert c.call("getCase", p)["data"]["head"]["review_id"] == r["id"]
    # every model call asked for a strict schema and none stored the conversation
    model_calls = [k for k in c.fake.calls if not k.get("tools")]
    assert model_calls and all(k["text"]["format"]["strict"] is True and k["store"] is False for k in model_calls)
    search_calls = [k for k in c.fake.calls if k.get("tools")]
    assert search_calls[0]["tools"][0]["filters"]["allowed_domains"] == ["go.kr", "korea.kr", "kosis.kr"]
    assert "web_search_call.action.sources" in search_calls[0]["include"]
    # usage is metered per day
    used = Accounts(c.store).usage_today()
    assert used["model_calls"] >= 4 and used["search_calls"] == 2


def test_real_pipeline_refuses_without_a_key(live):
    c = live
    c.prov.s.openai_api_key = ""
    intake = c.call("createCaseIntake", body={"mode": "QUESTION_ONLY", "title": "다른 기획", "question": "무엇을 확인할 수 있는가", "as_of": "2026-10-10T00:00:00Z"})
    ids = intake["data"]
    ex = c.call("createRealityExecution", {"case_id": ids["case_id"]}, {"mode": "QUESTION_ONLY", "state_version_id": ids["state_version_id"],
                                                                        "as_of": "2026-10-10T00:00:00Z"})
    assert ex["status"] == 503 and ex["error"]["code"] == "CONFIGURATION_BLOCKED"


def test_source_review_with_pasted_text_and_research_search(live):
    c = live
    intake = c.call("createCaseIntake", body={"mode": "SOURCE_REVIEW", "title": "가상시 주거비 자료 검토", "question": "주거비가 줄었는가",
                                              "as_of": "2026-10-10T00:00:00Z"})
    ids = intake["data"]
    p = {"case_id": ids["case_id"]}
    c.eng.clock_ms = 1791000000000  # 2026-10-03
    sub = c.call("createEvidenceSubmission", p, {"title": "실태조사", "source_url": URL_B, "transcript_locator": None, "body": PAGE_B,
                                                 "recorded_at": "2026-09-01T00:00:00Z", "sensitivity": "PUBLIC", "rights_class": "OPEN"})
    assert sub["status"] == 201, sub
    ex = c.call("createRealityExecution", p, {"mode": "SOURCE_REVIEW", "state_version_id": ids["state_version_id"],
                                              "submission_ids": [sub["data"]["submission"]["id"]], "as_of": "2026-10-10T00:00:00Z"})
    assert ex["status"] == 202, ex
    c.eng.drain()
    e = c.call("getRealityExecution", {**p, "execution_id": ex["data"]["execution_id"]})["data"]
    assert e["status"] == "COMPLETED", e
    assert not [k for k in c.fake.calls if k.get("tools")]           # source review does not search
    br = c.call("createEditorialBrief", p, {"state_version_id": ids["state_version_id"], "reality_pack_id": e["result_pack_id"]})
    assert br["status"] == 201, br
    b = br["data"]["brief"]
    assert [s["section"] for s in b["sections"]] == ["DECISION", "WHAT_WE_KNOW", "WHAT_IS_DISPUTED", "WHAT_IS_STILL_UNKNOWN", "STRONG_COUNTER_FRAMES"]
    assert all("NOT_AUDIENCE_PREDICTION" in it["labels"] for it in b["sections"][4]["items"])
    q = next(x for x in b["questions"] if x["question_key"] == "U1b")
    sr = c.call("createResearchSearch", p, {"baseline_pack_id": e["result_pack_id"], "question_id": q["id"], "question": q["question"],
                                            "as_of": "2026-10-10T00:00:00Z"})
    assert sr["status"] == 202, sr
    c.eng.drain()
    s = c.call("getResearchSearch", {**p, "search_id": sr["data"]["search_id"]})["data"]
    assert s["status"] == "COMPLETED", s
    assert len(s["new_submission_ids"]) == 1                          # URL_B was already in the case; URL_A is new
    new = c.call("getEvidenceSubmission", {**p, "submission_id": s["new_submission_ids"][0]})["data"]
    assert new["source_url"] == URL_A and new["rights_class"] == "OPEN" and new["access_mode"] == "FULL_TEXT"
    assert s["plan"][0]["query"] == "가상시 청년 월세 지원 대상자 보도자료"
