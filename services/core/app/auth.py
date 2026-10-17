"""Accounts and sessions.

There is no public sign-up. An administrator creates accounts (a temporary
password is shown once); the demo workspace has public demo accounts that
can only run the fictional demo material. Passwords are PBKDF2-SHA256; the
browser holds a random session token whose hash is stored server-side.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import time
from collections import defaultdict, deque

from .store import Store
from .util import iso, new_uuid, real_now_ms

ROLES = ("VIEWER", "EDITOR", "ADMIN")
SESSION_DAYS = 30
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(pw: str, iterations: int = 210_000) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt.encode(), iterations).hex()
    return f"pbkdf2${iterations}${salt}${h}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, it, salt, h = stored.split("$", 3)
        calc = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt.encode(), int(it)).hex()
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(calc, h)


def temp_password() -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(12))


class Accounts:
    def __init__(self, store: Store):
        self.store = store
        self._attempts: dict[str, deque] = defaultdict(deque)

    # ---------------------------------------------------------------- users
    def _row(self, row):
        if not row:
            return None
        d = json.loads(row[2])
        return {"id": row[0], "email": row[1], **d}

    def get(self, user_id):
        with self.store.lock:
            return self._row(self.store.conn.execute("SELECT id, email, data FROM users WHERE id = ?", (user_id,)).fetchone())

    def by_email(self, email):
        with self.store.lock:
            return self._row(self.store.conn.execute("SELECT id, email, data FROM users WHERE email = ?",
                                                     ((email or "").strip().lower(),)).fetchone())

    def all(self):
        with self.store.lock:
            return [self._row(r) for r in self.store.conn.execute("SELECT id, email, data FROM users ORDER BY rowid").fetchall()]

    def members(self, workspace):
        return [{"actor_id": u["id"], "name": u["name"], "role": u["role"], "active": u["active"]}
                for u in self.all() if u["workspace"] == workspace]

    def _save(self, u):
        data = {k: v for k, v in u.items() if k not in ("id", "email")}
        with self.store.lock:
            self.store.conn.execute(
                "INSERT INTO users (id, email, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, data = excluded.data",
                (u["id"], u["email"], json.dumps(data, ensure_ascii=False)))
        return u

    def create(self, *, email, name, role, password, workspace="main", demo_only=False, must_change=False, user_id=None):
        email = (email or "").strip().lower()
        if not EMAIL_RE.match(email):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        if role not in ROLES:
            raise ValueError("역할은 VIEWER, EDITOR, ADMIN 가운데 하나입니다.")
        if not name or not name.strip():
            raise ValueError("이름이 필요합니다.")
        if len(password) < 8:
            raise ValueError("비밀번호는 8자 이상이어야 합니다.")
        if self.by_email(email):
            raise ValueError("이미 등록된 이메일입니다.")
        u = {"id": user_id or new_uuid(), "email": email, "name": name.strip()[:60], "role": role, "active": True,
             "workspace": workspace, "demo_only": demo_only, "password_hash": hash_password(password),
             "must_change_password": must_change, "created_at": iso(real_now_ms())}
        return self._save(u)

    def update(self, user_id, **changes):
        u = self.get(user_id)
        if not u:
            return None
        if changes.get("role") is not None and changes["role"] not in ROLES:
            raise ValueError("역할은 VIEWER, EDITOR, ADMIN 가운데 하나입니다.")
        for k in ("role", "active", "name"):
            if k in changes and changes[k] is not None:
                u[k] = changes[k].strip()[:60] if k == "name" else changes[k]
        self._save(u)
        if u["active"] is False:
            self.revoke_all(user_id)
        return u

    def set_password(self, user_id, password, must_change=False):
        if len(password) < 8:
            raise ValueError("비밀번호는 8자 이상이어야 합니다.")
        u = self.get(user_id)
        u["password_hash"] = hash_password(password)
        u["must_change_password"] = must_change
        self._save(u)
        return u

    @staticmethod
    def public(u):
        return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"], "active": u["active"],
                "workspace": u["workspace"], "demo_only": u.get("demo_only", False),
                "must_change_password": u.get("must_change_password", False), "created_at": u.get("created_at")}

    # ---------------------------------------------------------------- sessions
    def throttled(self, key: str, limit=8, window=300) -> bool:
        now = time.monotonic()
        q = self._attempts[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return True
        q.append(now)
        return False

    def login(self, email, password):
        u = self.by_email(email)
        if not u or not u["active"] or not verify_password(password or "", u["password_hash"]):
            return None, None
        token = secrets.token_urlsafe(32)
        now = real_now_ms()
        with self.store.lock:
            self.store.conn.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)",
                                    (hashlib.sha256(token.encode()).hexdigest(), u["id"], iso(now),
                                     iso(now + SESSION_DAYS * 86400 * 1000), iso(now)))
        return token, u

    def user_for_token(self, token):
        if not token:
            return None
        th = hashlib.sha256(token.encode()).hexdigest()
        with self.store.lock:
            row = self.store.conn.execute("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", (th,)).fetchone()
        if not row or row[1] < iso(real_now_ms()):
            return None
        u = self.get(row[0])
        return u if u and u["active"] else None

    def logout(self, token):
        th = hashlib.sha256((token or "").encode()).hexdigest()
        with self.store.lock:
            self.store.conn.execute("DELETE FROM sessions WHERE token_hash = ?", (th,))

    def revoke_all(self, user_id):
        with self.store.lock:
            self.store.conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    # ---------------------------------------------------------------- usage meter
    def count_usage(self, kind: str, n: int = 1) -> int:
        day = iso(real_now_ms())[:10]
        with self.store.lock:
            self.store.conn.execute("INSERT INTO usage (day, kind, n) VALUES (?, ?, ?) ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n",
                                    (day, kind, n))
            row = self.store.conn.execute("SELECT n FROM usage WHERE day = ? AND kind = ?", (day, kind)).fetchone()
        return row[0] if row else 0

    def usage_today(self):
        day = iso(real_now_ms())[:10]
        with self.store.lock:
            rows = self.store.conn.execute("SELECT kind, n FROM usage WHERE day = ?", (day,)).fetchall()
        return {"day": day, **{k: n for k, n in rows}}


def actor_of(u) -> dict:
    return {"actor_id": u["id"], "name": u["name"], "role": u["role"], "active": u["active"], "email": u["email"],
            "demo_only": u.get("demo_only", False), "workspace": u["workspace"]}
