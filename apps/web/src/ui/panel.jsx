// 원문 확인: Claim → Evidence → Passage → Revision → Source, as a drawer on the right.
import { useEffect, useRef } from 'react';
import { X, Quote, Lock, ExternalLink } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, closePanel } from '../app/store.js';
import { useQuery } from '../app/api.js';
import { QueryState, More, KV, IdLine, Code, Tag, Notice, cx, labelOr } from './kit.jsx';
import { when } from '../app/time.js';

// Marks the pinned code-point range inside the revision text. The text is
// rendered as text nodes only, never as markup.
function Passage({ body, start, end }) {
  const cps = Array.from(body || '');
  return (
    <blockquote className="mt-3 whitespace-pre-wrap rounded-xl border-l-4 border-brand bg-g50 px-4 py-3 text-sm leading-7 text-g700">
      {cps.slice(0, start).join('')}
      <mark>{cps.slice(start, end).join('')}</mark>
      {cps.slice(end).join('')}
    </blockquote>
  );
}

const RELATION_TEXT = {
  SUPPORT: '이 진술이 나온 원문',
  REPEAT: '같은 계열의 재게시 · 독립 확인으로 세지 않습니다',
};

function Trace({ t }) {
  return (
    <div className={cx('mt-3 rounded-xl border p-4', t.relation === 'REPEAT' ? 'border-dashed border-g300 bg-white' : 'border-g200 bg-white')}>
      <p className="text-xs font-semibold text-g500">{RELATION_TEXT[t.relation] || labelOr(L.RELATION, t.relation)}</p>
      <h5 className="mt-1 text-sm font-bold text-g900">{t.source.title}</h5>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-g500">
        <span>{labelOr(L.FAMILY, t.source.family)}</span><span aria-hidden="true">·</span>
        <span>{labelOr(L.RIGHTS, t.source.rights_class)}</span><span aria-hidden="true">·</span>
        <span>발행 {when(t.revision.published_at)}</span>
      </p>
      {/^https?:\/\//.test(t.source.url || '') ? (
        <a href={t.source.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-xs text-brand hover:underline">
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />{t.source.url}
        </a>
      ) : null}
      {t.blocked_reason ? (
        <Notice tone="mute" className="mt-3" title="원문을 보여줄 수 없습니다"><p>{t.blocked_reason}</p></Notice>
      ) : (
        <Passage body={t.revision.body} start={t.passage.start} end={t.passage.end} />
      )}
      <More className="mt-3">
        <KV rows={[
          ['받은 시각', when(t.revision.available_at)],
          ['출처 ID', <IdLine key="s" v={t.source.id} />],
          ['원문 버전', <IdLine key="r" v={t.revision.id} />],
          t.revision.body_sha256 ? ['원문 SHA-256', <Code key="h">{t.revision.body_sha256}</Code>] : null,
          ['원문 구간', <span key="p"><IdLine v={t.passage.id} />{t.passage.start !== null ? <span className="ml-1 text-g500">글자 {t.passage.start}–{t.passage.end} (끝 제외)</span> : null}</span>],
        ]} />
      </More>
    </div>
  );
}

function ClaimTrace({ caseId, packId, claimId, focus }) {
  const q = useQuery('getEvidenceTrace', { case_id: caseId, pack_id: packId, claim_id: claimId });
  const ref = useRef(null);
  // bring the chosen claim into the drawer's view once it has loaded, keeping
  // the group heading above it; only the drawer scrolls, never the page
  useEffect(() => {
    const el = ref.current;
    const box = el && el.closest ? el.closest('[data-panel-scroll]') : null;
    if (!focus || !q.data || !el || !box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top || r.top > b.bottom - 120) box.scrollTop += r.top - b.top - 44;
  }, [focus, !!q.data]);
  if (!q.data) return <div className="rounded-xl border border-g100 p-4"><QueryState q={q} what="근거 경로" /></div>;
  const c = q.data.claim;
  return (
    <article ref={ref} className={cx('scroll-mt-4 rounded-2xl border p-4', focus ? 'border-brand bg-brand-bg/30' : 'border-g200 bg-white')}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-g500"><Quote className="size-3.5" aria-hidden="true" />근거 진술</p>
      <p className="mt-1 text-[15px] font-semibold leading-relaxed text-g900">{c.text}</p>
      <p className="mt-2 flex flex-wrap gap-1.5">
        <Tag tone="line">{labelOr(L.EPISTEMIC, c.epistemic_status)}</Tag>
        <Tag tone="line">독립 출처 {c.independent_source_groups}묶음</Tag>
        {c.superseded ? <Tag tone="warn">정정 이전 기록</Tag> : null}
      </p>
      {c.superseded ? <p className="mt-2 text-xs text-g500">기관이 그렇게 말했다는 기록은 남기지만, 지금 판정의 뒷받침으로는 쓰지 않습니다.</p> : null}
      {q.net ? <QueryState q={q} /> : null}
      {q.data.traces.map((t) => <Trace key={`${t.source.id}:${t.revision.id}:${t.relation}`} t={t} />)}
      <More className="mt-3" label="진술 ID"><IdLine v={c.id} /></More>
    </article>
  );
}

const GROUP_TONE = { ok: 'text-positive-ink', bad: 'text-negative-ink', mute: 'text-g600' };

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
  // the page behind the drawer stays where it is
  useEffect(() => {
    if (!panel) return undefined;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => { root.style.overflow = prev; };
  }, [!!panel]);
  if (!panel) return null;
  const groups = panel.groups.filter((g) => g.claimIds.length);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-g900/30" onClick={closePanel} aria-hidden="true"></div>
      <aside data-panel className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col bg-g50 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <div className="flex items-start gap-3 border-b border-g200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 id="panel-title" tabIndex={-1} ref={head} className="text-lg font-bold text-g900 focus:outline-none">원문 확인</h3>
            <p className="mt-0.5 line-clamp-2 text-sm text-g600">{panel.title}</p>
          </div>
          <button type="button" onClick={closePanel} className="rounded-lg p-1.5 text-g500 hover:bg-g100" aria-label="원문 확인 닫기"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div data-panel-scroll className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-g500"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />표시한 구간은 이 근거 묶음에 고정된 원문 버전의 글자 위치입니다. 권리가 확인되지 않은 자료는 본문을 보여 주지 않습니다.</p>
          {groups.length === 0 ? <p className="text-sm text-g500">연결된 근거 진술이 없습니다.</p> : null}
          {groups.map((g) => (
            <section key={g.label}>
              <h4 className={cx('mb-2 text-sm font-bold', GROUP_TONE[g.tone] || 'text-g700')}>{g.label} <span className="num font-semibold text-g400">{g.claimIds.length}</span></h4>
              <div className="space-y-3">
                {g.claimIds.map((id) => <ClaimTrace key={id} caseId={panel.caseId} packId={panel.packId} claimId={id} focus={panel.focus === id} />)}
              </div>
            </section>
          ))}
          {panel.note ? <p className="text-xs text-g500">{panel.note}</p> : null}
          <More label="근거 묶음 ID"><IdLine v={panel.packId} /></More>
        </div>
      </aside>
    </>
  );
}
