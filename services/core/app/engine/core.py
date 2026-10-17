"""Engine core: dispatcher, validation, events, idempotency, jobs, head CAS.

Ported from the in-browser stub (prototype engine.js) and made general: the
knowledge (sources, claims, conflicts, unknowns, verdicts) comes from a
provider per case instead of a fixed fixture.
"""
from __future__ import annotations

import json
import logging
import re
import traceback
from pathlib import Path

from ..errors import ApiError, err, invalid
from ..store import Store
from ..util import (UUID_RE, blank, canon, clone, cp_len, iso, new_uuid, parse_time, real_now_ms, sha256hex,
                    uniq, uuid_from)

log = logging.getLogger("audience_lab.engine")

DATA = Path(__file__).resolve().parent.parent / "data"
FX = json.loads((DATA / "fixture.json").read_text(encoding="utf-8"))

ROLE_RANK = {"VIEWER": 1, "EDITOR": 2, "ADMIN": 3}

# The 30 proposed operations keep the specification's method, path and role.
OPS: dict[str, dict] = {k: dict(v) for k, v in FX["ops"].items()}
_WS = "/api/v1/workspaces/{workspace_id}"
_CASE = _WS + "/cases/{case_id}"
# Reads that exist in the runtime around the core, plus what a real browser needs.
EXISTING_OPS = {
    "whoami": {"method": "GET", "path": "/api/v1/me", "role": "VIEWER", "success": 200, "title": "인증 주체 확인"},
    "listWorkspaceMembers": {"method": "GET", "path": _WS + "/members", "role": "VIEWER", "success": 200, "title": "workspace 구성원 조회"},
    "getRealityBoard": {"method": "GET", "path": _CASE + "/reality-packs/{pack_id}/board", "role": "VIEWER", "success": 200, "title": "근거 판 조회"},
    "getEvidenceTrace": {"method": "GET", "path": _CASE + "/reality-packs/{pack_id}/claims/{claim_id}/trace", "role": "VIEWER", "success": 200, "title": "근거 경로 조회"},
    "listAuditEvents": {"method": "GET", "path": _CASE + "/audit-events", "role": "VIEWER", "success": 200, "title": "감사 이력 조회"},
    "getMonitoringPolicy": {"method": "GET", "path": _CASE + "/monitoring-policy", "role": "VIEWER", "success": 200, "title": "모니터링 정책 조회"},
    "setMonitoringPolicy": {"method": "PUT", "path": _CASE + "/monitoring-policy", "role": "EDITOR", "success": 200, "title": "모니터링 정책 저장"},
    "getMonitoringFeed": {"method": "GET", "path": _CASE + "/monitoring-feed", "role": "VIEWER", "success": 200, "title": "변경 피드 조회"},
    "getCaseLedger": {"method": "GET", "path": _CASE + "/ledger", "role": "VIEWER", "success": 200, "title": "기획의 결과 ID 목록"},
    "getExportSnapshot": {"method": "GET", "path": _CASE + "/editorial-exports/{export_id}/snapshot", "role": "VIEWER", "success": 200, "title": "보고서 내용 미리보기"},
}
ALL_OPS = {**OPS, **EXISTING_OPS}

JOB_STAGES = {
    "reality": ["QUEUED", "INGEST", "REALITY", "COMMIT"],
    "review": ["QUEUED", "RUNNING"],
    "reassessment": ["QUEUED", "INGEST", "REALITY", "REVIEW", "COMMIT"],
    "search": ["QUEUED", "RUNNING"],
    "export": ["QUEUED", "RUNNING"],
}

WARN = FX["warnings"]


class EngineCore:
    def __init__(self, store: Store, *, workspace_id: str, providers: dict, settings=None, clock_ms: int | None = None):
        self.store = store
        self.WS = workspace_id
        self.providers = providers          # name -> Provider
        self.settings = settings
        self.clock_ms = clock_ms            # None = real time (tests may pin it)
        self.on_enqueue = None              # set by the job runner
        self.renderers: dict = {}           # format -> fn(snapshot, ctx) -> bytes
        self.member_source = None           # callable -> [{actor_id, name, role, active}] (auth layer)
        self._enqueued = False

    def members(self):
        return list(self.member_source()) if self.member_source else []

    def member_active(self, actor_id):
        return any(m["actor_id"] == actor_id and m["active"] for m in self.members())

    # ---------------------------------------------------------------- time
    def now(self) -> int:
        return real_now_ms() if self.clock_ms is None else self.clock_ms

    def now_iso(self) -> str:
        return iso(self.now())

    # ---------------------------------------------------------------- validation
    @staticmethod
    def closed(body, allowed):
        if not isinstance(body, dict):
            raise invalid("body", "JSON 객체가 필요하다.")
        for k in body:
            if k not in allowed:
                raise invalid(k, "계약에 없는 필드는 받지 않는다.")

    @staticmethod
    def v_text(v, field, lo, hi):
        if not isinstance(v, str):
            raise invalid(field, "문자열이 필요하다.")
        if blank(v):
            raise invalid(field, "공백만 있는 값은 받을 수 없다.")
        n = cp_len(v)
        if n < lo or n > hi:
            raise invalid(field, f"{lo}자에서 {hi}자 사이여야 한다. 넘으면 나누어 입력하며 자르지 않는다.")
        return v

    @staticmethod
    def v_time(v, field):
        t = parse_time(v)
        if t is None:
            raise invalid(field, "시간대가 있는 ISO 8601 시각이 필요하다.")
        return t

    @staticmethod
    def v_enum(v, field, values):
        if v not in values:
            raise invalid(field, f"허용 값: {', '.join(values)}")
        return v

    @staticmethod
    def v_bool(v, field, dflt):
        if v is None:
            return dflt
        if not isinstance(v, bool):
            raise invalid(field, "true 또는 false가 필요하다.")
        return v

    @staticmethod
    def v_int(v, field, lo, hi, dflt):
        if v is None:
            return dflt
        if not isinstance(v, int) or isinstance(v, bool):
            raise invalid(field, "정수만 받는다. 문자열과 boolean은 예산으로 받지 않는다.")
        if v < lo or v > hi:
            raise invalid(field, f"{lo}에서 {hi} 사이여야 한다.")
        return v

    @staticmethod
    def v_uuid(v, field):
        if not isinstance(v, str) or not UUID_RE.match(v):
            raise invalid(field, "UUID가 필요하다.")
        return v

    def v_uuid_set(self, v, field, lo, hi):
        if not isinstance(v, list):
            raise invalid(field, "배열이 필요하다.")
        for x in v:
            self.v_uuid(x, field)
        if len(set(v)) != len(v):
            raise invalid(field, "중복된 ID가 있다.")
        if len(v) < lo or len(v) > hi:
            raise invalid(field, f"{lo}개에서 {hi}개 사이여야 한다.")
        return v

    def v_params(self, p):
        if p is None:
            p = {}
        self.closed(p, ["query_budget", "source_budget", "language"])
        return {
            "query_budget": self.v_int(p.get("query_budget"), "parameters.query_budget", 1, 20, 10),
            "source_budget": self.v_int(p.get("source_budget"), "parameters.source_budget", 1, 50, 20),
            "language": "ko" if p.get("language") is None else self.v_text(p.get("language"), "parameters.language", 1, 20),
        }

    # ---------------------------------------------------------------- events
    def emit(self, event_type, origin, object_ids, *, case_id=None, correlation_id=None, detail=None):
        system = bool(origin.get("system"))
        self.store.add_event({
            "id": new_uuid(), "event_type": event_type, "at": self.now_iso(),
            "origin": "SYSTEM" if system else "ACTOR",
            "actor_id": None if system else origin.get("actor_id"),
            "initiating_actor_id": origin.get("initiating_actor_id") or origin.get("actor_id"),
            "case_id": case_id, "object_ids": [x for x in object_ids if x],
            "correlation_id": correlation_id, "detail": detail,
        })

    # ---------------------------------------------------------------- lookups
    def get(self, coll, _id):
        return self.store.get(coll, _id)

    def case_or_404(self, ctx):
        c = self.store.get("cases", ctx["params"].get("case_id"))
        if not c:
            raise err("RESOURCE_NOT_FOUND")
        return c

    def in_case(self, coll, _id, case_id, field="resource_id"):
        x = self.store.get(coll, _id)
        if not x or x.get("case_id") != case_id:
            raise err("RESOURCE_NOT_FOUND", field=field)
        return x

    def by_case(self, coll, case_id):
        return [o for o in self.store.all(coll) if o.get("case_id") == case_id]

    def provider_for(self, case):
        p = self.providers.get(case.get("provider") or "")
        if p is None:
            raise err("CONFIGURATION_BLOCKED", reason="이 기획에 맞는 검토 공급자가 설정되지 않았다.")
        return p

    # ---------------------------------------------------------------- idempotency
    RESPOND: dict = {}

    def idempotent(self, ctx, scope, normalized, create):
        key = ctx.get("key")
        if not isinstance(key, str) or blank(key) or cp_len(key) > 200:
            raise invalid("Idempotency-Key", "생성 요청에는 1에서 200자의 Idempotency-Key가 필요하다.")
        k = "|".join([self.WS, scope, ctx["op"], key])
        cid = sha256hex(k)
        h = sha256hex(canon(normalized))
        prev = self.store.get("commands", cid)
        if prev:
            if prev["request_sha256"] != h:
                raise err("IDEMPOTENCY_CONFLICT")
            return self.respond(ctx["op"], prev["ref"], True)
        ref = create()
        self.store.put("commands", {"id": cid, "case_id": ref.get("case_id"), "request_sha256": h, "op": ctx["op"],
                                    "ref": ref, "created_at": self.now_iso()})
        return self.respond(ctx["op"], ref, False)

    def respond(self, op, ref, reused):
        return getattr(self, "respond_" + op)(ref, reused)

    # ---------------------------------------------------------------- jobs
    def enqueue(self, kind, job_id, case_id, resource, payload):
        seq = max((j.get("seq", 0) for j in self.store.all("jobs")), default=0) + 1
        job = {
            "id": job_id, "seq": seq, "kind": kind, "case_id": case_id, "resource": list(resource),
            "state": "pending", "stage": "QUEUED", "attempts": 0, "payload": payload,
            "created_at": self.now_iso(), "started_at": None, "finished_at": None, "error": None,
        }
        self.store.put("jobs", job)
        self._enqueued = True
        return job

    def job_view(self, job_id):
        job = self.store.get("jobs", job_id)
        if not job or job["state"] == "done":
            return {"status": None, "stage": "TERMINAL"}
        if job["state"] == "pending":
            return {"status": "QUEUED", "stage": "QUEUED"}
        stage = job.get("stage") or "RUNNING"
        return {"status": "QUEUED" if stage == "QUEUED" else "RUNNING", "stage": stage}

    def live(self, obj):
        """Status and stage of a job-backed resource: from the job until it commits."""
        if obj.get("status") is None:
            return self.job_view(obj.get("job_id"))
        return {"status": obj["status"], "stage": "TERMINAL"}

    # ---------------------------------------------------------------- head compare-and-swap
    def head_of(self, case_id):
        h = self.store.get("heads", case_id)
        if not h:
            return None
        return {k: h[k] for k in ("pack_id", "review_id", "state_version_id", "content_version_id", "row_version")}

    def pin_head(self, case_id):
        return self.head_of(case_id)

    def head_cas(self, case_id, pin, apply):
        head = self.store.get("heads", case_id)
        if not head or not pin:
            return False
        ok = all(head.get(k) == pin.get(k) for k in ("row_version", "state_version_id", "content_version_id", "pack_id", "review_id"))
        if ok:
            apply(head)
            self.store.touch("heads", head)
        return ok

    # ---------------------------------------------------------------- dispatcher
    def call(self, op, *, actor, params=None, body=None, key=None, if_match=None):
        correlation_id = new_uuid()
        params = params or {}
        enqueued = False
        with self.store.lock:
            self._enqueued = False
            try:
                meta = ALL_OPS.get(op)
                handler = getattr(self, "h_" + op, None)
                if not meta or not handler:
                    raise err("RESOURCE_NOT_FOUND", field="operation")
                if not actor or not actor.get("active", True):
                    raise err("UNAUTHENTICATED")
                if params.get("workspace_id") is not None and params.get("workspace_id") != self.WS:
                    raise err("WORKSPACE_FORBIDDEN")
                needed = "VIEWER" if op == "markNotificationRead" else meta["role"]
                if ROLE_RANK.get(actor.get("role"), 0) < ROLE_RANK[needed]:
                    raise err("ROLE_FORBIDDEN")
                ctx = {"op": op, "actor": actor, "params": params, "body": body, "key": key,
                       "if_match": if_match, "correlation_id": correlation_id}
                out = handler(ctx)
                self.store.flush()
                res = {"ok": True, "status": meta["success"], "data": out.get("data"), "binary": out.get("binary"),
                       "headers": out.get("headers") or {}, "correlation_id": correlation_id}
                enqueued = self._enqueued
            except ApiError as e:
                self.store.rollback()
                error = {"code": e.code, "message": e.message, "correlation_id": correlation_id}
                if e.details:
                    error["details"] = e.details
                return {"ok": False, "status": e.status, "error": error, "headers": {}, "correlation_id": correlation_id}
            except Exception:  # noqa: BLE001
                self.store.rollback()
                log.error("unhandled error in %s\n%s", op, traceback.format_exc())
                error = {"code": "INTERNAL_ERROR", "message": "서버 내부 오류로 요청을 처리하지 못했다.", "correlation_id": correlation_id}
                return {"ok": False, "status": 500, "error": error, "headers": {}, "correlation_id": correlation_id}
        if enqueued and self.on_enqueue:
            self.on_enqueue()
        return res

    # helpers shared by handlers
    @staticmethod
    def by_created_desc(items):
        return sorted(items, key=lambda x: (x.get("created_at") or "", x.get("id") or ""), reverse=True)

    def warn(self, name, **over):
        w = clone(WARN[name])
        w.update(over)
        return w


__all__ = ["EngineCore", "FX", "OPS", "EXISTING_OPS", "ALL_OPS", "ROLE_RANK", "JOB_STAGES", "WARN", "err", "invalid",
           "ApiError", "clone", "uniq", "uuid_from", "new_uuid", "sha256hex", "canon", "iso", "parse_time", "cp_len",
           "re", "log"]
