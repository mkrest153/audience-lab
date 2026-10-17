"""A pinned report snapshot -> a format-neutral document model.

The same model feeds the DOCX and PDF renderers, so every format carries the
same statuses, versions, sources, warnings and synthetic labels.
"""
from __future__ import annotations

from . import labels as L


def lab(m, code):
    return f"{m[code]} ({code})" if code in m else code


def status_cell(m, code):
    return [{"text": m[code], "bold": True}, {"text": code, "small": True}] if code in m else [{"text": code, "bold": True}]


def is_demo(s):
    return "FICTIONAL_TEST_DATA" in (s.get("labels") or [])


def pct_phrase(c):
    e, d = c["exact_percent"], c["display_percent"]
    if e.startswith("-"):
        return f"{e[1:]}% 증가 (표시값 {d.lstrip('-')}%)"
    return f"{e}% 감소 (표시값 {d}%)"


def report_model(s: dict, ctx: dict | None = None) -> dict:
    ctx = ctx or {}
    blocks = []
    claim_text, passage_source = {}, {}
    for d in s["source_dependencies"]:
        passage_source[d["passage_id"]] = d
    for sec in s["brief_sections"]:
        for it in sec["items"]:
            if it["kind"] == "REALITY_CLAIM":
                claim_text[it["claim_ids"][0]] = it["text"]
    for sec in s["brief_sections"]:
        for it in sec["items"]:
            for cid in it["claim_ids"]:
                claim_text.setdefault(cid, it["text"] if it["kind"] == "REALITY_CLAIM" else None)
    claim_line = lambda i: claim_text.get(i) or f"Claim {L.short_id(i)}"  # noqa: E731
    q_by_id = {q["id"]: q for q in s["questions"]}
    review = s["input_kind"] == "DRAFT_REVIEW"
    demo = is_demo(s)

    blocks.append({"t": "title", "text": "기획 검토 보고서"})
    blocks.append({"t": "subtitle", "text": s["title"]})
    tags = " · ".join(L.LABEL.get(x, x) for x in s.get("labels") or [])
    if demo:
        note = f"{tags}. 이 보고서의 기관·문서·금액은 고정 인수 시험용으로 만든 가상 자료다."
    else:
        note = (f"{tags}. 기준 시각까지 수집하거나 등록한 공개 자료와 대조해 정리한 검토 기록이다. "
                "판정은 이 자료 범위 안에서만 유효하며, 기사 게재와 편성은 사람이 결정한다.")
    blocks.append({"t": "note", "text": note})
    rows = [["기획 질문", s["question"]], ["기준 시각", f"{L.kst(s['as_of'])} ({s['as_of']})"],
            ["출력 대상", f"{'초안 검토' if review else 'Brief'} {s['input_id']}"],
            ["초안 버전", s["content_version_id"] or "초안 없음 (질문·자료 모드)"], ["질문 상태 버전", s["state_version_id"]],
            ["근거 묶음", s["reality_pack_id"]]]
    if ctx.get("snapshot_sha256"):
        rows.append(["snapshot SHA-256", ctx["snapshot_sha256"]])
    blocks.append({"t": "kv", "rows": rows})

    if s["warnings"]:
        blocks.append({"t": "h", "text": "경고"})
        blocks.append({"t": "list", "items": [f"{w['message']} ({w['code']})" for w in s["warnings"]]})

    if review and s.get("review"):
        blocks.append({"t": "h", "text": "초안 주장 검토"})
        blocks.append({"t": "p", "muted": True, "text": "판정은 이 초안과 이 근거 범위에 대한 것이다. 근거 있음이 게재 승인이나 보편적 사실을 뜻하지는 않는다."})
        trs = []
        for i, it in enumerate(s["review"]["items"]):
            lines = [f"이유: {', '.join(L.REASON.get(c, c) for c in it['reason_codes'])}", f"권고: {it['recommendation']}"]
            if it["supporting_claim_ids"]:
                lines.append(f"뒷받침 근거: {' / '.join(claim_line(x) for x in it['supporting_claim_ids'])}")
            if it["contradicting_claim_ids"]:
                lines.append(f"반박 근거: {' / '.join(claim_line(x) for x in it['contradicting_claim_ids'])}")
            for sc in it["subchecks"]:
                line = f"{L.KIND.get(sc['kind'], sc['kind'])} 판정: {lab(L.REVIEW_STATUS, sc['status'])}"
                c = sc.get("calculation")
                if c:
                    ex = f", 범위가 다른 {L.won(c['excluded_furniture_amount'])} 제외" if c["excluded_furniture_amount"] else ""
                    line += (f" — 초안 {sc['expected_percent']}%, 근거 {sc['observed_percent']}% ({c['previous_period']}년 {L.won(c['previous_amount'])}"
                             f" → {c['current_period']}년 {L.won(c['current_amount'])}{ex}, 표시값 {c['display_percent']}%)")
                elif sc.get("expected_percent"):
                    line += f" — 초안 {sc['expected_percent']}%, 비교할 근거 없음"
                if sc["needed_evidence"]:
                    line += f" — 필요한 근거: {', '.join(sc['needed_evidence'])}"
                lines.append(line)
            if it["needed_evidence"]:
                lines.append(f"필요한 근거: {', '.join(it['needed_evidence'])}")
            trs.append([f"A{i + 1}", it["text"], status_cell(L.REVIEW_STATUS, it["status"]), lines])
        blocks.append({"t": "table", "head": ["번호", "초안 문장", "판정", "판단 이유와 권고"], "widths": [0.06, 0.25, 0.23, 0.46], "rows": trs})

    for sec in s["brief_sections"]:
        blocks.append({"t": "h", "text": f"{L.SECTION.get(sec['section'], sec['section'])} ({sec['section']})"})
        if not sec["items"]:
            blocks.append({"t": "p", "muted": True, "text": "해당 항목 없음"})
            continue
        items = []
        for it in sec["items"]:
            synthetic = "NOT_FACT" in it["labels"]
            tags = " · ".join(L.LABEL.get(x, x) for x in it["labels"]) if synthetic else L.EPISTEMIC.get(it["epistemic_status"], it["epistemic_status"])
            titles = []
            for pid in it["evidence_passage_ids"]:
                d = passage_source.get(pid)
                if d and d["title"] not in titles:
                    titles.append(d["title"])
            src = ", ".join(titles)
            need = f" — 필요한 자료: {', '.join(it['needed_evidence'])}" if it["needed_evidence"] else ""
            items.append(f"{it['text']} [{tags}]{f' — 출처: {src}' if src else ''}{need}")
        blocks.append({"t": "list", "items": items})

    blocks.append({"t": "h", "text": "질문 평가"})
    if not s["question_assessments"]:
        blocks.append({"t": "p", "muted": True, "text": "해당 항목 없음"})
    else:
        blocks.append({"t": "p", "muted": True, "text": "과제 완료, 검색 0건, 합성 답변은 질문 해소의 근거가 아니다."})
        qrows = []
        for a in s["question_assessments"]:
            q = q_by_id.get(a["question_id"], {})
            lines = []
            if a["resolution_claim_ids"]:
                lines.append(f"근거: {' / '.join(claim_line(x) for x in a['resolution_claim_ids'])}")
            if a.get("calculation"):
                lines.append(f"{pct_phrase(a['calculation'])}, 같은 범위")
            if a["needed_evidence"]:
                lines.append(f"남은 자료: {', '.join(a['needed_evidence'])}")
            qrows.append([f"{'└ ' if q.get('parent_id') else ''}{q.get('question_key', '')} {q.get('question', '')}",
                          status_cell(L.QUESTION_STATUS, a["status"]), lines or ["—"]])
        blocks.append({"t": "table", "head": ["질문", "상태", "해소 근거 또는 남은 자료"], "widths": [0.38, 0.22, 0.4], "rows": qrows})

    blocks.append({"t": "h", "text": "취재 행동"})
    actions = [f"{a['action']} — 물을 곳: {a['ask_role'] or '제안 없음'} ({a['provenance']}) [{' · '.join(L.LABEL.get(x, x) for x in a['labels'])}]"
               for a in s["action_overlay"]]
    if actions:
        blocks.append({"t": "list", "items": actions})
    if s["reporting_tasks"]:
        blocks.append({"t": "table", "head": ["취재 과제", "상태", "확인할 질문"], "widths": [0.34, 0.14, 0.52], "rows": [
            [[t["title"], {"text": f"과제 {L.short_id(t['id'])}", "small": True}], status_cell(L.TASK_STATUS, t["status"]),
             [f"{i + 1}. {q}" for i, q in enumerate(t["questions"])]] for t in s["reporting_tasks"]]})
        blocks.append({"t": "p", "muted": True, "text": "과제 완료는 취재 행동의 기록이며 질문 해소와는 별개다."})
    elif not actions:
        blocks.append({"t": "p", "muted": True, "text": "해당 항목 없음"})

    d = s.get("review_delta")
    if d:
        blocks.append({"t": "h", "text": "이전 검토와의 차이"})
        blocks.append({"t": "p", "muted": True, "text": f"이전 검토 {L.short_id(d['before_review_id'])} → 이 검토 {L.short_id(d['after_review_id'])} · {lab(L.COMPARISON, d['comparison_status'])}"})
        text_by_key = {it["assertion_key"]: f"A{i + 1} {it['text']}" for i, it in enumerate((s.get("review") or {}).get("items", []))}
        blocks.append({"t": "table", "head": ["초안 문장", "이전", "이후", "변화"], "widths": [0.4, 0.18, 0.18, 0.24], "rows": [
            [text_by_key.get(it["assertion_key"], L.short_id(it["assertion_key"])),
             L.REVIEW_STATUS.get(it["before_status"], "—") if it["before_status"] else "—",
             L.REVIEW_STATUS.get(it["after_status"], "—") if it["after_status"] else "—",
             f"{', '.join(L.CHANGE.get(c, c) for c in it['change_types'])} — {it['reason']}"] for it in d["items"]]})
        if d["question_changes"]:
            blocks.append({"t": "list", "items": [
                f"{q_by_id.get(q['question_id'], {}).get('question_key', '')} {q_by_id.get(q['question_id'], {}).get('question', '')}: "
                f"{L.QUESTION_STATUS.get(q['before_status'])} → {L.QUESTION_STATUS.get(q['after_status'])}" for q in d["question_changes"]]})

    blocks.append({"t": "h", "text": "근거 목록"})
    if not s["source_dependencies"]:
        blocks.append({"t": "p", "muted": True, "text": "해당 항목 없음"})
    else:
        seen, rows = set(), []
        for dep in s["source_dependencies"]:
            if (dep["source_id"], dep["revision_id"]) in seen:
                continue
            seen.add((dep["source_id"], dep["revision_id"]))
            rows.append([dep["title"], L.kst(dep["published_at"]), L.RIGHTS.get(dep["rights_class"], dep["rights_class"]),
                         [dep["url"], f"Source {L.short_id(dep['source_id'])} · Revision {L.short_id(dep['revision_id'])}"]])
        blocks.append({"t": "table", "head": ["출처", "발행 시각", "권리", "주소와 참조"], "widths": [0.24, 0.2, 0.14, 0.42], "rows": rows})
    blocks.append({"t": "note", "text": "이 보고서는 고정된 검토 버전의 기록이며 이후의 자료 변경을 반영하지 않는다. 기사 게재와 프로그램 편성은 사람이 결정한다. 합성 반론은 사실도 독자 반응 예측도 아니다."})
    return {"title": f"기획 검토 보고서 — {s['title']}", "blocks": blocks, "demo": demo}
