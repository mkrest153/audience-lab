"""HTTP service: the 30 operations, accounts, health, and the built web app.

Two workspaces run side by side, each with its own store:
  main  invited newsroom accounts; real public-record search and model review
  demo  public demo accounts; only the fictional 청람시 material
so nothing a newsroom writes is ever visible to a public demo login.
"""
from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__
from .auth import Accounts, actor_of, temp_password
from .config import settings
from .engine import ALL_OPS, Engine
from .engine.core import ROLE_RANK
from .errors import CATALOG
from .providers.base import Provider
from .providers.fetch import fetch_document, fetch_reason, url_allowed
from .providers.fixture import FixtureProvider
from .report import render_docx, render_json, render_pdf
from .runner import Runner
from .seed import DEMO_USERS, ensure_admin, ensure_demo_accounts, seed_demo_case
from .store import Store
from .util import new_uuid, uuid_from

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("audience_lab")

MAX_BODY = 2_500_000
PREVIEW_PATH = "/api/v1/workspaces/{workspace_id}/source-preview"


class DemoOnly(Provider):
    """In the demo workspace anything but the demo material is refused politely."""
    name = "openai"

    def _no(self, *a, **k):
        from .errors import err
        raise err("CONFIGURATION_BLOCKED", reason="시연 공간에서는 제목이 '청람시 도서관 계약 검토'인 시연 기획만 검토할 수 있습니다. "
                                                  "실제 자료 검토는 관리자가 발급한 계정으로 로그인해 이용하세요.")

    precheck_execution = precheck_review = precheck_reassessment = precheck_search = _no

    def configured(self):
        return False


# ---------------------------------------------------------------- wiring
def build_state(cfg=settings):
    data = Path(cfg.data_dir)
    data.mkdir(parents=True, exist_ok=True)
    main_store = Store(str(data / "audience-lab.db"))
    demo_db = data / "audience-lab-demo.db"
    if cfg.demo_reset:
        for f in (demo_db, demo_db.with_name(demo_db.name + "-wal"), demo_db.with_name(demo_db.name + "-shm")):
            f.unlink(missing_ok=True)
    demo_store = Store(str(demo_db))
    accounts = Accounts(main_store)
    ws_main = main_store.meta_get("workspace_id")
    if not ws_main:
        ws_main = new_uuid()
        main_store.meta_set("workspace_id", ws_main)
    ws_demo = uuid_from("audience-lab-demo-workspace")

    from .providers.openai_provider import OpenAIProvider
    live = OpenAIProvider(cfg, accounts)
    main = Engine(main_store, workspace_id=ws_main, providers={"fixture": FixtureProvider(cfg.demo_stage_delay), "openai": live}, settings=cfg)
    demo = Engine(demo_store, workspace_id=ws_demo, providers={"fixture": FixtureProvider(cfg.demo_stage_delay), "openai": DemoOnly()}, settings=cfg)
    for eng, ws in ((main, "main"), (demo, "demo")):
        eng.renderers = {"JSON": render_json, "PDF": render_pdf, "DOCX": render_docx}
        eng.member_source = (lambda w: (lambda: accounts.members(w)))(ws)
    if cfg.demo_accounts:
        ensure_demo_accounts(accounts, cfg.demo_password)
    ensure_admin(accounts, cfg.admin_email, cfg.admin_password, cfg.admin_name)
    if cfg.seed_demo:
        try:
            seed_demo_case(demo, accounts)
        except Exception:  # noqa: BLE001
            log.exception("demo seed failed")
    return {"main": main, "demo": demo, "accounts": accounts, "live": live}


STATE = build_state()
RUNNERS = [Runner(STATE["main"], settings.workers, "main"), Runner(STATE["demo"], 1, "demo")]
for r in RUNNERS:
    r.start()

app = FastAPI(title="Audience Lab", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def guard(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY:
        return _error(413, "INPUT_INVALID", "요청 본문이 너무 큽니다. 자료는 나누어 등록하세요.", "body")
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    if not request.url.path.startswith("/api/"):
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; "
            "img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    return response


def _error(status, code, message, field="body", correlation_id=None):
    cid = correlation_id or new_uuid()
    return JSONResponse({"error": {"code": code, "message": message, "correlation_id": cid,
                                   "details": [{"field": field, "reason": message}]}}, status_code=status,
                        headers={"X-Correlation-Id": cid})


def _token(request: Request) -> str:
    h = request.headers.get("authorization") or ""
    return h[7:].strip() if h.lower().startswith("bearer ") else ""


def _user(request: Request):
    return STATE["accounts"].user_for_token(_token(request))


_writes: dict[str, deque] = defaultdict(deque)


def _rate_limited(user_id: str) -> bool:
    limit = settings.writes_per_minute
    if limit <= 0:
        return False
    now = time.monotonic()
    q = _writes[user_id]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


# ---------------------------------------------------------------- the operations
def _register(op: str, meta: dict):
    method = meta["method"]

    async def endpoint(request: Request):
        user = _user(request)
        engine = STATE["demo"] if user and user["workspace"] == "demo" else STATE["main"]
        body = None
        if method in ("POST", "PATCH", "PUT"):
            raw = await request.body()
            if raw.strip():
                try:
                    import json
                    body = json.loads(raw)
                except ValueError:
                    return _error(422, "INPUT_INVALID", "JSON 본문을 읽을 수 없습니다.")
            if user and _rate_limited(user["id"]):
                st, msg, fld = CATALOG["RATE_LIMITED"]
                return _error(st, "RATE_LIMITED", msg, fld)
        res = await run_in_threadpool(
            engine.call, op, actor=actor_of(user) if user else None, params=dict(request.path_params), body=body,
            key=request.headers.get("idempotency-key"), if_match=request.headers.get("if-match"))
        headers = {"X-Correlation-Id": res["correlation_id"], "Cache-Control": "no-store"}
        if not res["ok"]:
            return JSONResponse({"error": res["error"]}, status_code=res["status"], headers=headers)
        headers.update({k: v for k, v in (res.get("headers") or {}).items() if k.lower() not in ("content-type",)})
        if res.get("binary") is not None:
            return Response(content=res["binary"], status_code=res["status"], media_type=res["headers"].get("Content-Type"), headers=headers)
        return JSONResponse({"data": res["data"]}, status_code=res["status"], headers=headers)

    endpoint.__name__ = op
    app.add_api_route(meta["path"], endpoint, methods=[method], name=op, include_in_schema=False)


# a fixed list must come before patterns that would swallow it
for _op, _meta in sorted(ALL_OPS.items(), key=lambda kv: (-kv[1]["path"].count("/"), kv[1]["path"])):
    _register(_op, _meta)


# ---------------------------------------------------------------- public-record page into the form
# Outside the engine on purpose: a slow government site must not hold the
# store lock. Nothing is stored; the person checks the text and submits it.
@app.post(PREVIEW_PATH)
async def preview_source(workspace_id: str, request: Request):
    u = _user(request)
    if not u:
        return _error(401, "UNAUTHENTICATED", "인증 정보가 없거나 만료되었습니다.", "Authorization")
    engine = STATE["demo"] if u["workspace"] == "demo" else STATE["main"]
    if workspace_id != engine.WS:
        return _error(403, "WORKSPACE_FORBIDDEN", "이 workspace 경로에 접근할 수 없습니다.", "workspace_id")
    if u["workspace"] == "demo" or u.get("demo_only"):
        return _error(403, "DEMO_ACCOUNT_LIMITED", "시연 계정은 외부 주소에서 원문을 가져올 수 없습니다.", "source_url")
    if ROLE_RANK.get(u["role"], 0) < ROLE_RANK["EDITOR"]:
        return _error(403, "ROLE_FORBIDDEN", "쓰기 작업은 EDITOR 이상의 권한이 필요합니다.", "role")
    if _rate_limited(u["id"]):
        st, msg, fld = CATALOG["RATE_LIMITED"]
        return _error(st, "RATE_LIMITED", msg, fld)
    try:
        b = await request.json()
    except ValueError:
        b = None
    url = str((b or {}).get("url") or "").strip() if isinstance(b, dict) else ""
    domains = settings.open_domains
    if not url_allowed(url, domains):
        return _error(422, "INPUT_INVALID", fetch_reason("DOMAIN_NOT_ALLOWED", domains), "source_url")
    page = await run_in_threadpool(fetch_document, url, domains)
    if not page["ok"]:
        log.info("source preview failed %s %s", url, page["error"])
        return _error(422, "SOURCE_FETCH_FAILED", fetch_reason(page["error"], domains), "source_url")
    if page.get("truncated"):
        return _error(422, "INPUT_INVALID", "원문이 20만 자를 넘습니다. 필요한 부분을 나누어 직접 붙여 넣으세요.", "source_url")
    return JSONResponse({"data": {k: page[k] for k in ("url", "final_url", "title", "site", "text", "published_at", "content_type")}},
                        headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- accounts
@app.post("/api/auth/login")
async def login(request: Request):
    try:
        b = await request.json()
    except ValueError:
        b = {}
    email = str((b or {}).get("email") or "").strip().lower()
    ip = request.client.host if request.client else "?"
    acc = STATE["accounts"]
    if acc.throttled(f"{email}|{ip}") or acc.throttled(f"ip|{ip}", limit=30):
        st, msg, fld = CATALOG["RATE_LIMITED"]
        return _error(st, "RATE_LIMITED", "로그인 시도가 너무 잦습니다. 몇 분 뒤 다시 시도하세요.", fld)
    token, u = await run_in_threadpool(acc.login, email, str((b or {}).get("password") or ""))
    if not token:
        return _error(401, "LOGIN_FAILED", "이메일 또는 비밀번호가 올바르지 않습니다.", "email")
    return {"data": {"token": token, "user": acc.public(u)}}


@app.post("/api/auth/logout")
async def logout(request: Request):
    STATE["accounts"].logout(_token(request))
    return {"data": {"ok": True}}


@app.get("/api/auth/me")
async def me(request: Request):
    u = _user(request)
    if not u:
        return _error(401, "UNAUTHENTICATED", "인증 정보가 없거나 만료되었습니다.", "Authorization")
    return {"data": STATE["accounts"].public(u)}


@app.post("/api/auth/change-password")
async def change_password(request: Request):
    u = _user(request)
    if not u:
        return _error(401, "UNAUTHENTICATED", "인증 정보가 없거나 만료되었습니다.", "Authorization")
    if u.get("demo_only"):
        return _error(403, "DEMO_ACCOUNT_LIMITED", "시연 계정의 비밀번호는 바꿀 수 없습니다.", "account")
    b = await request.json()
    from .auth import verify_password
    if not verify_password(str(b.get("current_password") or ""), u["password_hash"]):
        return _error(422, "INPUT_INVALID", "현재 비밀번호가 맞지 않습니다.", "current_password")
    try:
        STATE["accounts"].set_password(u["id"], str(b.get("new_password") or ""))
    except ValueError as e:
        return _error(422, "INPUT_INVALID", str(e), "new_password")
    return {"data": {"ok": True}}


@app.get("/api/auth/demo-accounts")
async def demo_accounts():
    if not settings.demo_accounts:
        return {"data": {"enabled": False, "accounts": []}}
    return {"data": {"enabled": True, "password": settings.demo_password,
                     "accounts": [{"email": e, "name": n, "role": r} for e, n, r in DEMO_USERS]}}


def _admin(request: Request):
    u = _user(request)
    if not u:
        return None, _error(401, "UNAUTHENTICATED", "인증 정보가 없거나 만료되었습니다.", "Authorization")
    if u["role"] != "ADMIN" or u["workspace"] != "main":
        return None, _error(403, "ROLE_FORBIDDEN", "관리자만 할 수 있습니다.", "role")
    return u, None


@app.get("/api/admin/users")
async def admin_users(request: Request):
    u, bad = _admin(request)
    if bad:
        return bad
    acc = STATE["accounts"]
    return {"data": {"items": [acc.public(x) for x in acc.all() if x["workspace"] == "main"], "usage": acc.usage_today(),
                     "limits": {"model_calls": settings.daily_model_calls, "search_calls": settings.daily_search_calls}}}


@app.post("/api/admin/users")
async def admin_create(request: Request):
    u, bad = _admin(request)
    if bad:
        return bad
    b = await request.json()
    pw = temp_password()
    try:
        new = STATE["accounts"].create(email=b.get("email"), name=b.get("name"), role=b.get("role") or "EDITOR", password=pw,
                                       workspace="main", must_change=True)
    except ValueError as e:
        return _error(422, "INPUT_INVALID", str(e), "email")
    return JSONResponse({"data": {"user": STATE["accounts"].public(new), "temporary_password": pw}}, status_code=201)


@app.patch("/api/admin/users/{user_id}")
async def admin_update(user_id: str, request: Request):
    u, bad = _admin(request)
    if bad:
        return bad
    b = await request.json()
    target = STATE["accounts"].get(user_id)
    if not target or target["workspace"] != "main":
        return _error(404, "RESOURCE_NOT_FOUND", "사용자를 찾을 수 없습니다.", "user_id")
    if target["id"] == u["id"] and (b.get("active") is False or (b.get("role") and b.get("role") != "ADMIN")):
        return _error(422, "INPUT_INVALID", "자기 자신의 관리자 권한은 줄이거나 끌 수 없습니다.", "role")
    try:
        out = STATE["accounts"].update(user_id, role=b.get("role"), active=b.get("active"), name=b.get("name"))
    except ValueError as e:
        return _error(422, "INPUT_INVALID", str(e), "role")
    return {"data": {"user": STATE["accounts"].public(out)}}


@app.post("/api/admin/users/{user_id}/reset-password")
async def admin_reset(user_id: str, request: Request):
    u, bad = _admin(request)
    if bad:
        return bad
    target = STATE["accounts"].get(user_id)
    if not target or target["workspace"] != "main":
        return _error(404, "RESOURCE_NOT_FOUND", "사용자를 찾을 수 없습니다.", "user_id")
    pw = temp_password()
    STATE["accounts"].set_password(user_id, pw, must_change=True)
    STATE["accounts"].revoke_all(user_id)
    return {"data": {"temporary_password": pw}}


# ---------------------------------------------------------------- health
def _health():
    live = STATE["live"]
    return {"status": "ok", "service": "audience-lab", "version": __version__,
            "llm_configured": live.configured(), "model": settings.openai_model if live.configured() else "(demo only)",
            "search_model": settings.openai_search_model if live.configured() else None,
            "open_domains": settings.open_domains, "demo": settings.seed_demo}


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return _health()


@app.get("/api/health")
async def api_health():
    return _health()


@app.get("/api/health/llm")
async def llm_selftest(request: Request):
    """A real, tiny model call (and optionally a search) to diagnose configuration remotely."""
    u, bad = _admin(request)
    if bad:
        return bad
    out = await run_in_threadpool(STATE["live"].self_test, request.query_params.get("search") == "1")
    return {"data": out}


# ---------------------------------------------------------------- the built web app
_web = Path(settings.web_dist) if settings.web_dist else None
if _web and _web.is_dir():
    if (_web / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=_web / "assets"), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return _error(404, "RESOURCE_NOT_FOUND", "이 범위에서 객체를 찾을 수 없다.", "path")
        f = (_web / full_path).resolve()
        if full_path and f.is_file() and _web.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(_web / "index.html", headers={"Cache-Control": "no-cache"})
