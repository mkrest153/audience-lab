"""What each resource looks like on the wire (closed shapes of the specification)."""
from __future__ import annotations

from ..util import clone


class DtoMixin:
    def case_dto(self, c):
        return {"id": c["id"], "workspace_id": self.WS, "title": c["title"], "as_of": c["as_of"],
                "created_at": c["created_at"], "head": self.head_of(c["id"])}

    def content_dto(self, v):
        body = v["body"]
        if v["origin"] == "REAL_WORLD_SOURCE":
            sub = next((s for s in self.store.all("submissions") if s.get("content_version_id") == v["id"]), None)
            if sub and sub.get("source_id"):
                src = self.store.get("sources", sub["source_id"])
                if src and not self.readable(src):
                    body = None
        return {"id": v["id"], "workspace_id": self.WS, "case_id": v["case_id"], "version_number": v["version_number"],
                "origin": v["origin"], "body": body, "body_sha256": v["body_sha256"], "as_of": v["as_of"],
                "sensitivity": v["sensitivity"], "created_at": v["created_at"]}

    def state_dto(self, s):
        return {"id": s["id"], "workspace_id": self.WS, "case_id": s["case_id"], "version_number": s["version_number"],
                "state": clone(s["state"]), "reason": s["reason"], "created_at": s["created_at"]}

    def submission_dto(self, s):
        status = s["status"]
        if s.get("source_id") and s["access_mode"] == "FULL_TEXT":
            src = self.store.get("sources", s["source_id"])
            if src and not self.readable(src):
                status = "BLOCKED"
        return {"id": s["id"], "workspace_id": self.WS, "case_id": s["case_id"], "title": s["title"],
                "source_url": s["source_url"], "transcript_locator": s["transcript_locator"],
                "content_version_id": s["content_version_id"], "body_sha256": s["body_sha256"],
                "recorded_at": s["recorded_at"], "received_at": s["received_at"], "sensitivity": s["sensitivity"],
                "rights_class": s["rights_class"], "access_mode": s["access_mode"], "status": status,
                "source_id": s.get("source_id"), "revision_id": s.get("revision_id")}

    def execution_dto(self, e):
        live = self.live(e)
        return {"id": e["id"], "workspace_id": self.WS, "case_id": e["case_id"], "job_id": e["job_id"], "mode": e["mode"],
                "state_version_id": e["state_version_id"], "content_version_id": e["content_version_id"],
                "baseline_pack_id": e["baseline_pack_id"], "submission_ids": clone(e["submission_ids"]),
                "reporting_result_ids": clone(e["reporting_result_ids"]), "as_of": e["as_of"],
                "allow_partial": e["allow_partial"], "parameters": clone(e["parameters"]),
                "status": live["status"], "stage": live["stage"], "result_pack_id": e["result_pack_id"],
                "head_updated": e["head_updated"], "warnings": clone(e["warnings"]), "error_code": e["error_code"],
                "created_at": e["created_at"], "completed_at": e["completed_at"]}

    def review_dto(self, r):
        live = self.live(r)
        return {"id": r["id"], "workspace_id": self.WS, "case_id": r["case_id"], "content_version_id": r["content_version_id"],
                "state_version_id": r["state_version_id"], "reality_pack_id": r["reality_pack_id"], "as_of": r["as_of"],
                "status": live["status"], "row_version": r["row_version"], "allow_partial": r["allow_partial"],
                "created_at": r["created_at"], "completed_at": r["completed_at"], "error_code": r["error_code"],
                "items": clone(r["items"]), "questions": clone(r["questions"]),
                "question_assessments": clone(r["question_assessments"]), "warnings": clone(r["warnings"])}

    def brief_dto(self, b):
        return {"id": b["id"], "workspace_id": self.WS, "case_id": b["case_id"], "state_version_id": b["state_version_id"],
                "content_version_id": b["content_version_id"], "reality_pack_id": b["reality_pack_id"], "as_of": b["as_of"],
                "status": b["status"], "sections": clone(b["sections"]), "questions": clone(b["questions"]),
                "question_assessments": clone(b["question_assessments"]), "action_overlay": clone(b["action_overlay"]),
                "warnings": clone(b["warnings"]), "created_at": b["created_at"]}

    def task_dto(self, t):
        return {"id": t["id"], "workspace_id": self.WS, "case_id": t["case_id"], "review_id": t["review_id"],
                "brief_id": t["brief_id"], "state_version_id": t["state_version_id"],
                "content_version_id": t["content_version_id"], "reality_pack_id": t["reality_pack_id"], "title": t["title"],
                "questions": clone(t["questions"]), "assertion_ids": clone(t["assertion_ids"]),
                "conflict_ids": clone(t["conflict_ids"]), "unknown_ids": clone(t["unknown_ids"]),
                "assignee_id": t["assignee_id"], "status": t["status"], "row_version": t["row_version"],
                "created_at": t["created_at"], "updated_at": t["updated_at"]}

    def result_dto(self, r):
        return {"id": r["id"], "workspace_id": self.WS, "case_id": r["case_id"], "task_id": r["task_id"],
                "submission_ids": clone(r["submission_ids"]), "note": r["note"], "note_kind": "USER_NOTE",
                "question_ids": clone(r["question_ids"]), "received_at": r["received_at"]}

    def reassessment_dto(self, r):
        live = self.live(r)
        return {"id": r["id"], "workspace_id": self.WS, "case_id": r["case_id"], "job_id": r["job_id"],
                "baseline_review_id": r["baseline_review_id"], "reporting_result_ids": clone(r["reporting_result_ids"]),
                "as_of": r["as_of"], "allow_partial": r["allow_partial"], "status": live["status"], "stage": live["stage"],
                "result_pack_id": r["result_pack_id"], "result_review_id": r["result_review_id"], "delta_id": r["delta_id"],
                "head_updated": r["head_updated"], "warnings": clone(r["warnings"]), "error_code": r["error_code"],
                "created_at": r["created_at"], "completed_at": r["completed_at"]}

    @staticmethod
    def delta_dto(d):
        return clone(d)

    def search_dto(self, s):
        live = self.live(s)
        return {"id": s["id"], "workspace_id": self.WS, "case_id": s["case_id"], "job_id": s["job_id"],
                "baseline_pack_id": s["baseline_pack_id"], "question_id": s["question_id"], "question": s["question"],
                "as_of": s["as_of"], "status": live["status"], "parameters": clone(s["parameters"]), "plan": clone(s["plan"]),
                "coverage": clone(s["coverage"]), "new_submission_ids": clone(s["new_submission_ids"]),
                "candidate_pack_id": s["candidate_pack_id"], "query_used": s["query_used"], "source_used": s["source_used"],
                "warnings": clone(s["warnings"]), "error_code": s["error_code"], "created_at": s["created_at"],
                "completed_at": s["completed_at"]}

    def notification_dto(self, n, actor_id):
        read = next((r for r in self.store.all("reads") if r["notification_id"] == n["id"] and r["actor_id"] == actor_id), None)
        return {"id": n["id"], "workspace_id": self.WS, "case_id": n["case_id"], "change_id": n["change_id"],
                "priority": n["priority"], "change_type": n["change_type"], "title": n["title"],
                "created_at": n["created_at"], "read_at": read["read_at"] if read else None}

    def export_dto(self, x):
        live = self.live(x)
        return {"id": x["id"], "workspace_id": self.WS, "case_id": x["case_id"], "job_id": x["job_id"],
                "input_kind": x["input_kind"], "input_id": x["input_id"], "format": x["format"], "status": live["status"],
                "snapshot_sha256": x["snapshot_sha256"], "media_type": x["media_type"], "filename": x["filename"],
                "sha256": x["sha256"], "size_bytes": x["size_bytes"], "warnings": clone(x["warnings"]),
                "error_code": x["error_code"], "created_at": x["created_at"], "completed_at": x["completed_at"]}
