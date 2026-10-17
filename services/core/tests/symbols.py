"""Compare server output with the pack's examples modulo identifiers.

The pack's examples use fixed fixture UUIDs; the server makes fresh ones and
namespaces fixture objects per case. Both sides are rewritten into the same
symbols (C1, S2, review01, qa:review01:U1a, ...) and timestamps are masked,
so the comparison checks every value that matters and nothing accidental.
"""
from __future__ import annotations

import json
import re

from app.engine import FX
from app.util import uuid_from

TIME_KEYS = re.compile(r"(_at|^clock)$")


class Symbols:
    def __init__(self):
        self.map: dict[str, str] = {}

    def add(self, ident, sym):
        if ident:
            self.map[ident] = sym
        return ident

    def apply(self, obj, times=False):
        if isinstance(obj, str):
            return self.map.get(obj, obj)
        if isinstance(obj, list):
            return [self.apply(x, times) for x in obj]
        if isinstance(obj, dict):
            out = {}
            for k, v in obj.items():
                if not times and TIME_KEYS.search(k) and k != "as_of":
                    out[k] = "<t>" if v is not None else None
                else:
                    out[k] = self.apply(v, times)
            return out
        return obj


def fixture_symbols(cf=None):
    """Symbols for the pack's fixed identifiers."""
    s = Symbols()
    s.add(FX["workspace_id"], "ws")
    for src in FX["sources"]:
        k = src["key"]
        s.add(src["source_id"], f"src:{k}")
        s.add(src["revision_id"], f"rev:{k}")
        s.add(src["passage_id"], f"pas:{k}")
        s.add(src.get("submission_id"), f"sub:{k}")
    for k, v in FX["draftless_submissions"].items():
        s.add(v["submission_id"], f"sub:{k}")
        s.add(v["content_version_id"], f"content:{k}")
    for c in FX["claims"]:
        s.add(c["claim_id"], c["key"])
    s.add(FX["conflict"]["conflict_id"], "X1")
    for q in FX["questions"]:
        s.add(q["id"], q["question_key"])
    for a in FX["assertions"]:
        s.add(a["assertion_id"], a["key"])
        s.add(a["assertion_key"], f"akey:{a['key']}")
    for name, ident in FX["ids"].items():
        if ident not in s.map:
            s.add(ident, name)
    s.add(FX["ids"]["s6-content"], "content:S6")
    names = {FX["ids"]["review01"]: "review01", FX["ids"]["review02"]: "review02", FX["ids"]["review03"]: "review03",
             FX["ids"]["brief"]: "brief"}
    for view, by_q in FX["assessment_ids"].items():
        for qid, aid in by_q.items():
            s.add(aid, f"qa:{names.get(view, view)}:{s.map.get(qid, qid)}")
    for view, secs in FX["brief_item_ids"].items():
        for sec, ids in secs.items():
            for i, ident in enumerate(ids):
                s.add(ident, f"bi:{names.get(view, view)}:{sec}:{i + 1}")
    return s


def server_symbols(case_id, fixture_provider):
    """Symbols for the namespaced fixture objects of one server case."""
    fx = fixture_symbols()
    s = Symbols()
    for ident, sym in fx.map.items():
        s.add(fixture_provider.fid({"id": case_id}, ident), sym)
    return s


def name_view(sym: Symbols, view_name: str, view: dict):
    """Name a review/brief and everything derived from its id."""
    sym.add(view["id"], view_name)
    for a in view.get("question_assessments") or []:
        sym.add(a["id"], f"qa:{view_name}:{sym.map.get(a['question_id'], a['question_id'])}")
    for i, it in enumerate(view.get("items") or []):
        sym.add(it["assertion_id"], f"A{i + 1}")
        sym.add(it["assertion_key"], f"akey:A{i + 1}")
    for sec in view.get("sections") or []:
        for i, it in enumerate(sec["items"]):
            sym.add(it["id"], f"bi:{view_name}:{sec['section']}:{i + 1}")


def dump(x):
    return json.dumps(x, ensure_ascii=False, indent=1, sort_keys=True)


def diff_paths(g, w, path="$", out=None):
    out = [] if out is None else out
    if type(g) is not type(w):
        out.append(f"{path}: got {json.dumps(g, ensure_ascii=False)[:300]} want {json.dumps(w, ensure_ascii=False)[:300]}")
    elif isinstance(g, dict):
        for k in sorted(set(g) | set(w)):
            if k not in g:
                out.append(f"{path}.{k}: missing (want {json.dumps(w[k], ensure_ascii=False)[:200]})")
            elif k not in w:
                out.append(f"{path}.{k}: extra (got {json.dumps(g[k], ensure_ascii=False)[:200]})")
            else:
                diff_paths(g[k], w[k], f"{path}.{k}", out)
    elif isinstance(g, list):
        if len(g) != len(w):
            out.append(f"{path}: len {len(g)} != {len(w)}: got {json.dumps(g, ensure_ascii=False)[:400]} want {json.dumps(w, ensure_ascii=False)[:400]}")
        else:
            for i, (a, b) in enumerate(zip(g, w)):
                diff_paths(a, b, f"{path}[{i}]", out)
    elif g != w:
        out.append(f"{path}: got {json.dumps(g, ensure_ascii=False)[:300]} want {json.dumps(w, ensure_ascii=False)[:300]}")
    return out


def assert_same(got, want, sym_got: Symbols, sym_want: Symbols, *, times=False):
    g, w = sym_got.apply(got, times), sym_want.apply(want, times)
    if g != w:
        raise AssertionError("mismatch:\n" + "\n".join(diff_paths(g, w)[:40]))


def derived_brief_ids(brief_id, sections):
    return {it["id"]: (sec["section"], i) for sec in sections for i, it in enumerate(sec["items"])}


__all__ = ["Symbols", "fixture_symbols", "server_symbols", "name_view", "assert_same", "uuid_from"]
