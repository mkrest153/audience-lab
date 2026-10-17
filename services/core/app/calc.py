"""Deterministic rules the server applies itself: arithmetic and roll-ups."""
from __future__ import annotations

from math import gcd

from .errors import ApiError


def percent_change(previous: int, current: int, scale: int = 2) -> dict:
    """(previous - current) / previous * 100 with exact integer arithmetic.

    A decrease is positive, an increase negative. exact_percent is an exact
    decimal when one exists, otherwise a reduced fraction; display_percent is
    ROUND_HALF_UP on the magnitude at `scale` places.
    """
    if (not isinstance(previous, int) or isinstance(previous, bool) or not isinstance(current, int)
            or isinstance(current, bool) or previous <= 0):
        raise ApiError(422, "CALCULATION_INVALID", "같은 범위의 0보다 큰 이전 금액이 있어야 계산할 수 있다.",
                       [{"field": "calculation", "reason": "이전 금액이 0이거나 비교 범위가 다르다."}])
    num = (previous - current) * 100
    den = previous
    neg = num < 0
    if neg:
        num = -num
    g = gcd(num, den) or 1
    num //= g
    den //= g
    d, twos, fives = den, 0, 0
    while d % 2 == 0:
        d //= 2
        twos += 1
    while d % 5 == 0:
        d //= 5
        fives += 1
    if d == 1:
        m = max(twos, fives)
        scaled = (num * 10 ** m) // den
        s = str(scaled).rjust(m + 1, "0")
        if m > 0:
            s = (s[: len(s) - m] + "." + s[len(s) - m:]).rstrip("0").rstrip(".")
        exact = s
    else:
        exact = f"{num}/{den}"
    p = 10 ** scale
    rounded = (num * p * 2 + den) // (den * 2)
    ds = str(rounded).rjust(scale + 1, "0")
    if scale > 0:
        ds = ds[: len(ds) - scale] + "." + ds[len(ds) - scale:]
    sign = "-" if neg and rounded != 0 else ""
    return {"exact_percent": ("-" if neg and num != 0 else "") + exact, "display_percent": sign + ds}


def rollup_status(statuses: list[str]) -> str:
    """Aggregate of required subchecks: CONFLICT > CONTRADICTED > INSUFFICIENT > SUPPORTED."""
    if not statuses:
        return "INSUFFICIENT_EVIDENCE"
    if all(s == "NON_FACTUAL" for s in statuses):
        return "NON_FACTUAL"
    for s in ("CONFLICT", "CONTRADICTED", "INSUFFICIENT_EVIDENCE"):
        if s in statuses:
            return s
    return "SUPPORTED"


def rollup_question(child_statuses: list[str]) -> str:
    """Parent question status from its required children."""
    if "CONFLICTED" in child_statuses:
        return "CONFLICTED"
    if child_statuses and all(s == "RESOLVED" for s in child_statuses):
        return "RESOLVED"
    if any(s in ("RESOLVED", "PARTIALLY_RESOLVED") for s in child_statuses):
        return "PARTIALLY_RESOLVED"
    return "OPEN"


def percent_value(text) -> float | None:
    """'20', '-4', '4.00', '1/3' -> float; None when not a number."""
    if text is None:
        return None
    s = str(text).strip().rstrip("%").strip()
    try:
        if "/" in s:
            a, b = s.split("/", 1)
            return float(a) / float(b)
        return float(s)
    except (ValueError, ZeroDivisionError):
        return None
