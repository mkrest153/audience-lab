"""Persistence: every engine object is a JSON document kept in memory and
written through to SQLite at the end of each request or job step.

A request changes objects and marks them dirty; `flush` writes them in one
transaction, `rollback` reloads them so a refused request leaves nothing
behind. One re-entrant lock serialises requests and job commits.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

COLLECTIONS = (
    "cases", "heads", "contents", "states", "submissions", "sources", "revisions", "claims",
    "packs", "executions", "briefs", "reviews", "tasks", "results", "reassessments", "deltas",
    "searches", "notifications", "reads", "exports", "jobs", "commands", "assertion_sets",
)


class Store:
    def __init__(self, path: str | None = None):
        self.lock = threading.RLock()
        self.path = path
        if path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path or ":memory:", check_same_thread=False, isolation_level=None)
        self.conn.execute("PRAGMA foreign_keys=OFF")
        if path:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS docs (
              coll TEXT NOT NULL, id TEXT NOT NULL, case_id TEXT, data TEXT NOT NULL,
              PRIMARY KEY (coll, id));
            CREATE TABLE IF NOT EXISTS events (
              seq INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS events_case ON events(case_id);
            CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, bytes BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL, last_seen TEXT);
            CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL,
              PRIMARY KEY (day, kind));
            CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
            """
        )
        self.mem: dict[str, dict[str, dict]] = {c: {} for c in COLLECTIONS}
        self.dirty: set[tuple[str, str]] = set()
        self.pending_events: list[dict] = []
        for coll, _id, data in self.conn.execute("SELECT coll, id, data FROM docs ORDER BY rowid"):
            if coll in self.mem:
                self.mem[coll][_id] = json.loads(data)

    # ---- documents ----
    def put(self, coll: str, obj: dict) -> dict:
        self.mem[coll][obj["id"]] = obj
        self.dirty.add((coll, obj["id"]))
        return obj

    touch = put

    def get(self, coll: str, _id) -> dict | None:
        if not isinstance(_id, str):
            return None
        return self.mem[coll].get(_id)

    def all(self, coll: str) -> list[dict]:
        return list(self.mem[coll].values())

    def where(self, coll: str, **match) -> list[dict]:
        return [o for o in self.mem[coll].values() if all(o.get(k) == v for k, v in match.items())]

    def delete(self, coll: str, _id: str) -> None:
        self.mem[coll].pop(_id, None)
        self.dirty.add((coll, _id))

    # ---- events ----
    def add_event(self, ev: dict) -> None:
        self.pending_events.append(ev)

    def events_for_case(self, case_id: str) -> list[dict]:
        rows = self.conn.execute("SELECT data FROM events WHERE case_id = ? ORDER BY seq", (case_id,)).fetchall()
        out = [json.loads(r[0]) for r in rows]
        out.extend(e for e in self.pending_events if e.get("case_id") == case_id)
        return out

    # ---- unit of work ----
    def flush(self) -> None:
        if not self.dirty and not self.pending_events:
            return
        cur = self.conn.cursor()
        cur.execute("BEGIN")
        try:
            for coll, _id in self.dirty:
                obj = self.mem[coll].get(_id)
                if obj is None:
                    cur.execute("DELETE FROM docs WHERE coll = ? AND id = ?", (coll, _id))
                else:
                    cur.execute(
                        "INSERT INTO docs (coll, id, case_id, data) VALUES (?, ?, ?, ?) "
                        "ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, case_id = excluded.case_id",
                        (coll, _id, obj.get("case_id"), json.dumps(obj, ensure_ascii=False)),
                    )
            for ev in self.pending_events:
                cur.execute("INSERT INTO events (case_id, data) VALUES (?, ?)",
                            (ev.get("case_id"), json.dumps(ev, ensure_ascii=False)))
            cur.execute("COMMIT")
        except Exception:
            cur.execute("ROLLBACK")
            raise
        self.dirty.clear()
        self.pending_events.clear()

    def rollback(self) -> None:
        for coll, _id in self.dirty:
            row = self.conn.execute("SELECT data FROM docs WHERE coll = ? AND id = ?", (coll, _id)).fetchone()
            if row:
                self.mem[coll][_id] = json.loads(row[0])
            else:
                self.mem[coll].pop(_id, None)
        self.dirty.clear()
        self.pending_events.clear()

    # ---- binary artifacts ----
    def put_artifact(self, _id: str, data: bytes) -> None:
        self.conn.execute("INSERT OR REPLACE INTO artifacts (id, bytes) VALUES (?, ?)", (_id, sqlite3.Binary(data)))

    def get_artifact(self, _id: str) -> bytes | None:
        row = self.conn.execute("SELECT bytes FROM artifacts WHERE id = ?", (_id,)).fetchone()
        return bytes(row[0]) if row else None

    # ---- small key/value ----
    def meta_get(self, k: str) -> str | None:
        row = self.conn.execute("SELECT v FROM meta WHERE k = ?", (k,)).fetchone()
        return row[0] if row else None

    def meta_set(self, k: str, v: str) -> None:
        self.conn.execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", (k, v))
