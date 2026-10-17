"""Editorial export: a pinned snapshot of one view, rendered to a real file."""
from __future__ import annotations

import json

from ..util import clone, uuid_from

MEDIA = {"JSON": "application/json", "PDF": "application/pdf",
         "DOCX": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


class ExportMixin:
    def lineage(self, view, kind):
        ids = [view["id"]]
        if kind == "DRAFT_REVIEW":
            cur = view
            while cur and cur.get("baseline_review_id"):
                ids.append(cur["baseline_review_id"])
                cur = self.store.get("reviews", cur["baseline_review_id"])
        else:
            pack = self.store.get("packs", view["reality_pack_id"])
            while pack and pack.get("parent_pack_id"):
                pack = self.store.get("packs", pack["parent_pack_id"])
                if not pack:
                    break
                ids.extend(b["id"] for b in self.store.all("briefs") if b["reality_pack_id"] == pack["id"])
        return ids

    def dependencies(self, pack, scope):
        out = []
        seen = set()
        by_rev = {}
        for c in self.pack_claims(pack):
            by_rev.setdefault(c["revision_id"], []).append(c)
        for key in pack["included_keys"]:
            rev = self.rev_by_key(pack["case_id"], key)
            s = self.source_of(rev)
            if not rev or not s:
                continue
            passages = [c["passage_id"] for c in by_rev.get(rev["id"], [])]
            if not passages:
                passages = [rev.get("passage_id") or uuid_from(f"{rev['id']}:passage:0:{len(rev.get('body') or '')}")]
            for pid in passages:
                if pid in seen:
                    continue
                seen.add(pid)
                out.append({"source_id": s["id"], "revision_id": rev["id"], "passage_id": pid, "title": s["title"], "url": s["url"],
                            "published_at": s.get("published_at"), "rights_class": self.rights_of(s), "scope_description": scope})
        return out

    def build_snapshot(self, c, kind, view):
        provider = self.providers.get(c.get("provider"))
        pack = self.store.get("packs", view["reality_pack_id"])
        state = self.store.get("states", view["state_version_id"])
        line = self.lineage(view, kind)
        tasks = sorted((t for t in self.store.all("tasks") if t["review_id"] in line or t["brief_id"] in line), key=lambda t: t["created_at"])
        delta = next((d for d in self.store.all("deltas") if d["after_review_id"] == view["id"]), None) if kind == "DRAFT_REVIEW" else None
        return {
            "input_kind": kind, "input_id": view["id"], "case_id": c["id"], "title": c["title"],
            "question": state["state"]["primary_editorial_question"], "as_of": view["as_of"],
            "content_version_id": view["content_version_id"], "state_version_id": view["state_version_id"],
            "reality_pack_id": pack["id"], "brief_id": view["id"] if kind == "BRIEF" else None,
            "review": self.review_dto(view) if kind == "DRAFT_REVIEW" else None,
            "brief_sections": clone(view["sections"]) if kind == "BRIEF" else self.compile_sections(pack, f"{view['id']}:report"),
            "action_overlay": clone(view["action_overlay"]) if kind == "BRIEF" else self.action_overlay(pack),
            "questions": clone(view["questions"]), "question_assessments": clone(view["question_assessments"]),
            "reporting_tasks": [self.task_dto(t) for t in tasks], "review_delta": self.delta_dto(delta) if delta else None,
            "source_dependencies": self.dependencies(pack, provider.scope_description() if provider else ""),
            "warnings": clone(view["warnings"]),
            "labels": provider.snapshot_labels() if provider else [],
        }

    def blocked_deps(self, snapshot):
        out = []
        for d in snapshot["source_dependencies"]:
            s = self.store.get("sources", d["source_id"])
            if not s or self.rights_of(s) != "OPEN":
                out.append(d)
        return out

    @staticmethod
    def sniff(fmt, data):
        if not isinstance(data, (bytes, bytearray)) or not data:
            return False
        if fmt == "PDF":
            return data[:4] == b"%PDF"
        if fmt == "DOCX":
            return data[:2] == b"PK"
        try:
            json.loads(data.decode("utf-8"))
            return True
        except (ValueError, UnicodeDecodeError):
            return False

    def export_filename(self, x):
        stamp = x["snapshot"]["as_of"].replace("-", "").replace(":", "").replace("T", "-")[:13]
        kind = "brief" if x["input_kind"] == "BRIEF" else "review"
        return f"audience-lab-{kind}-{x['input_id'][:8]}-{stamp}Z.{x['format'].lower()}"
