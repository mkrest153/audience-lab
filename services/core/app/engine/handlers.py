"""The 30 operations of the specification plus the runtime reads around them."""
from __future__ import annotations

import re

from ..errors import err, invalid
from ..util import canon, clone, cp_len, iso, ms_of, new_uuid, sha256hex, title_key, uniq
from .core import FX

SENSITIVE = ("INTERNAL", "CONFIDENTIAL_UNPUBLISHED", "ORGANIZATION_PRIVATE_DATA")
RIGHTS = ("OPEN", "LICENSED_FULL_TEXT", "LICENSED_PASSAGE", "RESTRICTED_LINK_ONLY", "UNKNOWN")
MODES = ("QUESTION_ONLY", "DRAFT_REVIEW", "SOURCE_REVIEW")
CLOCK_SKEW_MS = 120_000   # tolerated difference between a browser clock and the server


class HandlersMixin:
    # ================================================================ intake
    def parse_intake(self, body):
        self.closed(body, ["mode", "title", "question", "as_of", "draft"])
        self.v_enum(body.get("mode"), "mode", list(MODES))
        self.v_text(body.get("title"), "title", 1, 300)
        self.v_text(body.get("question"), "question", 1, 500)
        as_of = self.v_time(body.get("as_of"), "as_of")
        draft = None
        if body["mode"] == "DRAFT_REVIEW":
            if body.get("draft") is None:
                raise err("MODE_INPUT_INVALID", field="draft", reason="초안 검토 모드에는 초안이 필요하다.")
            draft = self.v_text(body["draft"], "draft", 1, 50000)
        elif body.get("draft") is not None:
            raise err("MODE_INPUT_INVALID", field="draft", reason="질문·자료 모드에는 초안을 보내지 않는다.")
        return {"mode": body["mode"], "title": body["title"], "question": body["question"], "as_of": iso(as_of), "draft": draft}

    def save_intake(self, ctx, c, inp, is_new):
        states = self.by_case("states", c["id"])
        prev_mode = states[-1]["mode"] if states else None
        state = {
            "id": new_uuid(), "case_id": c["id"], "version_number": len(states) + 1,
            "state": {"primary_editorial_question": inp["question"]}, "mode": inp["mode"],
            "reason": "EDITORIAL_QUESTION_SAVED" if is_new or prev_mode == inp["mode"] else f"SWITCH_TO_{inp['mode']}",
            "created_at": self.now_iso(),
        }
        self.store.put("states", state)
        content = None
        if inp["draft"] is not None:
            content = {
                "id": new_uuid(), "case_id": c["id"], "version_number": len(self.by_case("contents", c["id"])) + 1,
                "origin": "USER_INPUT", "body": inp["draft"], "body_sha256": sha256hex(inp["draft"]), "as_of": inp["as_of"],
                "sensitivity": "PUBLIC", "created_at": self.now_iso(),
            }
            self.store.put("contents", content)
        head = self.store.get("heads", c["id"])
        if not head:
            self.store.put("heads", {"id": c["id"], "case_id": c["id"], "pack_id": None, "review_id": None,
                                     "state_version_id": state["id"], "content_version_id": content["id"] if content else None,
                                     "row_version": 1})
        else:
            head["state_version_id"] = state["id"]
            head["content_version_id"] = content["id"] if content else None
            head["row_version"] += 1
            self.store.touch("heads", head)
        self.emit("core.intake.created", ctx["actor"], [c["id"], state["id"], content["id"] if content else None],
                  case_id=c["id"], correlation_id=ctx["correlation_id"])
        return {"case_id": c["id"], "state_version_id": state["id"], "content_version_id": content["id"] if content else None}

    def provider_name_for_title(self, title):
        demo = title_key(title) == title_key(FX["intake"]["title"])
        if demo and "fixture" in self.providers:
            return "fixture"
        return "openai" if "openai" in self.providers else ("fixture" if demo else "openai")

    def h_createCaseIntake(self, ctx):
        inp = self.parse_intake(ctx["body"])

        def create():
            provider = self.provider_name_for_title(inp["title"])
            c = {"id": new_uuid(), "title": inp["title"], "title_key": title_key(inp["title"]), "as_of": inp["as_of"],
                 "created_at": self.now_iso(), "provider": provider, "demo": provider == "fixture",
                 "created_by": ctx["actor"].get("actor_id"), "seq": {}}
            self.store.put("cases", c)
            ids = self.save_intake(ctx, c, inp, True)
            return {**ids}
        return {"data": self.idempotent(ctx, "NEW_CASE", inp, create)}

    def respond_createCaseIntake(self, ref, reused):
        return {"case_id": ref["case_id"], "state_version_id": ref["state_version_id"],
                "content_version_id": ref["content_version_id"], "reused": reused}

    respond_appendCaseIntake = respond_createCaseIntake

    def h_appendCaseIntake(self, ctx):
        c = self.case_or_404(ctx)
        inp = self.parse_intake(ctx["body"])
        if title_key(inp["title"]) != c["title_key"]:
            raise err("CASE_TITLE_MISMATCH")
        return {"data": self.idempotent(ctx, c["id"], inp, lambda: self.save_intake(ctx, c, inp, False))}

    def h_listCases(self, ctx):
        return {"data": {"items": [self.case_dto(c) for c in self.by_created_desc(self.store.all("cases"))], "next_cursor": None}}

    def h_getCase(self, ctx):
        return {"data": self.case_dto(self.case_or_404(ctx))}

    def h_listContentVersions(self, ctx):
        c = self.case_or_404(ctx)
        items = sorted(self.by_case("contents", c["id"]), key=lambda v: v["version_number"])
        return {"data": {"items": [self.content_dto(v) for v in items], "next_cursor": None}}

    def h_listStateVersions(self, ctx):
        c = self.case_or_404(ctx)
        items = sorted(self.by_case("states", c["id"]), key=lambda v: v["version_number"])
        return {"data": {"items": [self.state_dto(s) for s in items], "next_cursor": None}}

    # ================================================================ evidence submissions
    def h_createEvidenceSubmission(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["title", "source_url", "transcript_locator", "body", "recorded_at", "sensitivity", "rights_class"])
        self.v_text(b.get("title"), "title", 1, 300)
        has_url = b.get("source_url") is not None
        has_loc = b.get("transcript_locator") is not None
        if has_url == has_loc:
            raise invalid("source_url", "HTTPS 출처 URL과 공개 전사 위치 중 정확히 하나가 필요하다.")
        if has_url and (not isinstance(b["source_url"], str) or not re.match(r"^https://\S+$", b["source_url"]) or cp_len(b["source_url"]) > 2000):
            raise invalid("source_url", "https://로 시작하는 URL이 필요하다.")
        if has_loc:
            self.v_text(b["transcript_locator"], "transcript_locator", 1, 2000)
        recorded = self.v_time(b.get("recorded_at"), "recorded_at")
        if recorded > self.now() + CLOCK_SKEW_MS:
            raise invalid("recorded_at", "기록 시각은 서버 수신 시각보다 늦을 수 없다.")
        if b.get("sensitivity") in SENSITIVE:
            raise err("SOURCE_POLICY_BLOCKED", field="sensitivity", reason="비공개 자료는 보관·전송·삭제 정책이 승인되기 전까지 받지 않는다.")
        self.v_enum(b.get("sensitivity"), "sensitivity", ["PUBLIC"])
        self.v_enum(b.get("rights_class"), "rights_class", list(RIGHTS))
        if b["rights_class"].startswith("LICENSED"):
            raise err("SOURCE_POLICY_BLOCKED", reason="라이선스 자료는 허용 범위가 승인되기 전까지 받지 않는다.")
        meta_only = b["rights_class"] != "OPEN"
        if meta_only and b.get("body") is not None:
            raise err("METADATA_ONLY_BODY_FORBIDDEN")
        if not meta_only:
            self.v_text(b.get("body"), "body", 1, 200000)
        norm = {"title": b["title"], "source_url": b["source_url"] if has_url else None,
                "transcript_locator": b["transcript_locator"] if has_loc else None,
                "body": None if meta_only else b["body"], "recorded_at": iso(recorded), "sensitivity": "PUBLIC",
                "rights_class": b["rights_class"]}
        provider = self.providers.get(c.get("provider"))
        if provider:
            provider.precheck_submission(self, c, norm=norm, actor=ctx["actor"])

        def create():
            sub = self.register_submission(c, norm, origin="USER", actor=ctx["actor"], correlation_id=ctx["correlation_id"])
            return {"case_id": c["id"], "submission_id": sub["id"]}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    def register_submission(self, c, norm, *, origin, actor, correlation_id=None, received_at=None):
        meta_only = norm["rights_class"] != "OPEN"
        body_hash = None if meta_only else sha256hex(norm["body"])
        provider = self.providers.get(c.get("provider"))
        fx_key = provider.match_submission(self, c, norm) if provider and hasattr(provider, "match_submission") else None
        content_id = None
        if not meta_only:
            content_id = new_uuid()
            self.store.put("contents", {
                "id": content_id, "case_id": c["id"], "version_number": len(self.by_case("contents", c["id"])) + 1,
                "origin": "REAL_WORLD_SOURCE", "body": norm["body"], "body_sha256": body_hash, "as_of": norm["recorded_at"],
                "sensitivity": "PUBLIC", "created_at": self.now_iso()})
        sub = {
            "id": new_uuid(), "case_id": c["id"], "title": norm["title"], "source_url": norm["source_url"],
            "transcript_locator": norm["transcript_locator"], "content_version_id": content_id, "body_sha256": body_hash,
            "recorded_at": norm["recorded_at"], "received_at": received_at or self.now_iso(), "sensitivity": "PUBLIC",
            "rights_class": norm["rights_class"], "access_mode": "METADATA_ONLY" if meta_only else "FULL_TEXT",
            "status": "REGISTERED", "source_id": None, "revision_id": None, "fx_key": fx_key, "origin": origin,
            "family": norm.get("family"), "created_at": self.now_iso(),
        }
        self.store.put("submissions", sub)
        self.emit("core.submission.registered", actor, [sub["id"]], case_id=c["id"], correlation_id=correlation_id)
        return sub

    def respond_createEvidenceSubmission(self, ref, reused):
        return {"submission": self.submission_dto(self.store.get("submissions", ref["submission_id"])), "reused": reused}

    def h_getEvidenceSubmission(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.submission_dto(self.in_case("submissions", ctx["params"].get("submission_id"), c["id"]))}

    def accept_submission(self, c, sub):
        """Turn a registered submission into a source revision of this case."""
        if sub.get("revision_id") and self.store.get("revisions", sub["revision_id"]):
            return self.store.get("revisions", sub["revision_id"])
        provider = self.providers.get(c.get("provider"))
        content = self.store.get("contents", sub["content_version_id"]) if sub.get("content_version_id") else None
        url = sub["source_url"] or f"공개 전사: {sub['transcript_locator']}"
        from ..util import host_of
        draft = {"url": url, "title": sub["title"], "family": sub.get("family") or host_of(sub["source_url"]) or "공개 전사",
                 "rights_class": sub["rights_class"], "published_at": sub["recorded_at"],
                 "body": content["body"] if content else None, "collection": "OK"}
        if provider:
            draft.update(provider.source_for_submission(self, c, sub) or {})
        rev = self.register_source(c, draft, via="SUBMISSION", available_at=sub["received_at"], submission_id=sub["id"])
        sub["status"] = "ACCEPTED"
        sub["source_id"] = rev["source_id"]
        sub["revision_id"] = rev["id"]
        self.store.touch("submissions", sub)
        return rev

    # ================================================================ reality execution
    def h_createRealityExecution(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["mode", "state_version_id", "content_version_id", "baseline_pack_id", "submission_ids",
                        "reporting_result_ids", "as_of", "allow_partial", "parameters"])
        self.v_enum(b.get("mode"), "mode", list(MODES))
        state = self.in_case("states", self.v_uuid(b.get("state_version_id"), "state_version_id"), c["id"], "state_version_id")
        content = None
        if b["mode"] == "DRAFT_REVIEW":
            if b.get("content_version_id") is None:
                raise err("MODE_INPUT_INVALID", field="content_version_id", reason="초안 검토 모드에는 초안 버전이 필요하다.")
            content = self.in_case("contents", self.v_uuid(b["content_version_id"], "content_version_id"), c["id"], "content_version_id")
            if content["origin"] != "USER_INPUT":
                raise err("MODE_INPUT_INVALID", field="content_version_id", reason="자료 원문은 초안으로 쓸 수 없다.")
        elif b.get("content_version_id") is not None:
            raise err("MODE_INPUT_INVALID", field="content_version_id", reason="질문·자료 모드에는 초안 버전을 보내지 않는다.")
        baseline = None
        if b.get("baseline_pack_id") is not None:
            baseline = self.in_case("packs", self.v_uuid(b["baseline_pack_id"], "baseline_pack_id"), c["id"], "baseline_pack_id")
        sub_ids = self.v_uuid_set([] if b.get("submission_ids") is None else b["submission_ids"], "submission_ids", 0, 50)
        res_ids = self.v_uuid_set([] if b.get("reporting_result_ids") is None else b["reporting_result_ids"], "reporting_result_ids", 0, 20)
        as_of = self.v_time(b.get("as_of"), "as_of")
        allow_partial = self.v_bool(b.get("allow_partial"), "allow_partial", False)
        parameters = self.v_params(b.get("parameters"))
        subs = [self.in_case("submissions", i, c["id"], "submission_ids") for i in sub_ids]
        results = [self.in_case("results", i, c["id"], "reporting_result_ids") for i in res_ids]
        if baseline and as_of < ms_of(baseline["as_of"]):
            raise err("REALITY_AS_OF_PRECEDES_BASELINE")
        all_subs = self._uniq_subs([*subs, *[self.store.get("submissions", i) for r in results for i in r["submission_ids"]]])
        for s in all_subs:
            if ms_of(s["received_at"]) > as_of:
                raise err("AS_OF_SOURCE_UNAVAILABLE")
        if b["mode"] == "SOURCE_REVIEW" and not any(s["rights_class"] == "OPEN" and s["access_mode"] == "FULL_TEXT" for s in all_subs):
            raise err("MODE_INPUT_INVALID", field="submission_ids", reason="자료 검토 모드에는 적격한 공개 원문이 하나 이상 필요하다. 자료를 먼저 등록한다.")
        searched = b["mode"] != "SOURCE_REVIEW" and not baseline
        provider = self.provider_for(c)
        provider.precheck_execution(self, c, mode=b["mode"], content=content, subs=all_subs, baseline=baseline,
                                    searched=searched, as_of_ms=as_of, actor=ctx["actor"])
        norm = {"mode": b["mode"], "state_version_id": state["id"], "content_version_id": content["id"] if content else None,
                "baseline_pack_id": baseline["id"] if baseline else None, "submission_ids": sorted(sub_ids),
                "reporting_result_ids": sorted(res_ids), "as_of": iso(as_of), "allow_partial": allow_partial, "parameters": parameters}

        def create():
            ex = {
                "id": new_uuid(), "case_id": c["id"], "job_id": new_uuid(), "mode": b["mode"], "state_version_id": state["id"],
                "content_version_id": content["id"] if content else None, "baseline_pack_id": baseline["id"] if baseline else None,
                "submission_ids": sub_ids, "reporting_result_ids": res_ids, "as_of": iso(as_of), "allow_partial": allow_partial,
                "parameters": parameters, "status": None, "result_pack_id": None, "head_updated": False, "warnings": [],
                "error_code": None, "created_at": self.now_iso(), "completed_at": None, "question_assessments": [],
                "correlation_id": ctx["correlation_id"],
            }
            self.store.put("executions", ex)
            pin = self.pin_head(c["id"])
            self.emit("core.reality.queued", ctx["actor"], [ex["id"], ex["job_id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            self.enqueue("reality", ex["job_id"], c["id"], ("executions", ex["id"]), {
                "searched": searched, "sub_ids": [s["id"] for s in all_subs], "pin": pin,
                "actor_id": ctx["actor"].get("actor_id"), "demo_only": bool(ctx["actor"].get("demo_only"))})
            return {"case_id": c["id"], "execution_id": ex["id"]}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    @staticmethod
    def _uniq_subs(subs):
        seen, out = set(), []
        for s in subs:
            if s and s["id"] not in seen:
                seen.add(s["id"])
                out.append(s)
        return out

    def respond_createRealityExecution(self, ref, reused):
        ex = self.store.get("executions", ref["execution_id"])
        return {"execution_id": ex["id"], "job_id": ex["job_id"], "status": self.execution_dto(ex)["status"], "reused": reused}

    def h_getRealityExecution(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.execution_dto(self.in_case("executions", ctx["params"].get("execution_id"), c["id"]))}

    # ================================================================ editorial brief
    def h_createEditorialBrief(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["state_version_id", "reality_pack_id", "content_version_id", "allow_partial"])
        state = self.in_case("states", self.v_uuid(b.get("state_version_id"), "state_version_id"), c["id"], "state_version_id")
        pack = self.in_case("packs", self.v_uuid(b.get("reality_pack_id"), "reality_pack_id"), c["id"], "reality_pack_id")
        content = None
        if b.get("content_version_id") is not None:
            content = self.in_case("contents", self.v_uuid(b["content_version_id"], "content_version_id"), c["id"], "content_version_id")
        allow_partial = self.v_bool(b.get("allow_partial"), "allow_partial", False)
        if pack["status"] == "PARTIAL" and not allow_partial:
            raise err("REVIEW_PARTIAL_NOT_ALLOWED")
        norm = {"state_version_id": state["id"], "reality_pack_id": pack["id"], "content_version_id": content["id"] if content else None,
                "allow_partial": allow_partial}

        def create():
            bid = new_uuid()
            brief = {
                "id": bid, "case_id": c["id"], "state_version_id": state["id"], "content_version_id": content["id"] if content else None,
                "reality_pack_id": pack["id"], "as_of": pack["as_of"], "status": "PARTIAL" if pack["status"] == "PARTIAL" else "COMPLETED",
                "sections": self.compile_sections(pack, bid), "questions": self.pack_questions(pack),
                "question_assessments": self.assess_questions(pack, bid), "action_overlay": self.action_overlay(pack),
                "warnings": clone(pack["warnings"]), "created_at": self.now_iso(), "correlation_id": ctx["correlation_id"],
            }
            self.store.put("briefs", brief)
            self.emit("core.editorial_brief.created", ctx["actor"], [brief["id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            return {"case_id": c["id"], "brief_id": bid}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    def respond_createEditorialBrief(self, ref, reused):
        return {"brief": self.brief_dto(self.store.get("briefs", ref["brief_id"])), "reused": reused}

    def h_getEditorialBrief(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.brief_dto(self.in_case("briefs", ctx["params"].get("brief_id"), c["id"]))}

    # ================================================================ draft review
    def h_createDraftReview(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["content_version_id", "state_version_id", "reality_pack_id", "allow_partial"])
        content = self.in_case("contents", self.v_uuid(b.get("content_version_id"), "content_version_id"), c["id"], "content_version_id")
        state = self.in_case("states", self.v_uuid(b.get("state_version_id"), "state_version_id"), c["id"], "state_version_id")
        pack = self.in_case("packs", self.v_uuid(b.get("reality_pack_id"), "reality_pack_id"), c["id"], "reality_pack_id")
        allow_partial = self.v_bool(b.get("allow_partial"), "allow_partial", False)
        if content["origin"] != "USER_INPUT":
            raise invalid("content_version_id", "자료 원문은 초안으로 검토할 수 없다.")
        if cp_len(content["body"]) > 50000:
            raise invalid("content_version_id", "검토할 초안은 50000자를 넘을 수 없다. 나누어 검토하며 자르지 않는다.")
        if pack["status"] == "PARTIAL" and not allow_partial:
            raise err("REVIEW_PARTIAL_NOT_ALLOWED")
        self.provider_for(c).precheck_review(self, c, content=content, pack=pack, actor=ctx["actor"])
        norm = {"content_version_id": content["id"], "state_version_id": state["id"], "reality_pack_id": pack["id"], "allow_partial": allow_partial}

        def create():
            review = {
                "id": new_uuid(), "case_id": c["id"], "job_id": new_uuid(), "content_version_id": content["id"],
                "state_version_id": state["id"], "reality_pack_id": pack["id"], "as_of": pack["as_of"], "status": None,
                "row_version": 1, "allow_partial": allow_partial, "created_at": self.now_iso(), "completed_at": None,
                "error_code": None, "items": [], "questions": [], "question_assessments": [], "warnings": clone(pack["warnings"]),
                "baseline_review_id": None, "correlation_id": ctx["correlation_id"],
            }
            self.store.put("reviews", review)
            pin = self.pin_head(c["id"])
            self.emit("core.review.queued", ctx["actor"], [review["id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            self.enqueue("review", review["job_id"], c["id"], ("reviews", review["id"]),
                         {"pin": pin, "actor_id": ctx["actor"].get("actor_id"), "demo_only": bool(ctx["actor"].get("demo_only"))})
            return {"case_id": c["id"], "review_id": review["id"]}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    def respond_createDraftReview(self, ref, reused):
        r = self.store.get("reviews", ref["review_id"])
        return {"review_id": r["id"], "status": self.review_dto(r)["status"], "reused": reused}

    def h_getDraftReview(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.review_dto(self.in_case("reviews", ctx["params"].get("review_id"), c["id"]))}

    # ================================================================ reporting tasks
    def origin_view(self, c, b):
        has_r, has_b = b.get("review_id") is not None, b.get("brief_id") is not None
        if has_r == has_b:
            raise invalid("review_id", "완료된 검토 또는 완료된 Brief 가운데 정확히 하나를 원본으로 지정한다.")
        if has_r:
            r = self.in_case("reviews", self.v_uuid(b["review_id"], "review_id"), c["id"], "review_id")
            if r["status"] not in ("COMPLETED", "PARTIAL"):
                raise invalid("review_id", "완료된 검토만 과제의 원본이 될 수 있다.")
            return {"kind": "REVIEW", "view": r, "pack": self.store.get("packs", r["reality_pack_id"])}
        br = self.in_case("briefs", self.v_uuid(b["brief_id"], "brief_id"), c["id"], "brief_id")
        return {"kind": "BRIEF", "view": br, "pack": self.store.get("packs", br["reality_pack_id"])}

    def h_createReportingTask(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["review_id", "brief_id", "title", "questions", "assertion_ids", "conflict_ids", "unknown_ids", "assignee_id"])
        self.v_text(b.get("title"), "title", 1, 300)
        qs = b.get("questions")
        if not isinstance(qs, list) or len(qs) < 1 or len(qs) > 20:
            raise invalid("questions", "취재 질문은 1개에서 20개 사이여야 한다.")
        for q in qs:
            self.v_text(q, "questions", 1, 500)
        if len(set(qs)) != len(qs):
            raise invalid("questions", "같은 질문이 중복되었다.")
        a_ids = self.v_uuid_set(b.get("assertion_ids"), "assertion_ids", 0, 100)
        c_ids = self.v_uuid_set(b.get("conflict_ids"), "conflict_ids", 0, 100)
        u_ids = self.v_uuid_set(b.get("unknown_ids"), "unknown_ids", 0, 100)
        origin = self.origin_view(c, b)
        if len(a_ids) + len(c_ids) + len(u_ids) < 1:
            raise invalid("unknown_ids", "원본 검토의 주장·상충·공백 참조가 하나 이상 필요하다.")
        if origin["kind"] == "BRIEF" and a_ids:
            raise invalid("assertion_ids", "초안 없는 Brief 과제에는 주장 참조를 넣지 않는다.")
        if origin["kind"] == "REVIEW" and not all(any(it["assertion_id"] == i for it in origin["view"]["items"]) for i in a_ids):
            raise invalid("assertion_ids", "원본 검토에 속하지 않은 주장이다.")
        if not all(i in origin["pack"]["conflict_ids"] for i in c_ids):
            raise invalid("conflict_ids", "원본 view에 속하지 않은 상충이다.")
        if not all(i in origin["pack"]["unknown_ids"] for i in u_ids):
            raise invalid("unknown_ids", "원본 view에 속하지 않은 공백이다.")
        assignee = None
        if b.get("assignee_id") is not None:
            if not self.member_active(b["assignee_id"]):
                raise invalid("assignee_id", "같은 workspace의 활성 사용자만 담당자로 지정할 수 있다.")
            assignee = b["assignee_id"]
        view = origin["view"]
        norm = {"review_id": view["id"] if origin["kind"] == "REVIEW" else None, "brief_id": view["id"] if origin["kind"] == "BRIEF" else None,
                "title": b["title"], "questions": qs, "assertion_ids": sorted(a_ids), "conflict_ids": sorted(c_ids),
                "unknown_ids": sorted(u_ids), "assignee_id": assignee}

        def create():
            task = {
                "id": new_uuid(), "case_id": c["id"], "review_id": norm["review_id"], "brief_id": norm["brief_id"],
                "state_version_id": view["state_version_id"], "content_version_id": view["content_version_id"],
                "reality_pack_id": view["reality_pack_id"], "title": b["title"], "questions": clone(qs), "assertion_ids": a_ids,
                "conflict_ids": c_ids, "unknown_ids": u_ids, "assignee_id": assignee, "status": "OPEN", "row_version": 1,
                "created_at": self.now_iso(), "updated_at": self.now_iso(),
            }
            self.store.put("tasks", task)
            self.emit("core.task.created", ctx["actor"], [task["id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            return {"case_id": c["id"], "task_id": task["id"]}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    def respond_createReportingTask(self, ref, reused):
        return {"task": self.task_dto(self.store.get("tasks", ref["task_id"])), "reused": reused}

    def h_listReportingTasks(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": {"items": [self.task_dto(t) for t in self.by_created_desc(self.by_case("tasks", c["id"]))], "next_cursor": None}}

    def h_getReportingTask(self, ctx):
        c = self.case_or_404(ctx)
        t = self.in_case("tasks", ctx["params"].get("task_id"), c["id"])
        return {"data": self.task_dto(t), "headers": {"ETag": f'"{t["row_version"]}"'}}

    def h_updateReportingTask(self, ctx):
        c = self.case_or_404(ctx)
        t = self.in_case("tasks", ctx["params"].get("task_id"), c["id"])
        m = re.match(r'^"(\d+)"$', ctx["if_match"]) if isinstance(ctx.get("if_match"), str) else None
        if not m:
            raise invalid("If-Match", "조회한 과제 version을 따옴표와 함께 If-Match로 보내야 한다.")
        b = ctx["body"]
        self.closed(b, ["status", "reason"])
        self.v_enum(b.get("status"), "status", ["DONE", "CANCELLED"])
        self.v_text(b.get("reason"), "reason", 1, 500)
        if int(m.group(1)) != t["row_version"]:
            raise err("TASK_VERSION_CONFLICT")
        if t["status"] != "OPEN":
            raise err("TASK_NOT_OPEN")
        t["status"] = b["status"]
        t["row_version"] += 1
        t["updated_at"] = self.now_iso()
        self.store.touch("tasks", t)
        self.emit("core.task.status_changed", ctx["actor"], [t["id"]], case_id=c["id"], correlation_id=ctx["correlation_id"],
                  detail={"status": t["status"], "reason": b["reason"]})
        return {"data": self.task_dto(t), "headers": {"ETag": f'"{t["row_version"]}"'}}

    # ================================================================ reporting results
    def h_createReportingResult(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["task_id", "submission_ids", "note", "question_ids"])
        task = self.in_case("tasks", self.v_uuid(b.get("task_id"), "task_id"), c["id"], "task_id")
        sub_ids = self.v_uuid_set(b.get("submission_ids"), "submission_ids", 1, 20)
        q_ids = self.v_uuid_set(b.get("question_ids"), "question_ids", 1, 20)
        note = "" if b.get("note") is None else b["note"]
        if not isinstance(note, str) or cp_len(note) > 5000:
            raise invalid("note", "메모는 5000자까지다.")
        if task["status"] == "CANCELLED":
            raise err("TASK_CANCELLED")
        for i in sub_ids:
            self.in_case("submissions", i, c["id"], "submission_ids")
        pack = self.store.get("packs", task["reality_pack_id"])
        allowed = [q["id"] for q in self.pack_questions(pack)]
        if not all(i in allowed for i in q_ids):
            raise invalid("question_ids", "과제 원본 view에 속하지 않은 질문이다.")
        norm = {"task_id": task["id"], "submission_ids": sorted(sub_ids), "note": note, "question_ids": sorted(q_ids)}

        def create():
            r = {"id": new_uuid(), "case_id": c["id"], "task_id": task["id"], "submission_ids": sub_ids, "note": note,
                 "question_ids": q_ids, "received_at": self.now_iso(), "created_at": self.now_iso()}
            self.store.put("results", r)
            self.emit("core.reporting_result.created", ctx["actor"], [r["id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            return {"case_id": c["id"], "result_id": r["id"]}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    def respond_createReportingResult(self, ref, reused):
        return {"result": self.result_dto(self.store.get("results", ref["result_id"])), "reused": reused}

    def h_getReportingResult(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.result_dto(self.in_case("results", ctx["params"].get("result_id"), c["id"]))}

    # ================================================================ reassessment
    def h_createReassessment(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["baseline_review_id", "reporting_result_ids", "as_of", "allow_partial"])
        baseline = self.in_case("reviews", self.v_uuid(b.get("baseline_review_id"), "baseline_review_id"), c["id"], "baseline_review_id")
        res_ids = self.v_uuid_set(b.get("reporting_result_ids"), "reporting_result_ids", 1, 20)
        as_of = self.v_time(b.get("as_of"), "as_of")
        allow_partial = self.v_bool(b.get("allow_partial"), "allow_partial", False)
        if baseline["status"] not in ("COMPLETED", "PARTIAL"):
            raise invalid("baseline_review_id", "완료된 검토만 재검토의 기준이 될 수 있다.")
        results = [self.in_case("results", i, c["id"], "reporting_result_ids") for i in res_ids]
        if as_of < ms_of(baseline["as_of"]):
            raise err("REALITY_AS_OF_PRECEDES_BASELINE")
        subs = self._uniq_subs([self.store.get("submissions", i) for r in results for i in r["submission_ids"]])
        for s in subs:
            if ms_of(s["received_at"]) > as_of:
                raise err("AS_OF_SOURCE_UNAVAILABLE")
        self.provider_for(c).precheck_reassessment(self, c, baseline=baseline, subs=subs, as_of_ms=as_of, actor=ctx["actor"])
        norm = {"baseline_review_id": baseline["id"], "reporting_result_ids": sorted(res_ids), "as_of": iso(as_of), "allow_partial": allow_partial}

        def create():
            re_ = {
                "id": new_uuid(), "case_id": c["id"], "job_id": new_uuid(), "baseline_review_id": baseline["id"],
                "reporting_result_ids": res_ids, "as_of": iso(as_of), "allow_partial": allow_partial, "status": None,
                "result_pack_id": None, "result_review_id": None, "delta_id": None, "head_updated": False, "warnings": [],
                "error_code": None, "created_at": self.now_iso(), "completed_at": None, "correlation_id": ctx["correlation_id"],
            }
            self.store.put("reassessments", re_)
            base_pack = self.store.get("packs", baseline["reality_pack_id"])
            pin = {**(self.pin_head(c["id"]) or {}), "pack_id": base_pack["id"], "review_id": baseline["id"]}
            self.emit("core.reassessment.queued", ctx["actor"], [re_["id"], re_["job_id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            self.enqueue("reassessment", re_["job_id"], c["id"], ("reassessments", re_["id"]), {
                "sub_ids": [s["id"] for s in subs], "pin": pin, "actor_id": ctx["actor"].get("actor_id"),
                "demo_only": bool(ctx["actor"].get("demo_only"))})
            return {"case_id": c["id"], "reassessment_id": re_["id"]}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    def respond_createReassessment(self, ref, reused):
        r = self.store.get("reassessments", ref["reassessment_id"])
        return {"job_id": r["job_id"], "resource_id": r["id"], "status": self.reassessment_dto(r)["status"], "reused": reused}

    def h_getReassessment(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.reassessment_dto(self.in_case("reassessments", ctx["params"].get("reassessment_id"), c["id"]))}

    def h_getReviewDelta(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.delta_dto(self.in_case("deltas", ctx["params"].get("delta_id"), c["id"]))}

    # ================================================================ research search
    def h_createResearchSearch(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["baseline_pack_id", "question_id", "question", "as_of", "parameters"])
        pack = self.in_case("packs", self.v_uuid(b.get("baseline_pack_id"), "baseline_pack_id"), c["id"], "baseline_pack_id")
        self.v_uuid(b.get("question_id"), "question_id")
        self.v_text(b.get("question"), "question", 1, 2000)
        as_of = self.v_time(b.get("as_of"), "as_of")
        parameters = self.v_params(b.get("parameters"))
        q = next((x for x in self.pack_questions(pack) if x["id"] == b["question_id"]), None)
        if not q:
            raise invalid("question_id", "고정한 근거 view에 없는 질문이다.")
        self.provider_for(c).precheck_search(self, c, pack=pack, question=q, actor=ctx["actor"])
        norm = {"baseline_pack_id": pack["id"], "question_id": q["id"], "question": b["question"], "as_of": iso(as_of), "parameters": parameters}

        def create():
            s = {
                "id": new_uuid(), "case_id": c["id"], "job_id": new_uuid(), "baseline_pack_id": pack["id"], "question_id": q["id"],
                "question": b["question"], "as_of": iso(as_of), "status": None, "parameters": parameters,
                "plan": [{"purpose": "UNKNOWN_DRIVEN", "query": b["question"]}],
                "coverage": {"planned_channels": [], "completed_channels": [], "failed_channels": [], "deferred_source_count": 0},
                "new_submission_ids": [], "candidate_pack_id": None, "query_used": 0, "source_used": 0, "warnings": [],
                "error_code": None, "created_at": self.now_iso(), "completed_at": None, "correlation_id": ctx["correlation_id"],
            }
            self.store.put("searches", s)
            self.emit("core.search.queued", ctx["actor"], [s["id"], s["job_id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            self.enqueue("search", s["job_id"], c["id"], ("searches", s["id"]),
                         {"actor_id": ctx["actor"].get("actor_id"), "demo_only": bool(ctx["actor"].get("demo_only"))})
            return {"case_id": c["id"], "search_id": s["id"]}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    def respond_createResearchSearch(self, ref, reused):
        s = self.store.get("searches", ref["search_id"])
        return {"search_id": s["id"], "job_id": s["job_id"], "status": self.search_dto(s)["status"], "reused": reused}

    def h_getResearchSearch(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.search_dto(self.in_case("searches", ctx["params"].get("search_id"), c["id"]))}

    # ================================================================ notifications
    def h_listNotifications(self, ctx):
        c = self.case_or_404(ctx)
        items = self.by_created_desc(self.by_case("notifications", c["id"]))
        return {"data": {"items": [self.notification_dto(n, ctx["actor"]["actor_id"]) for n in items], "next_cursor": None}}

    def h_markNotificationRead(self, ctx):
        c = self.case_or_404(ctx)
        n = self.in_case("notifications", ctx["params"].get("notification_id"), c["id"])
        self.closed(ctx["body"], ["read"])
        if ctx["body"].get("read") is not True:
            raise invalid("read", "read는 true만 받는다.")
        aid = ctx["actor"]["actor_id"]
        if not any(r["notification_id"] == n["id"] and r["actor_id"] == aid for r in self.store.all("reads")):
            self.store.put("reads", {"id": new_uuid(), "case_id": c["id"], "notification_id": n["id"], "actor_id": aid, "read_at": self.now_iso()})
            self.emit("core.notification.read", ctx["actor"], [n["id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
        return {"data": self.notification_dto(n, aid)}

    # ================================================================ editorial export
    def h_createEditorialExport(self, ctx):
        c = self.case_or_404(ctx)
        b = ctx["body"]
        self.closed(b, ["input_kind", "input_id", "format"])
        self.v_enum(b.get("input_kind"), "input_kind", ["BRIEF", "DRAFT_REVIEW"])
        self.v_uuid(b.get("input_id"), "input_id")
        self.v_enum(b.get("format"), "format", ["JSON", "PDF", "DOCX"])
        view = (self.in_case("briefs", b["input_id"], c["id"], "input_id") if b["input_kind"] == "BRIEF"
                else self.in_case("reviews", b["input_id"], c["id"], "input_id"))
        if view["status"] not in ("COMPLETED", "PARTIAL"):
            raise invalid("input_id", "완료된 검토 또는 Brief만 출력할 수 있다.")
        if not self.renderers.get(b["format"]):
            raise err("CONFIGURATION_BLOCKED", field="format", reason=f"{b['format']} 보고서 렌더러가 설정되지 않았다.",
                      message="보고서 출력에 필요한 설정이 없다.")
        norm = {"input_kind": b["input_kind"], "input_id": view["id"], "format": b["format"]}

        def create():
            snapshot = self.build_snapshot(c, b["input_kind"], view)
            if self.blocked_deps(snapshot):
                raise err("EXPORT_RIGHTS_BLOCKED")
            x = {
                "id": new_uuid(), "case_id": c["id"], "job_id": new_uuid(), "input_kind": b["input_kind"], "input_id": view["id"],
                "format": b["format"], "status": None, "snapshot": snapshot, "snapshot_sha256": sha256hex(canon(snapshot)),
                "media_type": None, "filename": None, "sha256": None, "size_bytes": None, "warnings": clone(view["warnings"]),
                "error_code": None, "created_at": self.now_iso(), "completed_at": None, "correlation_id": ctx["correlation_id"],
            }
            self.store.put("exports", x)
            self.emit("core.export.queued", ctx["actor"], [x["id"], x["job_id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            self.enqueue("export", x["job_id"], c["id"], ("exports", x["id"]), {"actor_id": ctx["actor"].get("actor_id")})
            return {"case_id": c["id"], "export_id": x["id"]}
        return {"data": self.idempotent(ctx, c["id"], norm, create)}

    def respond_createEditorialExport(self, ref, reused):
        x = self.store.get("exports", ref["export_id"])
        return {"export_id": x["id"], "job_id": x["job_id"], "status": self.export_dto(x)["status"], "reused": reused}

    def h_getEditorialExport(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.export_dto(self.in_case("exports", ctx["params"].get("export_id"), c["id"]))}

    def h_downloadEditorialExport(self, ctx):
        c = self.case_or_404(ctx)
        x = self.in_case("exports", ctx["params"].get("export_id"), c["id"])
        if x["status"] == "COMPLETED" and self.blocked_deps(x["snapshot"]):
            x["status"] = "BLOCKED"
            x["error_code"] = "EXPORT_RIGHTS_BLOCKED"
            self.store.touch("exports", x)
            self.emit("core.export.access_blocked", ctx["actor"], [x["id"]], case_id=c["id"], correlation_id=ctx["correlation_id"])
            self.store.flush()
        if x["status"] == "BLOCKED":
            raise err("EXPORT_RIGHTS_BLOCKED")
        if x["status"] != "COMPLETED":
            raise err("EXPORT_NOT_READY")
        data = self.store.get_artifact(x["id"])
        if not data or sha256hex(data) != x["sha256"] or len(data) != x["size_bytes"]:
            raise err("EXPORT_NOT_READY", reason="저장된 파일이 기록과 일치하지 않는다.")
        return {"data": None, "binary": data,
                "headers": {"Content-Type": x["media_type"], "Content-Disposition": f'attachment; filename="{x["filename"]}"'}}

    def h_getExportSnapshot(self, ctx):
        c = self.case_or_404(ctx)
        x = self.in_case("exports", ctx["params"].get("export_id"), c["id"])
        if x["status"] != "COMPLETED" or self.blocked_deps(x["snapshot"]):
            raise err("EXPORT_NOT_READY")
        return {"data": {"snapshot": clone(x["snapshot"]), "snapshot_sha256": x["snapshot_sha256"]}}

    # ================================================================ runtime reads
    def h_whoami(self, ctx):
        a = ctx["actor"]
        return {"data": {"actor_id": a["actor_id"], "name": a["name"], "role": a["role"], "workspace_id": self.WS,
                         "email": a.get("email"), "demo_only": bool(a.get("demo_only")), "server_time": self.now_iso(),
                         "live_model": bool(self.providers.get("openai") and self.providers["openai"].configured()),
                         "ephemeral": bool(getattr(self.settings, "ephemeral", False))}}

    def h_listWorkspaceMembers(self, ctx):
        return {"data": {"items": [{"actor_id": m["actor_id"], "name": m["name"], "role": m["role"]} for m in self.members() if m["active"]]}}

    def h_getRealityBoard(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": self.board_of(self.in_case("packs", ctx["params"].get("pack_id"), c["id"], "pack_id"))}

    def h_getEvidenceTrace(self, ctx):
        c = self.case_or_404(ctx)
        pack = self.in_case("packs", ctx["params"].get("pack_id"), c["id"], "pack_id")
        return {"data": self.trace_of(pack, ctx["params"].get("claim_id"))}

    def h_listAuditEvents(self, ctx):
        c = self.case_or_404(ctx)
        return {"data": {"items": self.store.events_for_case(c["id"])}}

    @staticmethod
    def default_policy():
        return {"monitoring_enabled": False, "cadence_minutes": 1440, "query_budget": 10, "source_budget": 30}

    def h_getMonitoringPolicy(self, ctx):
        self.case_or_404(ctx)
        return {"data": {"environment_enabled": False, "policy": self.default_policy()}}

    def h_setMonitoringPolicy(self, ctx):
        self.case_or_404(ctx)
        raise err("MONITORING_DISABLED")

    def h_getMonitoringFeed(self, ctx):
        self.case_or_404(ctx)
        return {"data": {"changes": [], "runs": []}}

    def h_getCaseLedger(self, ctx):
        """Every resource id of one case, so a browser can rebuild what it is following."""
        c = self.case_or_404(ctx)
        cid = c["id"]

        def ids(coll):
            return [o["id"] for o in sorted(self.by_case(coll, cid), key=lambda o: (o.get("created_at") or "", o["id"]))]
        briefs = sorted(self.by_case("briefs", cid), key=lambda o: o["created_at"])
        corr = {}
        for coll in ("executions", "reviews", "briefs", "reassessments", "searches", "exports"):
            for o in self.by_case(coll, cid):
                if o.get("correlation_id"):
                    corr[o["id"]] = o["correlation_id"]
        return {"data": {
            "execution": ids("executions"), "review": ids("reviews"), "brief": [b["id"] for b in briefs],
            "reassessment": ids("reassessments"), "delta": ids("deltas"), "search": ids("searches"), "export": ids("exports"),
            "result": ids("results"), "submission": ids("submissions"), "pack": ids("packs"),
            "modes": {s["id"]: s["mode"] for s in self.by_case("states", cid)},
            "corr": corr, "briefByPack": {b["reality_pack_id"]: b["id"] for b in briefs},
            "demo": bool(c.get("demo")),
        }}
