"""PDF renderer for the report model: an embedded Korean TrueType font, so the
file is a real PDF whose text can be selected and searched."""
from __future__ import annotations

import io
from pathlib import Path

from reportlab.lib.colors import Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdfcanvas

FONT_PATH = Path(__file__).resolve().parent / "fonts" / "report-font.ttf"
FONT = "ALReportGothic"
A4 = (595.28, 841.89)
M = 46
INK, MUTED, RULE, GRID, WARN, HEAD = (0.07, 0.09, 0.15), (0.29, 0.33, 0.39), (0.11, 0.31, 0.85), (0.72, 0.75, 0.8), (0.71, 0.33, 0.04), (0.91, 0.93, 0.96)
MISSING = "□"
OPENERS = "([{‘“〈《「『【〔"
CLOSERS = ")]}’”〉》」』】〕.,:;!?%…·、。"
SOFT = set("_-/.,:=&?")

_font = None


def _load_font():
    global _font
    if _font is None:
        f = TTFont(FONT, str(FONT_PATH))
        pdfmetrics.registerFont(f)
        _font = f
    return _font


def _col(c):
    return Color(c[0], c[1], c[2])


class _Doc:
    def __init__(self, title, footer, total=None):
        self.total = total
        self.font = _load_font()
        self.cmap = set(self.font.face.charToGlyph.keys())
        self.buf = io.BytesIO()
        self.c = pdfcanvas.Canvas(self.buf, pagesize=A4, invariant=1, pageCompression=1)
        self.c.setTitle(title)
        self.c.setAuthor("Audience Lab")
        self.c.setCreator("Audience Lab")
        self.c.setProducer("Audience Lab")
        self.footer = footer
        self.width = A4[0] - M * 2
        self.y = A4[1] - M
        self.pages = 1
        self.wcache = {}

    # ---- text metrics ----
    def clean(self, s):
        return "".join(ch if ch == "\n" or ord(ch) in self.cmap else MISSING for ch in str(s))

    def cw(self, ch, size):
        w = self.wcache.get(ch)
        if w is None:
            w = pdfmetrics.stringWidth(ch, FONT, 1000)
            self.wcache[ch] = w
        return w * size / 1000

    def tw(self, s, size):
        return sum(self.cw(ch, size) for ch in s)

    def wrap(self, text, size, width):
        out = []
        space = self.cw(" ", size)
        for raw in self.clean(text).split("\n"):
            line, line_w = "", 0.0
            for word in raw.split(" "):
                if not word:
                    continue
                w = self.tw(word, size)
                if line and line_w + space + w <= width:
                    line += " " + word
                    line_w += space + w
                    continue
                if line:
                    out.append(line)
                    line, line_w = "", 0.0
                if w <= width:
                    line, line_w = word, w
                    continue
                rest = list(word)
                while rest:
                    acc, n = 0.0, 0
                    while n < len(rest) and acc + self.cw(rest[n], size) <= width:
                        acc += self.cw(rest[n], size)
                        n += 1
                    if n >= len(rest):
                        break
                    n = max(1, n)
                    cut = n
                    k = n
                    while k > int(n * 0.4) and k > 1:
                        if rest[k - 1] in SOFT:
                            cut = k
                            break
                        k -= 1
                    while cut > 1 and (rest[cut] in CLOSERS or rest[cut - 1] in OPENERS):
                        cut -= 1
                    out.append("".join(rest[:cut]))
                    rest = rest[cut:]
                line = "".join(rest)
                line_w = self.tw(line, size)
            out.append(line)
        return out

    # ---- drawing ----
    def new_page(self):
        self._footer()
        self.c.showPage()
        self.pages += 1
        self.y = A4[1] - M

    def need(self, h):
        if self.y - h < M + 14:
            self.new_page()

    def text(self, s, x, y, size, color=INK, bold=False):
        self.c.saveState()
        self.c.setFillColor(_col(color))
        self.c.setStrokeColor(_col(color))
        self.c.setLineWidth(size * 0.032)
        t = self.c.beginText(x, y)
        t.setFont(FONT, size)
        t.setFillColor(_col(color))
        t.setStrokeColor(_col(color))
        t.setTextRenderMode(2 if bold else 0)
        t.textOut(s)
        self.c.drawText(t)
        self.c.restoreState()

    def paragraph(self, s, size=9.5, color=INK, indent=0, bullet=False, after=3, bold=False):
        lh = size * 1.5
        for i, ln in enumerate(self.wrap(s, size, self.width - indent)):
            self.need(lh)
            if bullet and i == 0:
                self.text("•", M + 2, self.y - size, size, color)
            self.text(ln, M + indent, self.y - size, size, color, bold)
            self.y -= lh
        self.y -= after

    def table(self, head, widths_f, rows):
        size, pad_x, pad_y = 8.4, 5, 4
        lh = size * 1.45
        widths = [f * self.width for f in widths_f]

        def cells_of(cells):
            out = []
            for i, cell in enumerate(cells):
                lines = cell if isinstance(cell, list) else [cell]
                acc = []
                for l in lines:
                    o = {"text": l} if isinstance(l, str) else l
                    fs = 7 if o.get("small") else size
                    for t in self.wrap(o["text"], fs, widths[i] - pad_x * 2):
                        acc.append((t, fs, bool(o.get("bold")), MUTED if o.get("small") else INK))
                out.append(acc)
            return out

        def draw_row(cells, is_head):
            wrapped = cells_of(cells)
            start = 0
            max_lines = max((len(x) for x in wrapped), default=1) or 1
            while start < max_lines:
                room = int((self.y - (M + 14) - pad_y * 2) // lh)
                if room < 2:
                    self.new_page()
                    continue
                take = min(room, max_lines - start)
                h = take * lh + pad_y * 2
                x = M
                for i, lines in enumerate(wrapped):
                    if is_head:
                        self.c.setFillColor(_col(HEAD))
                        self.c.rect(x, self.y - h, widths[i], h, stroke=0, fill=1)
                    self.c.setStrokeColor(_col(GRID))
                    self.c.setLineWidth(0.5)
                    self.c.rect(x, self.y - h, widths[i], h, stroke=1, fill=0)
                    for k, (t, fs, b, color) in enumerate(lines[start:start + take]):
                        self.text(t, x + pad_x, self.y - pad_y - size - k * lh, fs, color, is_head or b)
                    x += widths[i]
                self.y -= h
                start += take

        self.need(60)
        draw_row(head, True)
        for r in rows:
            draw_row(r, False)
        self.y -= 8

    def _footer(self):
        self.c.setFont(FONT, 8)
        self.c.setFillColor(_col(MUTED))
        self.c.drawString(M, 24, self.clean(self.footer))
        self.c.drawRightString(A4[0] - M, 24, f"{self.pages} / {self.total}" if self.total else f"{self.pages}")

    def finish(self):
        self._footer()
        self.c.showPage()
        self.c.save()
        return self.buf.getvalue()


def render_pdf_model(model) -> bytes:
    first = _render(model, None)
    return _render(model, first[1])[0]


def _render(model, total):
    footer = "Audience Lab 기획 검토 보고서 · " + ("가상 테스트 자료" if model.get("demo") else "AI 보조 검토 기록 · 게재 판단은 사람이 합니다")
    d = _Doc(model["title"], footer, total)
    for b in model["blocks"]:
        t = b["t"]
        if t == "title":
            d.need(30)
            d.text(d.clean(b["text"]), M, d.y - 20, 20, INK, True)
            d.y -= 30
        elif t == "subtitle":
            d.paragraph(b["text"], size=12.5, color=RULE, after=8)
        elif t == "h":
            d.need(46)
            d.y -= 8
            d.text(d.clean(b["text"]), M, d.y - 12, 12, INK, True)
            d.y -= 17
            d.c.setStrokeColor(_col(RULE))
            d.c.setLineWidth(0.9)
            d.c.line(M, d.y, M + d.width, d.y)
            d.y -= 8
        elif t == "p":
            if b.get("muted"):
                d.paragraph(b["text"], size=8.6, color=MUTED)
            else:
                d.paragraph(b["text"])
        elif t == "note":
            size = 8.6
            lh = size * 1.5
            lines = d.wrap(b["text"], size, d.width - 12)
            d.need(len(lines) * lh + 8)
            d.c.setFillColor(_col(WARN))
            d.c.rect(M, d.y - len(lines) * lh - 2, 2.5, len(lines) * lh + 2, stroke=0, fill=1)
            for ln in lines:
                d.text(ln, M + 10, d.y - size, size, MUTED)
                d.y -= lh
            d.y -= 8
        elif t == "list":
            for it in b["items"]:
                d.paragraph(it, indent=12, bullet=True, after=2)
            d.y -= 4
        elif t == "kv":
            d.table(["항목", "내용"], [0.24, 0.76], b["rows"])
        elif t == "table":
            d.table(b["head"], b["widths"], b["rows"])
    return d.finish(), d.pages
