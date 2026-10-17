"""The HTTP service: accounts, the two workspaces, envelopes, headers and files."""
import importlib
import os
import sys
import tempfile
import time

import pytest


@pytest.fixture(scope="module")
def http():
    tmp = tempfile.mkdtemp(prefix="al-http-")
    os.environ.update({"DATA_DIR": tmp, "SEED_DEMO": "1", "DEMO_ACCOUNTS": "1", "ADMIN_EMAIL": "admin@newsroom.example",
                       "ADMIN_PASSWORD": "admin-pass-1234", "OPENAI_API_KEY": "", "DEMO_STAGE_DELAY": "0", "WEB_DIST": ""})
    for m in [m for m in sys.modules if m == "app.main" or m.startswith("app.config")]:
        del sys.modules[m]
    import app.config
    importlib.reload(app.config)
    main = importlib.import_module("app.main")
    from fastapi.testclient import TestClient
    client = TestClient(main.app)
    yield client, main
    for r in main.RUNNERS:
        r.stop()


def login(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['token']}"}


def test_health_and_unauthenticated(http):
    client, _ = http
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["llm_configured"] is False
    r = client.get("/api/v1/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"
    assert r.headers["X-Correlation-Id"]
    bad = client.post("/api/auth/login", json={"email": "nobody@x.example", "password": "nope"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "LOGIN_FAILED"


def test_demo_workspace_has_the_worked_case_and_files(http):
    client, main = http
    accounts = client.get("/api/auth/demo-accounts").json()["data"]
    assert accounts["enabled"] and len(accounts["accounts"]) == 3
    hd = login(client, accounts["accounts"][0]["email"], accounts["password"])
    me = client.get("/api/v1/me", headers=hd).json()["data"]
    assert me["name"] == "기자 A" and me["demo_only"] is True
    ws = me["workspace_id"]
    cases = client.get(f"/api/v1/workspaces/{ws}/cases", headers=hd).json()["data"]["items"]
    assert len(cases) == 1 and cases[0]["title"] == "청람시 도서관 계약 검토"
    c = cases[0]
    led = client.get(f"/api/v1/workspaces/{ws}/cases/{c['id']}/ledger", headers=hd).json()["data"]
    assert len(led["review"]) == 2 and len(led["delta"]) == 1 and len(led["export"]) == 2 and led["demo"] is True
    rv = client.get(f"/api/v1/workspaces/{ws}/cases/{c['id']}/draft-reviews/{c['head']['review_id']}", headers=hd).json()["data"]
    assert [i["status"] for i in rv["items"]] == ["CONTRADICTED", "CONTRADICTED", "SUPPORTED"] or [i["status"] for i in rv["items"]] == ["CONFLICT", "CONTRADICTED", "SUPPORTED"]
    for xid in led["export"]:
        x = client.get(f"/api/v1/workspaces/{ws}/cases/{c['id']}/editorial-exports/{xid}", headers=hd).json()["data"]
        assert x["status"] == "COMPLETED", x
        f = client.get(f"/api/v1/workspaces/{ws}/cases/{c['id']}/editorial-exports/{xid}/file", headers=hd)
        assert f.status_code == 200 and f.headers["content-type"].startswith(x["media_type"])
        assert "attachment" in f.headers["content-disposition"] and len(f.content) == x["size_bytes"]
        snap = client.get(f"/api/v1/workspaces/{ws}/cases/{c['id']}/editorial-exports/{xid}/snapshot", headers=hd).json()["data"]
        assert snap["snapshot"]["title"] == "청람시 도서관 계약 검토"
    # a demo login cannot reach the newsroom workspace
    main_ws = main.STATE["main"].WS
    r = client.get(f"/api/v1/workspaces/{main_ws}/cases", headers=hd)
    assert r.status_code == 403 and r.json()["error"]["code"] == "WORKSPACE_FORBIDDEN"
    # the viewer can read but not write
    hv = login(client, accounts["accounts"][2]["email"], accounts["password"])
    w = client.post(f"/api/v1/workspaces/{ws}/case-intakes", headers={**hv, "Idempotency-Key": "v-1"},
                    json={"mode": "QUESTION_ONLY", "title": "x", "question": "y", "as_of": "2026-10-10T00:00:00Z"})
    assert w.status_code == 403 and w.json()["error"]["code"] == "ROLE_FORBIDDEN"
    # demo pace: a demo account can run the demo material end to end
    body = {"mode": "QUESTION_ONLY", "title": "청람시 도서관 계약 검토", "question": "계약 경쟁 확대와 비용 절감 주장을 기사에 쓸 수 있는가",
            "as_of": "2026-09-30T09:00:00Z"}
    i = client.post(f"/api/v1/workspaces/{ws}/case-intakes", headers={**hd, "Idempotency-Key": "d-1"}, json=body)
    assert i.status_code == 201, i.text
    ids = i.json()["data"]
    e = client.post(f"/api/v1/workspaces/{ws}/cases/{ids['case_id']}/reality-executions", headers={**hd, "Idempotency-Key": "d-2"},
                    json={"mode": "QUESTION_ONLY", "state_version_id": ids["state_version_id"], "as_of": "2026-09-30T09:00:00Z"})
    assert e.status_code == 202, e.text
    eid = e.json()["data"]["execution_id"]
    for _ in range(100):
        d = client.get(f"/api/v1/workspaces/{ws}/cases/{ids['case_id']}/reality-executions/{eid}", headers=hd).json()["data"]
        if d["status"] not in ("QUEUED", "RUNNING"):
            break
        time.sleep(0.1)
    assert d["status"] == "COMPLETED", d
    # a non-demo title in the demo workspace is refused with a clear reason
    other = client.post(f"/api/v1/workspaces/{ws}/case-intakes", headers={**hd, "Idempotency-Key": "d-3"},
                        json={**body, "title": "실제 기획"}).json()["data"]
    r = client.post(f"/api/v1/workspaces/{ws}/cases/{other['case_id']}/reality-executions", headers={**hd, "Idempotency-Key": "d-4"},
                    json={"mode": "QUESTION_ONLY", "state_version_id": other["state_version_id"], "as_of": "2026-09-30T09:00:00Z"})
    assert r.status_code == 503 and "시연 공간" in r.json()["error"]["details"][0]["reason"]


def test_admin_invites_a_reporter(http):
    client, main = http
    ha = login(client, "admin@newsroom.example", "admin-pass-1234")
    users = client.get("/api/admin/users", headers=ha).json()["data"]
    assert [u["email"] for u in users["items"]] == ["admin@newsroom.example"]
    r = client.post("/api/admin/users", headers=ha, json={"email": "Reporter@Newsroom.example", "name": "김기자", "role": "EDITOR"})
    assert r.status_code == 201, r.text
    temp = r.json()["data"]["temporary_password"]
    uid = r.json()["data"]["user"]["id"]
    assert r.json()["data"]["user"]["must_change_password"] is True
    hr = login(client, "reporter@newsroom.example", temp)
    me = client.get("/api/v1/me", headers=hr).json()["data"]
    assert me["role"] == "EDITOR" and me["demo_only"] is False and me["workspace_id"] == main.STATE["main"].WS
    assert client.get("/api/admin/users", headers=hr).status_code == 403
    ch = client.post("/api/auth/change-password", headers=hr, json={"current_password": temp, "new_password": "new-pass-5678"})
    assert ch.status_code == 200, ch.text
    hr = login(client, "reporter@newsroom.example", "new-pass-5678")
    ws = me["workspace_id"]
    members = client.get(f"/api/v1/workspaces/{ws}/members", headers=hr).json()["data"]["items"]
    assert {m["name"] for m in members} == {"관리자", "김기자"}
    i = client.post(f"/api/v1/workspaces/{ws}/case-intakes", headers={**hr, "Idempotency-Key": "r-1"},
                    json={"mode": "QUESTION_ONLY", "title": "실제 기획", "question": "무엇이 사실인가", "as_of": "2026-10-10T00:00:00Z"})
    assert i.status_code == 201
    ids = i.json()["data"]
    r = client.post(f"/api/v1/workspaces/{ws}/cases/{ids['case_id']}/reality-executions", headers={**hr, "Idempotency-Key": "r-2"},
                    json={"mode": "QUESTION_ONLY", "state_version_id": ids["state_version_id"], "as_of": "2026-10-10T00:00:00Z"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "CONFIGURATION_BLOCKED"
    # deactivation revokes the session at once
    assert client.patch(f"/api/admin/users/{uid}", headers=ha, json={"active": False}).status_code == 200
    assert client.get("/api/v1/me", headers=hr).status_code == 401
    assert client.patch(f"/api/admin/users/{users['items'][0]['id']}", headers=ha, json={"role": "EDITOR"}).status_code == 422
    big = client.post(f"/api/v1/workspaces/{ws}/case-intakes", headers={**ha, "Idempotency-Key": "big", "Content-Type": "application/json"},
                      content=b"{" + b" " * 2_600_000 + b"}")
    assert big.status_code == 413


def test_source_preview_guards(http, monkeypatch):
    client, main = http
    accounts = client.get("/api/auth/demo-accounts").json()["data"]
    hd = login(client, accounts["accounts"][0]["email"], accounts["password"])
    demo_ws = client.get("/api/v1/me", headers=hd).json()["data"]["workspace_id"]
    r = client.post(f"/api/v1/workspaces/{demo_ws}/source-preview", headers=hd, json={"url": "https://www.korea.kr/briefing/x"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "DEMO_ACCOUNT_LIMITED"
    ha = login(client, "admin@newsroom.example", "admin-pass-1234")
    ws = main.STATE["main"].WS
    assert client.post(f"/api/v1/workspaces/{demo_ws}/source-preview", headers=ha, json={"url": "https://www.korea.kr/x"}).status_code == 403
    r = client.post(f"/api/v1/workspaces/{ws}/source-preview", headers=ha, json={"url": "https://www.example.com/news/1"})
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "source_url"
    assert "go.kr" in r.json()["error"]["details"][0]["reason"]
    seen = {}

    def fake_fetch(url, domains, timeout=15.0):
        seen["url"] = url
        return {"ok": True, "url": url, "final_url": url + "?v=1", "title": "보도자료", "site": "정책브리핑", "text": "본문 " * 80,
                "published_at": "2026-10-01T15:00:00Z", "content_type": "text/html", "error": None, "truncated": False}
    monkeypatch.setattr(main, "fetch_document", fake_fetch)
    r = client.post(f"/api/v1/workspaces/{ws}/source-preview", headers=ha, json={"url": "https://www.korea.kr/briefing/pressReleaseView.do?newsId=1"})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["title"] == "보도자료" and d["final_url"].endswith("?v=1") and d["published_at"] == "2026-10-01T15:00:00Z"

    def failing(url, domains, timeout=15.0):
        return {"ok": False, "error": "HTTP_404"}
    monkeypatch.setattr(main, "fetch_document", failing)
    r = client.post(f"/api/v1/workspaces/{ws}/source-preview", headers=ha, json={"url": "https://www.korea.kr/missing"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "SOURCE_FETCH_FAILED" and "404" in r.json()["error"]["details"][0]["reason"]
