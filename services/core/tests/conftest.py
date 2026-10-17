import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.helpers import PACK  # noqa: E402

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover
    Draft202012Validator = None

_OPENAPI = json.loads((PACK / "core_extension.openapi.json").read_text(encoding="utf-8")) if PACK.exists() else None
_ENVELOPE = {}
if _OPENAPI:
    for path, methods in _OPENAPI["paths"].items():
        for method, op in methods.items():
            ok = next(k for k in op["responses"] if k.startswith("2"))
            content = op["responses"][ok].get("content") or {}
            ref = content.get("application/json", {}).get("schema", {}).get("$ref")
            _ENVELOPE[op["operationId"]] = ref.split("/")[-1] if ref else None
_VALIDATORS = {}


def schema_errors(name, value):
    if not _OPENAPI or Draft202012Validator is None:
        return None
    v = _VALIDATORS.get(name)
    if v is None:
        v = _VALIDATORS[name] = Draft202012Validator({**_OPENAPI, "$ref": f"#/components/schemas/{name}"},
                                                     format_checker=Draft202012Validator.FORMAT_CHECKER)
    errs = sorted(v.iter_errors(value), key=lambda e: list(e.path))
    return None if not errs else "; ".join(f"{list(e.path)}: {e.message[:200]}" for e in errs[:5])


class Checked:
    """Wraps a test client: every response is checked against the pack's closed schemas."""

    def __init__(self, client):
        self.client = client
        self.problems = []

    def __getattr__(self, name):
        return getattr(self.client, name)

    def call(self, op, params=None, body=None, who="a", key=None, if_match=None):
        res = self.client.call(op, params, body, who=who, key=key, if_match=if_match)
        env = _ENVELOPE.get(op)
        if res["ok"] and env:
            e = schema_errors(env, {"data": res["data"]})
            if e:
                self.problems.append(f"{op}: {e}")
        if not res["ok"]:
            e = schema_errors("Error", {"error": res["error"]})
            if e:
                self.problems.append(f"{op} error: {e}")
        return res


@pytest.fixture
def client():
    from tests.helpers import Client
    return Checked(Client())
