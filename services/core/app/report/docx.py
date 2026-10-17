"""Minimal WordprocessingML writer for the report model (stored ZIP, fixed timestamps)."""
from __future__ import annotations

import io
import re
import zipfile

PAGE_W, MARGIN = 11906, 1134
BODY_W = PAGE_W - MARGIN * 2
_CTRL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f]")


def esc(s):
    return _CTRL.sub("", str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def run(text, bold=False, color=None, size=None):
    pr = ""
    if bold or color or size:
        pr = "<w:rPr>" + ("<w:b/><w:bCs/>" if bold else "") + (f'<w:color w:val="{color}"/>' if color else "") + \
             (f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>' if size else "") + "</w:rPr>"
    return f'<w:r>{pr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r>'


def para(text, style=None, indent=False, **o):
    ppr = ""
    if style or indent:
        ppr = "<w:pPr>" + (f'<w:pStyle w:val="{style}"/>' if style else "") + ('<w:ind w:left="284" w:hanging="284"/>' if indent else "") + "</w:pPr>"
    return f"<w:p>{ppr}{run(text, **o)}</w:p>"


def table(block):
    widths = [round(BODY_W * f) for f in block["widths"]]

    def cell(content, w, head):
        lines = content if isinstance(content, list) else [content]
        lines = [{"text": x} if isinstance(x, str) else x for x in lines]
        shd = '<w:shd w:val="clear" w:color="auto" w:fill="E8EDF5"/>' if head else ""
        inner = "".join(para(l["text"], bold=head or l.get("bold", False), size=14 if l.get("small") else 18,
                             color="4B5563" if l.get("small") else None) for l in lines)
        return f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{shd}</w:tcPr>{inner}</w:tc>'

    def row(cells, head):
        hdr = "<w:trPr><w:tblHeader/></w:trPr>" if head else ""
        return f"<w:tr>{hdr}{''.join(cell(c, widths[i], head) for i, c in enumerate(cells))}</w:tr>"

    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    return (f'<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="{BODY_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>'
            f"<w:tblGrid>{grid}</w:tblGrid>{row(block['head'], True)}{''.join(row(r, False) for r in block['rows'])}</w:tbl><w:p/>")


def body(model):
    out = []
    for b in model["blocks"]:
        t = b["t"]
        if t == "title":
            out.append(para(b["text"], style="Title"))
        elif t == "subtitle":
            out.append(para(b["text"], style="Subtitle"))
        elif t == "h":
            out.append(para(b["text"], style="Heading1"))
        elif t == "p":
            out.append(para(b["text"], color="4B5563", size=18) if b.get("muted") else para(b["text"]))
        elif t == "note":
            out.append(para(b["text"], style="Note"))
        elif t == "list":
            out.extend(para(f"• {it}", indent=True) for it in b["items"])
        elif t == "kv":
            out.append(table({"head": ["항목", "내용"], "widths": [0.24, 0.76], "rows": b["rows"]}))
        elif t == "table":
            out.append(table(b))
    return "".join(out)


FONT = '<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/>'
STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>{FONT}<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:color w:val="1D4ED8"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="1D4ED8"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="160"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="B45309"/></w:pBdr></w:pPr><w:rPr><w:color w:val="4B5563"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>"""

CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                 '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                 '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')


def render_docx_model(model) -> bytes:
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                f'{body(model)}<w:sectPr><w:pgSz w:w="{PAGE_W}" w:h="16838"/><w:pgMar w:top="{MARGIN}" w:right="{MARGIN}" w:bottom="{MARGIN}" '
                f'w:left="{MARGIN}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as z:
        for name, data in (("[Content_Types].xml", CONTENT_TYPES), ("_rels/.rels", RELS), ("word/document.xml", document),
                           ("word/styles.xml", STYLES), ("word/_rels/document.xml.rels", DOC_RELS)):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, data.encode("utf-8"))
    return buf.getvalue()
