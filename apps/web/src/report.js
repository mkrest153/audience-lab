// Turns a pinned report snapshot into a format-neutral document model.
// Mirrors the server's report/model.py, which feeds the PDF and DOCX files, so
// the preview on screen carries the same statuses, versions, sources, warnings
// and synthetic labels as the file.
import * as L from './labels.js';

const lab = (map, code) => (map[code] ? `${map[code]} (${code})` : code);
// status cell: the Korean label, then the contract code in small type
const statusCell = (map, code) => (map[code] ? [{ text: map[code], bold: true }, { text: code, small: true }] : [{ text: code, bold: true }]);

export const isDemoSnapshot = (s) => (s.labels || []).includes('FICTIONAL_TEST_DATA');

// "-12.50" means the current amount grew; the contract keeps the sign of a decrease
export function pctPhrase(c) {
  const e = c.exact_percent;
  const d = c.display_percent;
  if (e.startsWith('-')) return `${e.slice(1)}% 증가 (표시값 ${d.replace(/^-/, '')}%)`;
  return `${e}% 감소 (표시값 ${d}%)`;
}

export function calcLine(c) {
  const ex = c.excluded_furniture_amount ? `, 범위가 다른 ${L.won(c.excluded_furniture_amount)} 제외` : '';
  return `${c.previous_period}년 ${L.won(c.previous_amount)} → ${c.current_period}년 ${L.won(c.current_amount)}${ex}`;
}

export function reportModel(snapshot, ctx = {}) {
  const s = snapshot;
  const blocks = [];
  const claimText = {};
  const passageSource = {};
  for (const d of s.source_dependencies) passageSource[d.passage_id] = d;
  for (const sec of s.brief_sections) {
    for (const it of sec.items) if (it.kind === 'REALITY_CLAIM') claimText[it.claim_ids[0]] = it.text;
  }
  const claimLine = (id) => claimText[id] || `Claim ${L.shortId(id)}`;
  const qById = Object.fromEntries(s.questions.map((q) => [q.id, q]));
  const isReview = s.input_kind === 'DRAFT_REVIEW';
  const demo = isDemoSnapshot(s);

  blocks.push({ t: 'title', text: '기획 검토 보고서' });
  blocks.push({ t: 'subtitle', text: s.title });
  const tags = (s.labels || []).map((x) => L.LABEL[x] || x).join(' · ');
  blocks.push({ t: 'note', text: demo
    ? `${tags}. 이 보고서의 기관·문서·금액은 고정 인수 시험용으로 만든 가상 자료다.`
    : `${tags}. 기준 시각까지 수집하거나 등록한 공개 자료와 대조해 정리한 검토 기록이다. 판정은 이 자료 범위 안에서만 유효하며, 기사 게재와 편성은 사람이 결정한다.` });
  blocks.push({ t: 'kv', rows: [
    ['기획 질문', s.question],
    ['기준 시각', `${L.kst(s.as_of)} (${s.as_of})`],
    ['출력 대상', `${isReview ? '초안 검토' : 'Brief'} ${s.input_id}`],
    ['초안 버전', s.content_version_id || '초안 없음 (질문·자료 모드)'],
    ['질문 상태 버전', s.state_version_id],
    ['근거 묶음', s.reality_pack_id],
    ...(ctx.snapshot_sha256 ? [['snapshot SHA-256', ctx.snapshot_sha256]] : []),
  ] });

  if (s.warnings.length) {
    blocks.push({ t: 'h', text: '경고' });
    blocks.push({ t: 'list', items: s.warnings.map((w) => `${w.message} (${w.code})`) });
  }

  if (isReview && s.review) {
    blocks.push({ t: 'h', text: '초안 주장 검토' });
    blocks.push({ t: 'p', text: '판정은 이 초안과 이 근거 범위에 대한 것이다. 근거 있음이 게재 승인이나 보편적 사실을 뜻하지는 않는다.', muted: true });
    const rows = s.review.items.map((it, i) => {
      const lines = [`이유: ${it.reason_codes.map((c) => L.REASON[c] || c).join(', ')}`, `권고: ${it.recommendation}`];
      if (it.supporting_claim_ids.length) lines.push(`뒷받침 근거: ${it.supporting_claim_ids.map(claimLine).join(' / ')}`);
      if (it.contradicting_claim_ids.length) lines.push(`반박 근거: ${it.contradicting_claim_ids.map(claimLine).join(' / ')}`);
      for (const sc of it.subchecks) {
        let line = `${L.KIND[sc.kind] || sc.kind} 판정: ${lab(L.REVIEW_STATUS, sc.status)}`;
        if (sc.calculation) {
          const c = sc.calculation;
          line += ` — 초안 ${sc.expected_percent}%, 근거 ${sc.observed_percent}% (${calcLine(c)}, 표시값 ${c.display_percent}%)`;
        } else if (sc.expected_percent) line += ` — 초안 ${sc.expected_percent}%, 비교할 근거 없음`;
        if (sc.needed_evidence.length) line += ` — 필요한 근거: ${sc.needed_evidence.join(', ')}`;
        lines.push(line);
      }
      if (it.needed_evidence.length) lines.push(`필요한 근거: ${it.needed_evidence.join(', ')}`);
      return [`A${i + 1}`, it.text, statusCell(L.REVIEW_STATUS, it.status), lines];
    });
    blocks.push({ t: 'table', head: ['번호', '초안 문장', '판정', '판단 이유와 권고'], widths: [0.06, 0.25, 0.23, 0.46], rows });
  }

  for (const sec of s.brief_sections) {
    blocks.push({ t: 'h', text: `${L.SECTION[sec.section] || sec.section} (${sec.section})` });
    if (!sec.items.length) { blocks.push({ t: 'p', text: '해당 항목 없음', muted: true }); continue; }
    blocks.push({ t: 'list', items: sec.items.map((it) => {
      const synthetic = it.labels.includes('NOT_FACT');
      const tg = synthetic ? it.labels.map((x) => L.LABEL[x] || x).join(' · ') : (L.EPISTEMIC[it.epistemic_status] || it.epistemic_status);
      const src = uniqueTitles(it.evidence_passage_ids.map((id) => passageSource[id]).filter(Boolean));
      return `${it.text} [${tg}]${src ? ` — 출처: ${src}` : ''}${it.needed_evidence.length ? ` — 필요한 자료: ${it.needed_evidence.join(', ')}` : ''}`;
    }) });
  }

  blocks.push({ t: 'h', text: '질문 평가' });
  if (!s.question_assessments.length) blocks.push({ t: 'p', text: '해당 항목 없음', muted: true });
  else {
    blocks.push({ t: 'p', text: '과제 완료, 검색 0건, 합성 답변은 질문 해소의 근거가 아니다.', muted: true });
    blocks.push({ t: 'table', head: ['질문', '상태', '해소 근거 또는 남은 자료'], widths: [0.38, 0.22, 0.4], rows: s.question_assessments.map((a) => {
      const q = qById[a.question_id] || {};
      const lines = [];
      if (a.resolution_claim_ids.length) lines.push(`근거: ${a.resolution_claim_ids.map(claimLine).join(' / ')}`);
      if (a.calculation) lines.push(`${pctPhrase(a.calculation)}, 같은 범위`);
      if (a.needed_evidence.length) lines.push(`남은 자료: ${a.needed_evidence.join(', ')}`);
      return [`${q.parent_id ? '└ ' : ''}${q.question_key || ''} ${q.question || ''}`, statusCell(L.QUESTION_STATUS, a.status), lines.length ? lines : ['—']];
    }) });
  }

  blocks.push({ t: 'h', text: '취재 행동' });
  const actions = s.action_overlay.map((a) => `${a.action} — 물을 곳: ${a.ask_role || '제안 없음'} (${a.provenance}) [${a.labels.map((x) => L.LABEL[x] || x).join(' · ')}]`);
  if (actions.length) blocks.push({ t: 'list', items: actions });
  if (s.reporting_tasks.length) {
    blocks.push({ t: 'table', head: ['취재 과제', '상태', '확인할 질문'], widths: [0.34, 0.14, 0.52], rows: s.reporting_tasks.map((t) => [
      [t.title, { text: `과제 ${L.shortId(t.id)}`, small: true }], statusCell(L.TASK_STATUS, t.status), t.questions.map((q, i) => `${i + 1}. ${q}`),
    ]) });
    blocks.push({ t: 'p', text: '과제 완료는 취재 행동의 기록이며 질문 해소와는 별개다.', muted: true });
  } else if (!actions.length) blocks.push({ t: 'p', text: '해당 항목 없음', muted: true });

  if (s.review_delta) {
    const d = s.review_delta;
    blocks.push({ t: 'h', text: '이전 검토와의 차이' });
    blocks.push({ t: 'p', text: `이전 검토 ${L.shortId(d.before_review_id)} → 이 검토 ${L.shortId(d.after_review_id)} · ${lab(L.COMPARISON, d.comparison_status)}`, muted: true });
    const textByKey = Object.fromEntries((s.review ? s.review.items : []).map((it, i) => [it.assertion_key, `A${i + 1} ${it.text}`]));
    blocks.push({ t: 'table', head: ['초안 문장', '이전', '이후', '변화'], widths: [0.4, 0.18, 0.18, 0.24], rows: d.items.map((it) => [
      textByKey[it.assertion_key] || L.shortId(it.assertion_key),
      it.before_status ? (L.REVIEW_STATUS[it.before_status] || '—') : '—',
      it.after_status ? (L.REVIEW_STATUS[it.after_status] || '—') : '—',
      `${it.change_types.map((c) => L.CHANGE[c] || c).join(', ')} — ${it.reason}`,
    ]) });
    if (d.question_changes.length) {
      blocks.push({ t: 'list', items: d.question_changes.map((q) => `${(qById[q.question_id] || {}).question_key || ''} ${(qById[q.question_id] || {}).question || ''}: ${L.QUESTION_STATUS[q.before_status]} → ${L.QUESTION_STATUS[q.after_status]}`) });
    }
  }

  blocks.push({ t: 'h', text: '근거 목록' });
  if (!s.source_dependencies.length) blocks.push({ t: 'p', text: '해당 항목 없음', muted: true });
  else {
    const seen = new Set();
    const rows = [];
    for (const d of s.source_dependencies) {
      const k = `${d.source_id}|${d.revision_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push([d.title, L.kst(d.published_at), L.RIGHTS[d.rights_class] || d.rights_class,
        [d.url, `Source ${L.shortId(d.source_id)} · Revision ${L.shortId(d.revision_id)}`]]);
    }
    blocks.push({ t: 'table', head: ['출처', '발행 시각', '권리', '주소와 참조'], widths: [0.24, 0.2, 0.14, 0.42], rows });
  }
  blocks.push({ t: 'note', text: '이 보고서는 고정된 검토 버전의 기록이며 이후의 자료 변경을 반영하지 않는다. 기사 게재와 프로그램 편성은 사람이 결정한다. 합성 반론은 사실도 독자 반응 예측도 아니다.' });
  return { title: `기획 검토 보고서 — ${s.title}`, blocks, demo };
}

function uniqueTitles(deps) {
  return [...new Set(deps.map((d) => d.title))].join(', ');
}
