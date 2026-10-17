"""Deterministic text tools: sentences with code-point offsets, Korean money
amounts, and locating a quoted passage inside a source text."""
from __future__ import annotations

import re

# a quotation closed inside a sentence goes on: "...했다."고 밝혔다
_CONTINUES = ("고 ", "고,", "고.", "라고", "이라고", "며 ", "면서", "는 ", "란 ", "하고")
_SENT_END = re.compile(r"[.!?…。！？](?:[\"'”’」』)\]]*)(?=\s|$)")
_HAS_WORD = re.compile(r"[0-9A-Za-zㄱ-ㆎ가-힣]")


def sentences(body: str) -> list[dict]:
    """Split a draft into sentences. Offsets are code points, end exclusive."""
    out = []
    pos = 0
    for line in body.split("\n"):
        start = pos
        pos += len(line) + 1
        cut = 0
        pieces = []
        for m in _SENT_END.finditer(line):
            after = line[m.end():].lstrip()
            if after.startswith(_CONTINUES):
                continue
            pieces.append((cut, m.end()))
            cut = m.end()
        if cut < len(line):
            pieces.append((cut, len(line)))
        for a, b in pieces:
            seg = line[a:b]
            lead = len(seg) - len(seg.lstrip())
            seg_s = seg.strip()
            if not seg_s or not _HAS_WORD.search(seg_s):
                continue
            s0 = start + a + lead
            out.append({"text": seg_s, "start": s0, "end": s0 + len(seg_s)})
    return out


# ---------------------------------------------------------------- amounts
_UNITS = {"조": 10 ** 12, "억": 10 ** 8, "만": 10 ** 4, "천": 10 ** 3}
_COMPOUND = re.compile(r"((?:\d[\d,]*(?:\.\d+)?\s*(?:조|억|만|천)+\s*)+(?:\d[\d,]*(?![\d.]))?)|(\d[\d,]*(?:\.\d+)?)")
_PAIR = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*((?:조|억|만|천)*)")


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def amounts(text: str) -> set[int]:
    """Every whole-number value written in the text, with Korean units applied.

    '12억 5000만 원' -> 1250000000, '1,200,000,000원' -> 1200000000,
    '2.5억' -> 250000000, '3천만 원' -> 30000000.
    """
    out: set[int] = set()
    for m in _COMPOUND.finditer(text or ""):
        if m.group(1):
            total = 0.0
            for num, units in _PAIR.findall(m.group(1)):
                v = _num(num)
                for u in units:
                    v *= _UNITS[u]
                total += v
            if abs(total - round(total)) < 1e-6:
                out.add(int(round(total)))
        elif m.group(2):
            v = _num(m.group(2))
            if abs(v - round(v)) < 1e-9:
                out.add(int(round(v)))
    return out


def amount_in(text: str, value: int) -> bool:
    return isinstance(value, int) and value in amounts(text)


# ---------------------------------------------------------------- locating quotes
def _norm_map(s: str):
    """Collapse whitespace runs; return normalized text and a map to original indices."""
    chars, idx = [], []
    prev_space = False
    for i, ch in enumerate(s):
        if ch.isspace():
            if prev_space:
                continue
            chars.append(" ")
            idx.append(i)
            prev_space = True
        else:
            chars.append(ch)
            idx.append(i)
            prev_space = False
    return "".join(chars), idx


def locate(body: str, quote: str) -> tuple[int, int] | None:
    """Exact span of `quote` in `body` (code points), tolerant only of whitespace."""
    if not quote or not body:
        return None
    q = quote.strip()
    if len(q) < 4:
        return None
    i = body.find(q)
    if i >= 0:
        return i, i + len(q)
    nb, mb = _norm_map(body)
    nq, _ = _norm_map(q)
    nq = nq.strip()
    j = nb.find(nq)
    if j < 0:
        # typographic quotes and middle dots are often normalised by models
        trans = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "·": "·"})
        j = nb.translate(trans).find(nq.translate(trans))
        if j < 0:
            return None
    start = mb[j]
    end = mb[j + len(nq) - 1] + 1
    return start, end


def clean_text(text: str) -> str:
    """Tidy extracted page text: unify newlines, drop trailing spaces, cap blank lines."""
    t = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ")
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*(?:%|퍼센트|프로)")
