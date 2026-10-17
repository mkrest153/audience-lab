"""Small shared helpers: time, code points, canonical JSON, derived IDs."""
from __future__ import annotations

import hashlib
import json
import re
import time
import unicodedata
import uuid
from datetime import datetime, timezone

RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def real_now_ms() -> int:
    return int(time.time() * 1000)


def iso(ms: int) -> str:
    """Milliseconds since the epoch -> 2026-09-30T09:00:00Z (seconds precision)."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value) -> int | None:
    """RFC 3339 with an explicit zone -> ms, or None."""
    if not isinstance(value, str) or not RFC3339.match(value):
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def ms_of(value: str | None) -> int | None:
    return parse_time(value) if value else None


# ---- code points (Python str indexes are already code points) ----
def cp_len(s: str) -> int:
    return len(s)


def cp_slice(s: str, a: int, b: int) -> str:
    return s[a:b]


def blank(s) -> bool:
    return not isinstance(s, str) or s.strip() == ""


# ---- hashing ----
def sha256hex(data) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def canon(v) -> str:
    """Canonical JSON: sorted keys, compact, UTF-8 (same rule as the prototype)."""
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def uuid_from(seed: str) -> str:
    """A stable UUID derived from a seed (version 5 layout over SHA-256)."""
    h = sha256hex(seed)
    variant = format((int(h[16], 16) & 0x3) | 0x8, "x")
    return f"{h[0:8]}-{h[8:12]}-5{h[13:16]}-{variant}{h[17:20]}-{h[20:32]}"


def new_uuid() -> str:
    return str(uuid.uuid4())


def clone(o):
    return None if o is None else json.loads(json.dumps(o))


def uniq(items):
    seen = set()
    out = []
    for x in items:
        key = json.dumps(x, sort_keys=True) if isinstance(x, (dict, list)) else x
        if key in seen:
            continue
        seen.add(key)
        out.append(x)
    return out


def title_key(t: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", t).strip())


def host_of(url: str | None) -> str:
    if not url:
        return ""
    m = re.match(r"^https?://([^/:?#]+)", url.strip(), re.I)
    return m.group(1).lower() if m else ""
