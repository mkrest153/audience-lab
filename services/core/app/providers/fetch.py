"""Fetch a public page from an allowed domain and extract its text.

Only hosts under the open-licence domains are fetched (rights OPEN). Every
hop of a redirect is checked again, private and loopback addresses are
refused, and the size and time of each request are bounded.
"""
from __future__ import annotations

import io
import ipaddress
import os
import logging
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit

import httpx

from .korean import clean_text

log = logging.getLogger("audience_lab.fetch")

UA = "Mozilla/5.0 (compatible; AudienceLabBot/1.0; public-record verification for newsrooms)"
MAX_BYTES = 6_000_000
MAX_TEXT = 200_000
MIN_TEXT = 120
KST = timezone(timedelta(hours=9))


def host_allowed(host: str, domains) -> bool:
    host = (host or "").lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in domains)


def url_allowed(url: str, domains) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and host_allowed(parts.hostname or "", domains)


def _public_ip(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # behind an outbound proxy the proxy resolves names; nothing local is reachable
        return bool(os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy"))
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def _date_iso(value) -> str | None:
    if not value:
        return None
    try:
        d = datetime.strptime(str(value)[:10], "%Y-%m-%d").replace(tzinfo=KST)
    except ValueError:
        return None
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    out = []
    for page in reader.pages[:40]:
        try:
            out.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001
            continue
    return "\n".join(out)


def _html(data: bytes, url: str):
    import trafilatura
    from trafilatura.utils import decode_file
    html = decode_file(data)
    text = trafilatura.extract(html, url=url, include_comments=False, include_tables=True, favor_recall=True,
                               deduplicate=True, output_format="txt") or ""
    meta = trafilatura.extract_metadata(html, default_url=url)
    title = (meta.title if meta and meta.title else "") or ""
    site = (meta.sitename if meta and meta.sitename else "") or ""
    date = meta.date if meta and meta.date else None
    return text, title.strip(), site.strip(), date


def fetch_document(url: str, domains, timeout: float = 15.0) -> dict:
    """{ok, url, final_url, title, site, text, published_at, content_type, error}"""
    out = {"ok": False, "url": url, "final_url": url, "title": "", "site": "", "text": "", "published_at": None,
           "content_type": "", "error": None}
    current = url
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False, headers={"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"}) as client:
            for _ in range(6):
                if not url_allowed(current, domains):
                    out["error"] = "DOMAIN_NOT_ALLOWED"
                    return out
                host = urlsplit(current).hostname or ""
                if not _public_ip(host):
                    out["error"] = "ADDRESS_NOT_PUBLIC"
                    return out
                with client.stream("GET", current) as r:
                    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                        current = urljoin(current, r.headers["location"])
                        continue
                    if r.status_code >= 400:
                        out["error"] = f"HTTP_{r.status_code}"
                        return out
                    ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
                    buf = bytearray()
                    for chunk in r.iter_bytes():
                        buf.extend(chunk)
                        if len(buf) > MAX_BYTES:
                            out["error"] = "TOO_LARGE"
                            return out
                    data = bytes(buf)
                out["final_url"] = current
                out["content_type"] = ctype
                break
            else:
                out["error"] = "TOO_MANY_REDIRECTS"
                return out
    except httpx.HTTPError as e:
        out["error"] = f"FETCH_FAILED: {type(e).__name__}"
        return out
    try:
        if ctype == "application/pdf" or data[:4] == b"%PDF":
            text, title, site, date = _pdf_text(data), "", "", None
        elif ctype.startswith("text/plain"):
            text, title, site, date = data.decode("utf-8", errors="replace"), "", "", None
        else:
            text, title, site, date = _html(data, current)
    except Exception as e:  # noqa: BLE001
        out["error"] = f"EXTRACT_FAILED: {type(e).__name__}"
        return out
    text = clean_text(text)
    if len(text) < MIN_TEXT:
        out["error"] = "NO_TEXT"
        return out
    out.update(ok=True, text=text[:MAX_TEXT], truncated=len(text) > MAX_TEXT, title=title, site=site,
               published_at=_date_iso(date))
    return out


# what a person reads when a page could not be fetched
def fetch_reason(code: str | None, domains) -> str:
    code = code or ""
    if code == "DOMAIN_NOT_ALLOWED":
        return f"정부·지자체 공개 자료 주소({', '.join(domains)})만 가져올 수 있습니다. 다른 사이트로 넘어가는 주소도 받지 않습니다."
    if code == "ADDRESS_NOT_PUBLIC":
        return "공개 인터넷 주소가 아니어서 가져오지 않았습니다."
    if code.startswith("HTTP_"):
        return f"사이트가 HTTP {code[5:]} 오류로 답했습니다. 주소를 확인하거나 원문을 직접 붙여 넣으세요."
    if code == "TOO_LARGE":
        return "파일이 6MB를 넘어 가져오지 않았습니다. 필요한 부분을 직접 붙여 넣으세요."
    if code == "TOO_MANY_REDIRECTS":
        return "주소가 너무 여러 번 다른 곳으로 넘어가 가져오지 않았습니다."
    if code.startswith("FETCH_FAILED"):
        return "사이트에 연결하지 못했습니다. 잠시 뒤 다시 시도하거나 원문을 직접 붙여 넣으세요."
    if code.startswith("EXTRACT_FAILED"):
        return "내려받은 문서에서 본문을 읽어 내지 못했습니다. 원문을 직접 붙여 넣으세요."
    if code == "NO_TEXT":
        return "읽을 수 있는 본문이 거의 없습니다. 스캔한 PDF이거나 화면을 스크립트로 그리는 페이지일 수 있습니다."
    return "주소에서 원문을 가져오지 못했습니다."
