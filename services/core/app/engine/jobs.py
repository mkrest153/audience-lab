"""Background work: evidence runs, reviews, reassessments, searches, exports.

Jobs are stored like every other object. A worker claims one, runs the slow
provider calls outside the lock and commits each step under the lock, so a
reader always sees a consistent state. A job left running by a restart is
picked up again (every step is safe to repeat) or failed after three tries.
"""
from __future__ import annotations

import logging
import time
import traceback

from ..errors import ApiError
from ..providers.base import ProviderError
from ..util import clone, ms_of, new_uuid, sha256hex, uniq

log = logging.getLogger("audience_lab.jobs")
MAX_ATTEMPTS = 3


class JobsMixin:
    # ---------------------------------------------------------------- scheduling
    def claim_next_job(self):
        with self.store.lock:
            busy = {j["case_id"] for j in self.store.all("jobs") if j["state"] == "running"}
            # one job per case at a time keeps source registration and head moves in order
            pending = [j for j in self.store.all("jobs") if j["state"] == "pending" and j["case_id"] not in busy]
            if not pending:
                return None
            job = min(pending, key=lambda j: (j.get("seq", 0), j["created_at"]))
            job["state"] = "running"
            job["attempts"] = job.get("attempts", 0) + 1
            job["started_at"] = self.now_iso()
            self.store.touch("jobs", job)
            self.store.flush()
            return job

    def recover_jobs(self):
        """After a restart: jobs that were running go back to the queue (or fail)."""
        with self.store.lock:
            for job in self.store.all("jobs"):
                if job["state"] != "running":
                    continue
                if job.get("attempts", 0) >= MAX_ATTEMPTS:
                    self._fail(job, "JOB_INTERRUPTED", "작업이 여러 번 중단되어 실패로 끝냈다.")
                else:
                    job["state"] = "pending"
                    job["stage"] = "QUEUED"
                    self.store.touch("jobs", job)
            self.store.flush()

    def drain(self, limit=200):
        """Run every queued job in this thread (tests and seeding)."""
        for _ in range(limit):
            job = self.claim_next_job()
            if not job:
                return
            self.run_job(job)

    def run_job(self, job):
        try:
            getattr(self, "job_" + job["kind"])(job)
        except ProviderError as e:
            with self.store.lock:
                self._fail(job, e.code, e.message)
                self.store.flush()
        except ApiError as e:
            with self.store.lock:
                self._fail(job, e.code, e.message)
                self.store.flush()
        except Exception:  # noqa: BLE001
            log.error("job %s %s failed\n%s", job["kind"], job["id"], traceback.format_exc())
            with self.store.lock:
                self.store.rollback()
                self._fail(job, "INTERNAL_ERROR", "작업 중 서버 오류가 났다.")
                self.store.flush()

    def set_stage(self, job, stage, provider=None):
        with self.store.lock:
            job = self.store.get("jobs", job["id"]) or job
            job["stage"] = stage
            self.store.touch("jobs", job)
            self.store.flush()
        delay = getattr(provider, "stage_delay", 0) or 0
        if delay:
            time.sleep(delay)

    def _done(self, job):
        job = self.store.get("jobs", job["id"]) or job
        job["state"] = "done"
        job["stage"] = "TERMINAL"
        job["finished_at"] = self.now_iso()
        self.store.touch("jobs", job)

    def _fail(self, job, code, message):
        coll, rid = job["resource"]
        res = self.store.get(coll, rid)
        if res is not None and res.get("status") in (None, "RUNNING", "QUEUED"):
            res["status"] = "FAILED"
            res["error_code"] = code
            res["completed_at"] = self.now_iso()
            warnings = res.setdefault("warnings", [])
            if message and not any(w.get("code") == code for w in warnings):
                warnings.append({"code": code, "message": message, "object_ids": []})
            if coll == "reviews":
                res["items"], res["questions"], res["question_assessments"] = [], [], []
                res["row_version"] = res.get("row_version", 1) + 1
            self.store.touch(coll, res)
            event = {"executions": "core.reality.completed", "reviews": "core.review.completed",
                     "reassessments": "core.reassessment.completed", "searches": "core.search.completed",
                     "exports": "core.export.completed"}.get(coll)
            if event:
                self.emit(event, {"system": True, "initiating_actor_id": job["payload"].get("actor_id")}, [rid],
                          case_id=job["case_id"], detail="FAILED")
        job["error"] = code
        self._done(job)

    def _system(self, job):
        return {"system": True, "initiating_actor_id": job["payload"].get("actor_id")}

    def _guard_demo(self, job, provider):
        if job["payload"].get("demo_only") and not provider.demo:
            raise ProviderError("DEMO_ACCOUNT_LIMITED", "시연 계정으로는 실제 검색과 모델 판정을 실행할 수 없다.")

    # ---------------------------------------------------------------- shared steps
    def extract_claims_for(self, case, provider, keys, as_of):
        as_of_ms = ms_of(as_of)
        for key in keys:
            with self.store.lock:
                rev = self.rev_by_key(case["id"], key)
                src = self.source_of(rev)
                todo = (rev and not rev.get("claims_done") and rev.get("collection") == "OK" and self.readable(src, rev)
                        and (ms_of(rev["available_at"]) or 0) <= as_of_ms)
                if not todo:
                    continue
                rev_copy, src_copy = clone(rev), clone(src)
            drafts = provider.claims_for(self, case, rev_copy, src_copy)
            with self.store.lock:
                rev = self.store.get("revisions", rev_copy["id"])
                if not rev.get("claims_done"):
                    self.store_claims(self.store.get("cases", case["id"]), rev, drafts or [])
                self.store.flush()

    def rows_for(self, case, provider, content):
        cid = f"{content['id']}:{provider.name}"
        with self.store.lock:
            have = self.store.get("assertion_sets", cid)
            if have:
                return clone(have["rows"])
        drafts = provider.assertions_for(self, case, content)
        code = self.validate_assertions(content, drafts)
        if code:
            raise ProviderError(code, "문장 위치가 초안과 맞지 않아 검토를 저장하지 않았다.")
        rows = self.assertion_rows(content, drafts)
        with self.store.lock:
            self.store.put("assertion_sets", {"id": cid, "case_id": case["id"], "content_version_id": content["id"], "rows": rows,
                                              "created_at": self.now_iso()})
            self.store.flush()
        return clone(rows)

    def ordered_items(self, rows, items):
        by = {it["assertion_id"]: it for it in items}
        return [by[r["assertion_id"]] for r in rows if r["assertion_id"] in by]

    # ---------------------------------------------------------------- reality execution
    def job_reality(self, job):
        p = job["payload"]
        with self.store.lock:
            ex = self.store.get("executions", job["resource"][1])
            c = self.store.get("cases", ex["case_id"])
            provider = self.provider_for(c)
            state = clone(self.store.get("states", ex["state_version_id"]))
            content = clone(self.store.get("contents", ex["content_version_id"])) if ex["content_version_id"] else None
            baseline = clone(self.store.get("packs", ex["baseline_pack_id"])) if ex["baseline_pack_id"] else None
        self.set_stage(job, "INGEST", provider)
        discovered = None
        channel_failed = False
        if p["searched"]:
            self._guard_demo(job, provider)
            discovered = provider.discover(self, c, state=state, content=content, as_of_ms=ms_of(ex["as_of"]), parameters=ex["parameters"])
            if discovered.get("all_failed"):
                with self.store.lock:
                    ex = self.store.get("executions", ex["id"])
                    ex.update(status="FAILED", error_code=discovered.get("error_code") or "ALL_SEARCH_CHANNELS_FAILED",
                              completed_at=self.now_iso(), warnings=[self.warn("search_channel")] + discovered.get("warnings", []))
                    self.store.touch("executions", ex)
                    self.emit("core.reality.completed", self._system(job), [ex["id"]], case_id=c["id"], detail="FAILED")
                    self._done(job)
                    self.store.flush()
                return
            channel_failed = bool(discovered.get("channel_failed"))
            if channel_failed and not ex["allow_partial"]:
                with self.store.lock:
                    ex = self.store.get("executions", ex["id"])
                    ex.update(status="FAILED", error_code="PARTIAL_SOURCE_COLLECTION", completed_at=self.now_iso(),
                              warnings=[self.warn("partial")])
                    self.store.touch("executions", ex)
                    self.emit("core.reality.completed", self._system(job), [ex["id"]], case_id=c["id"], detail="FAILED")
                    self._done(job)
                    self.store.flush()
                return
        elif p.get("sub_ids") and not provider.demo:
            self._guard_demo(job, provider)
        with self.store.lock:
            c = self.store.get("cases", ex["case_id"])
            candidate = list(baseline["candidate_keys"]) if baseline else []
            for d in (discovered or {}).get("sources", []):
                rev = self.register_source(c, d, via="SEARCH", available_at=d.get("available_at") or ex["as_of"])
                candidate.append(rev["key"])
            for sid in p.get("sub_ids", []):
                sub = self.store.get("submissions", sid)
                rev = self.accept_submission(c, sub)
                candidate.append(rev["key"])
            candidate = uniq(candidate)
            self.store.flush()
        self.set_stage(job, "REALITY", provider)
        self.extract_claims_for(c, provider, candidate, ex["as_of"])
        with self.store.lock:
            plan = self.plan_pack(c, as_of=ex["as_of"], candidate_keys=candidate, parent=baseline, mode=ex["mode"],
                                  channel_failed=channel_failed, failed_keys=set((discovered or {}).get("failed_keys") or []))
            claims = clone(self.pack_claims(plan))
        synthesis = provider.synthesize(self, c, pack=clone(plan), claims=claims, parent=baseline, state=state, content=content)
        self.set_stage(job, "COMMIT", provider)
        with self.store.lock:
            ex = self.store.get("executions", ex["id"])
            done = self.now_iso()
            pack = self.finish_pack(c, plan, synthesis, baseline, created_at=done)
            ex["result_pack_id"] = pack["id"]
            ex["warnings"] = clone(pack["warnings"]) + clone((discovered or {}).get("warnings", []))
            ex["question_assessments"] = self.assess_questions(pack, ex["id"])
            ex["status"] = pack["status"]
            ex["completed_at"] = done
            pin = p.get("pin") or {}
            ex["head_updated"] = self.head_cas(c["id"], {**pin, "pack_id": baseline["id"] if baseline else pin.get("pack_id")},
                                               lambda h: h.update(pack_id=pack["id"]))
            if not ex["head_updated"]:
                ex["warnings"].append(self.warn("branch"))
            self.store.touch("executions", ex)
            self.emit("core.reality.completed", self._system(job), [ex["id"], pack["id"]], case_id=c["id"], detail=ex["status"])
            self._done(job)
            self.store.flush()

    # ---------------------------------------------------------------- draft review
    def job_review(self, job):
        p = job["payload"]
        with self.store.lock:
            r = self.store.get("reviews", job["resource"][1])
            c = self.store.get("cases", r["case_id"])
            provider = self.provider_for(c)
            content = clone(self.store.get("contents", r["content_version_id"]))
            pack = clone(self.store.get("packs", r["reality_pack_id"]))
            state = clone(self.store.get("states", r["state_version_id"]))
        self.set_stage(job, "RUNNING", provider)
        self._guard_demo(job, provider)
        rows = self.rows_for(c, provider, content)
        items = provider.assess(self, c, pack=pack, rows=rows, claims=self.pack_claims(pack), state=state)
        with self.store.lock:
            r = self.store.get("reviews", r["id"])
            code, why = self.validate_items(pack, rows, items)
            r["completed_at"] = self.now_iso()
            r["row_version"] += 1
            if code:
                r.update(items=[], questions=[], question_assessments=[], status="FAILED", error_code=code)
                r["warnings"].append({"code": code, "message": why or "모델 결과가 서버 검증을 통과하지 못했다.", "object_ids": []})
            else:
                r["items"] = self.ordered_items(rows, items)
                r["questions"] = self.pack_questions(pack)
                r["question_assessments"] = self.assess_questions(pack, r["id"])
                r["status"] = "PARTIAL" if pack["status"] == "PARTIAL" else "COMPLETED"
                r["error_code"] = None
                won = self.head_cas(c["id"], p.get("pin"), lambda h: h.update(review_id=r["id"]))
                if not won:
                    r["warnings"].append(self.warn("branch"))
            self.store.touch("reviews", r)
            self.emit("core.review.completed", self._system(job), [r["id"]], case_id=c["id"], detail=r["status"])
            self._done(job)
            self.store.flush()

    # ---------------------------------------------------------------- reassessment
    def job_reassessment(self, job):
        p = job["payload"]
        with self.store.lock:
            re_ = self.store.get("reassessments", job["resource"][1])
            c = self.store.get("cases", re_["case_id"])
            provider = self.provider_for(c)
            baseline = clone(self.store.get("reviews", re_["baseline_review_id"]))
            base_pack = clone(self.store.get("packs", baseline["reality_pack_id"]))
            content = clone(self.store.get("contents", baseline["content_version_id"]))
            state = clone(self.store.get("states", baseline["state_version_id"]))
        self.set_stage(job, "INGEST", provider)
        self._guard_demo(job, provider)
        with self.store.lock:
            c = self.store.get("cases", re_["case_id"])
            new_keys = [self.accept_submission(c, self.store.get("submissions", sid))["key"] for sid in p.get("sub_ids", [])]
            self.store.flush()
        self.set_stage(job, "REALITY", provider)
        candidate = uniq([*base_pack["candidate_keys"], *new_keys])
        self.extract_claims_for(c, provider, candidate, re_["as_of"])
        with self.store.lock:
            plan = self.plan_pack(c, as_of=re_["as_of"], candidate_keys=candidate, parent=base_pack, mode=base_pack["mode"])
            claims = clone(self.pack_claims(plan))
        synthesis = provider.synthesize(self, c, pack=clone(plan), claims=claims, parent=base_pack, state=state, content=content)
        with self.store.lock:
            pack = clone(plan)
            pack["synthesis"] = self.normalize_synthesis(c, pack, synthesis or {}, base_pack)
            pack["conflict_ids"] = [x["conflict_id"] for x in pack["synthesis"]["conflicts"]]
            pack["unknown_ids"] = [u["unknown_id"] for u in pack["synthesis"]["unknowns"]]
        self.set_stage(job, "REVIEW", provider)
        rows = self.rows_for(c, provider, content)
        items = provider.assess(self, c, pack=pack, rows=rows, claims=claims, state=state)
        self.set_stage(job, "COMMIT", provider)
        with self.store.lock:
            re_ = self.store.get("reassessments", re_["id"])
            done = self.now_iso()
            code, why = self.validate_items(pack, rows, items)
            if code:
                # nothing of the child view is exposed; the submitted material is kept
                re_.update(status="FAILED", error_code=code, completed_at=done, warnings=clone(pack["warnings"]) + [
                    {"code": code, "message": why or "모델 결과가 서버 검증을 통과하지 못했다.", "object_ids": []}])
                self.store.touch("reassessments", re_)
                self.emit("core.reassessment.completed", self._system(job), [re_["id"]], case_id=c["id"], detail="FAILED")
                self._done(job)
                self.store.flush()
                return
            pack["created_at"] = done
            self.store.put("packs", pack)
            review = {
                "id": new_uuid(), "case_id": c["id"], "job_id": re_["job_id"], "content_version_id": baseline["content_version_id"],
                "state_version_id": baseline["state_version_id"], "reality_pack_id": pack["id"], "as_of": re_["as_of"],
                "status": "PARTIAL" if pack["status"] == "PARTIAL" else "COMPLETED", "row_version": 2,
                "allow_partial": re_["allow_partial"], "created_at": re_["created_at"], "completed_at": done, "error_code": None,
                "items": self.ordered_items(rows, items), "questions": self.pack_questions(pack), "question_assessments": [],
                "warnings": clone(pack["warnings"]), "baseline_review_id": baseline["id"], "correlation_id": re_.get("correlation_id"),
            }
            review["question_assessments"] = self.assess_questions(pack, review["id"])
            self.store.put("reviews", review)
            delta = self.compute_delta(self.store.get("reviews", baseline["id"]), review, created_at=done, provider=provider)
            re_["result_pack_id"], re_["result_review_id"], re_["delta_id"] = pack["id"], review["id"], delta["id"]
            re_["warnings"] = clone(pack["warnings"])
            re_["head_updated"] = self.head_cas(c["id"], p.get("pin"), lambda h: h.update(pack_id=pack["id"], review_id=review["id"]))
            if not re_["head_updated"]:
                re_["warnings"].append(self.warn("branch"))
                review["warnings"].append(self.warn("branch"))
            re_["status"] = "COMPLETED"
            re_["completed_at"] = done
            self.store.touch("reassessments", re_)
            self.store.touch("reviews", review)
            self.emit("core.reassessment.completed", self._system(job), [re_["id"], pack["id"], review["id"], delta["id"]],
                      case_id=c["id"], detail=re_["status"])
            self._done(job)
            self.store.flush()

    # ---------------------------------------------------------------- research search
    def job_search(self, job):
        with self.store.lock:
            s = self.store.get("searches", job["resource"][1])
            c = self.store.get("cases", s["case_id"])
            provider = self.provider_for(c)
            pack = clone(self.store.get("packs", s["baseline_pack_id"]))
            question = next((q for q in self.pack_questions(pack) if q["id"] == s["question_id"]), None)
        self.set_stage(job, "RUNNING", provider)
        self._guard_demo(job, provider)
        out = provider.search_question(self, c, pack=pack, question_text=s["question"], question=question,
                                       as_of_ms=ms_of(s["as_of"]), parameters=s["parameters"])
        with self.store.lock:
            s = self.store.get("searches", s["id"])
            c = self.store.get("cases", s["case_id"])
            budget = s["parameters"]["source_budget"]
            found = out.get("sources") or []
            usable = [d for d in found if d.get("rights_class") == "OPEN" and d.get("body") and d.get("collection", "OK") == "OK"]
            new_ids = []
            for d in usable[:budget]:
                norm = {"title": d["title"][:300] or d["url"], "source_url": d["url"], "transcript_locator": None, "body": d["body"],
                        "recorded_at": d.get("published_at") or self.now_iso(), "sensitivity": "PUBLIC", "rights_class": "OPEN",
                        "family": d.get("family")}
                dup = next((x for x in self.by_case("submissions", c["id"]) if x["source_url"] == norm["source_url"]
                            and x.get("body_sha256") == sha256hex(d["body"])), None)
                sub = dup or self.register_submission(c, norm, origin="SEARCH", actor=self._system(job))
                new_ids.append(sub["id"])
            coverage = out.get("coverage") or s["coverage"]
            coverage = {**coverage, "deferred_source_count": max(0, len(usable) - budget) + coverage.get("deferred_source_count", 0)}
            s.update(coverage=coverage, plan=out.get("plan") or s["plan"],
                     query_used=min(out.get("query_used", 0), s["parameters"]["query_budget"]),
                     source_used=min(len(found), budget), new_submission_ids=uniq(new_ids), warnings=out.get("warnings") or [],
                     error_code=out.get("error_code"), status=out.get("status") or "COMPLETED", completed_at=self.now_iso())
            self.store.touch("searches", s)
            self.emit("core.search.completed", self._system(job), [s["id"], *new_ids], case_id=c["id"], detail=s["status"])
            self._done(job)
            self.store.flush()

    # ---------------------------------------------------------------- export
    def job_export(self, job):
        with self.store.lock:
            x = self.store.get("exports", job["resource"][1])
            snapshot = clone(x["snapshot"])
            members = [{"actor_id": m["actor_id"], "name": m["name"]} for m in self.members()]
        self.set_stage(job, "RUNNING")
        renderer = self.renderers.get(x["format"])

        def finish(status, code):
            x2 = self.store.get("exports", x["id"])
            x2["status"], x2["error_code"], x2["completed_at"] = status, code, self.now_iso()
            self.store.touch("exports", x2)
            self.emit("core.export.completed", self._system(job), [x2["id"]], case_id=x2["case_id"], detail=status)
            self._done(job)
            self.store.flush()
            return x2

        try:
            data = renderer(snapshot, {"members": members, "snapshot_sha256": x["snapshot_sha256"]})
        except Exception:  # noqa: BLE001
            log.error("render failed\n%s", traceback.format_exc())
            with self.store.lock:
                finish("FAILED", "EXPORT_RENDER_FAILED")
            return
        with self.store.lock:
            # rights are checked again right before completion
            if self.blocked_deps(x["snapshot"]):
                finish("BLOCKED", "EXPORT_RIGHTS_BLOCKED")
                return
            self.store.put_artifact(x["id"], bytes(data))
            stored = self.store.get_artifact(x["id"])
            if not stored or not self.sniff(x["format"], stored) or sha256hex(stored) != sha256hex(bytes(data)):
                finish("FAILED", "EXPORT_ARTIFACT_INVALID")
                return
            x2 = self.store.get("exports", x["id"])
            from .exports import MEDIA
            x2["media_type"] = MEDIA[x2["format"]]
            x2["filename"] = self.export_filename(x2)
            x2["sha256"] = sha256hex(stored)
            x2["size_bytes"] = len(stored)
            finish("COMPLETED", None)
