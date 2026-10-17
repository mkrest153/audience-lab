"""Report files rendered on the server from a pinned snapshot."""
import json

from .docx import render_docx_model
from .model import report_model
from .pdf import render_pdf_model


def render_json(snapshot, ctx=None) -> bytes:
    return json.dumps(snapshot, ensure_ascii=False, indent=2).encode("utf-8")


def render_pdf(snapshot, ctx=None) -> bytes:
    return render_pdf_model(report_model(snapshot, ctx))


def render_docx(snapshot, ctx=None) -> bytes:
    return render_docx_model(report_model(snapshot, ctx))


__all__ = ["render_json", "render_pdf", "render_docx", "report_model"]
