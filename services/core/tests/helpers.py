"""Test helpers: an engine over an in-memory store with the demo provider."""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.engine import FX, Engine
from app.providers.fixture import FixtureProvider
from app.store import Store
from app.util import parse_time, uuid_from

# the specification pack the tests check against (closed schemas, fixtures, examples)
PACK = Path(os.environ.get("AL_SPEC_PACK") or Path(__file__).resolve().parent / "contract")
WS = uuid_from("test-workspace")
ACTORS = {
    "a": {"actor_id": uuid_from("actor-a"), "name": "기자 A", "role": "EDITOR", "active": True},
    "b": {"actor_id": uuid_from("actor-b"), "name": "에디터 B", "role": "EDITOR", "active": True},
    "c": {"actor_id": uuid_from("actor-c"), "name": "열람자 C", "role": "VIEWER", "active": True},
}


def load(name):
    return json.loads((PACK / name).read_text(encoding="utf-8"))


def fake_renderers():
    return {
        "JSON": lambda snap, ctx: json.dumps(snap, ensure_ascii=False, indent=2).encode(),
        "DOCX": lambda snap, ctx: bytes([0x50, 0x4B, 3, 4, 1, 2, 3]),
        "PDF": lambda snap, ctx: b"%PDF-1.7 stub",
    }


class Client:
    def __init__(self, renderers=None, providers=None):
        self.store = Store(None)
        self.fx = FixtureProvider(stage_delay=0)
        self.eng = Engine(self.store, workspace_id=WS, providers=providers or {"fixture": self.fx})
        self.eng.renderers = renderers if renderers is not None else fake_renderers()
        self.eng.member_source = lambda: list(ACTORS.values())
        self.n = 0

    def clock(self, value):
        self.eng.clock_ms = parse_time(value)

    def call(self, op, params=None, body=None, who="a", key=None, if_match=None):
        meta = self.eng.ALL_OPS[op] if hasattr(self.eng, "ALL_OPS") else None
        from app.engine import ALL_OPS
        meta = ALL_OPS[op]
        if key is None and meta["method"] == "POST":
            self.n += 1
            key = f"k-{self.n}"
        return self.eng.call(op, actor=ACTORS[who], params={"workspace_id": WS, **(params or {})}, body=body, key=key, if_match=if_match)

    def drain(self):
        self.eng.drain()


SRC = {s["key"]: s for s in FX["sources"]}


def sub_body(key, **extra):
    s = SRC[key]
    b = {"title": s["title"], "source_url": s["url"], "transcript_locator": None, "recorded_at": s["published_at"],
         "sensitivity": "PUBLIC", "rights_class": "OPEN", "body": s["body"]}
    b.update(extra)
    return b
