// UI-04 원문 패널: Claim → Evidence → Passage → Revision → Source.
/* global React */
import * as L from '../labels.js';
import { app, useStore, closePanel } from './store.js';
import { useQuery } from './api.js';
import { Id, QueryState, Btn, cx, labelOr } from './ui.jsx';
import { when } from './time.js';

const { useEffect, useRef } = React;

// Marks the pinned code-point range inside the revision text. The text is
// rendered as text nodes only, never as markup.
function Passage({ body, start, end }) {
  const cps = Array.from(body);
  return (
    <blockquote className="orig">
      {cps.slice(0, start).join('')}
      <mark>{cps.slice(start, end).join('')}</mark>
      {cps.slice(end).join('')}
    </blockquote>
  );
}

const RELATION_TEXT = {
  SUPPORT: '이 진술이 나온 원문',
  REPEAT: '같은 계열의 재게시. 독립 확인으로 세지 않습니다',
};

function Trace({ t }) {
  return (
    <div className={cx('src', t.relation === 'REPEAT' && 'src-repeat')}>
      <p className="src-rel">{RELATION_TEXT[t.relation] || t.relation}</p>
      <h5>{t.source.title}</h5>
      <dl className="kv">
        <dt>출처 주소</dt><dd className="url">{t.source.url}</dd>
        <dt>출처 계열</dt><dd>{labelOr(L.FAMILY, t.source.family)}</dd>
        <dt>권리</dt><dd>{labelOr(L.RIGHTS, t.source.rights_class)}</dd>
        <dt>발행 시각</dt><dd>{when(t.revision.published_at)}</dd>
        <dt>받은 시각</dt><dd>{when(t.revision.available_at)}</dd>
        <dt>출처 ID</dt><dd><Id v={t.source.id} /></dd>
        <dt>원문 버전</dt><dd><Id v={t.revision.id} />{t.revision.body_sha256 ? <span className="hash"> SHA-256 {t.revision.body_sha256.slice(0, 12)}…</span> : null}</dd>
        <dt>원문 구간</dt>
        <dd><Id v={t.passage.id} />{t.passage.start !== null ? <span className="mono"> 자 {t.passage.start}–{t.passage.end} (끝 제외)</span> : null}</dd>
      </dl>
      {t.blocked_reason ? (
        <div className="blocked">
          <p className="blocked-h">원문을 보여줄 수 없습니다</p>
          <p>{t.blocked_reason}</p>
        </div>
      ) : (
        <Passage body={t.revision.body} start={t.passage.start} end={t.passage.end} />
      )}
    </div>
  );
}

function ClaimTrace({ caseId, packId, claimId, focus }) {
  const q = useQuery('getEvidenceTrace', { case_id: caseId, pack_id: packId, claim_id: claimId });
  const ref = useRef(null);
  // bring the chosen claim just under the panel's fixed heading, only when it is out of view
  useEffect(() => {
    const el = ref.current;
    const box = el && el.closest ? el.closest('.panel') : null;
    if (!focus || !q.data || !box) return;
    const r = el.getBoundingClientRect();
    const p = box.getBoundingClientRect();
    const headH = box.firstElementChild ? box.firstElementChild.getBoundingClientRect().height : 0;
    if (r.top < p.top + headH || r.top > p.bottom - 140) box.scrollTop += r.top - p.top - headH - 8;
  }, [focus, !!q.data]);
  if (!q.data) return <div className="trace"><QueryState q={q} what="근거 경로" /></div>;
  const c = q.data.claim;
  return (
    <article className={cx('trace', focus && 'trace-focus')} ref={ref}>
      <p className="trace-k">근거 진술 <span className="mono">Claim</span> <Id v={c.id} /></p>
      <p className="trace-text">{c.text}</p>
      <p className="trace-meta">
        <span className="chip">{labelOr(L.EPISTEMIC, c.epistemic_status)}</span>
        <span className="chip">독립 출처 묶음 {c.independent_source_groups}</span>
      </p>
      {c.superseded ? <p className="trace-note">정정 이전의 기록입니다. 기관이 그렇게 말했다는 사실은 남기지만 지금 판정의 뒷받침으로는 쓰지 않습니다.</p> : null}
      {q.net ? <QueryState q={q} /> : null}
      {q.data.traces.map((t) => <Trace key={`${t.source.id}:${t.revision.id}:${t.relation}`} t={t} />)}
    </article>
  );
}

export function SourcePanel() {
  const panel = useStore(app, (s) => s.panel);
  const head = useRef(null);
  useEffect(() => {
    if (!panel) return undefined;
    if (head.current) head.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel && panel.token]);
  if (!panel) return null;
  const groups = panel.groups.filter((g) => g.claimIds.length);
  return (
    <>
      <div className="panel-back" onClick={closePanel} aria-hidden="true"></div>
      <aside className="panel" role="dialog" aria-labelledby="panel-title">
        <div className="panel-head">
          <div>
            <h3 id="panel-title" tabIndex={-1} ref={head}>원문 확인</h3>
            <p className="panel-ctx">{panel.title}</p>
          </div>
          <Btn kind="ghost" onClick={closePanel}>닫기</Btn>
        </div>
        <p className="panel-pin">근거 묶음 <Id v={panel.packId} /> 기준. 표시한 구간은 이 묶음에 고정된 원문 버전의 글자 위치입니다.</p>
        {groups.length === 0 ? <p className="empty">연결된 근거 진술이 없습니다.</p> : null}
        {groups.map((g) => (
          <section key={g.label} className={cx('panel-group', `tone-${g.tone}`)}>
            <h4><span className="panel-group-l">{g.label}</span> {g.claimIds.length}건</h4>
            {g.claimIds.map((id) => <ClaimTrace key={id} caseId={panel.caseId} packId={panel.packId} claimId={id} focus={panel.focus === id} />)}
          </section>
        ))}
        {panel.note ? <p className="panel-note">{panel.note}</p> : null}
      </aside>
    </>
  );
}
