// The summary card at the top of a case (MarketView decision card): where the
// review stands, how the sentences split, and the one thing to do next.
import { LoaderCircle, ArrowDown, Bell, ArrowRight } from 'lucide-react';
import * as L from '../labels.js';
import { app, go } from '../app/store.js';
import { JOB } from '../app/api.js';
import { NextAction, Btn, LinkBtn, cx } from '../ui/kit.jsx';
import { DOT } from '../ui/status.jsx';
import { when } from '../app/time.js';
import { useCase, isDone } from './facts.js';
import { countStatus, REVIEW_ORDER, uniq } from './shared.jsx';

const SEC_OF = { execution: 'sec-evidence', review: 'sec-review', reassessment: 'sec-reassess', search: 'sec-search', export: 'sec-report' };
const RUNNING_TEXT = {
  execution: '공개 자료에서 근거를 모으는 중입니다',
  review: '초안 문장을 근거와 대조하는 중입니다',
  reassessment: '새 자료로 다시 검토하는 중입니다',
  search: '공개 자료를 다시 찾는 중입니다',
  export: '보고서 파일을 만드는 중입니다',
};
const REVIEW_TONE = { SUPPORTED: 'pos', CONFLICT: 'warn', CONTRADICTED: 'neg', INSUFFICIENT_EVIDENCE: 'mute', NON_FACTUAL: 'plain' };
const PILL = { pos: 'bg-positive-bg text-positive-ink', warn: 'bg-warning-bg text-warning-ink', neg: 'bg-negative-bg text-negative-ink', mute: 'bg-g100 text-g600', run: 'bg-brand-bg text-brand' };

function Verdict({ tone, label, sub }) {
  return (
    <div className={cx('flex min-w-[120px] flex-col items-center justify-center rounded-xl px-4 py-3 text-center', PILL[tone])}>
      <span className="text-lg font-extrabold leading-tight">{label}</span>
      {sub ? <span className="mt-0.5 text-[11px] font-semibold opacity-80">{sub}</span> : null}
    </div>
  );
}

// a bar split by sentence counts, with the legend under it (counts, not probabilities)
function SplitBar({ counts, total }) {
  const shown = REVIEW_ORDER.filter((k) => counts[k]);
  return (
    <div className="rounded-xl bg-g50 p-4">
      <p className="text-xs text-g500">초안 문장 {total}개의 판정</p>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-g200" aria-hidden="true">
        {shown.map((k) => <div key={k} className={DOT[REVIEW_TONE[k]]} style={{ width: `${(counts[k] / total) * 100}%` }} />)}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
        {REVIEW_ORDER.map((k) => (
          <span key={k} className={cx('inline-flex items-center gap-1.5', counts[k] ? 'text-g700' : 'text-g400')}>
            <span className={cx('size-2 rounded-full', counts[k] ? DOT[REVIEW_TONE[k]] : 'bg-g200')} aria-hidden="true" />{L.REVIEW_STATUS[k]} <span className="num">{counts[k]}</span>
          </span>
        ))}
      </p>
    </div>
  );
}

function pickForTask(r, items) {
  app.set({ taskDraft: {
    origin: { kind: 'review', id: r.id }, assertion_ids: items.map((it) => it.assertion_id),
    conflict_ids: uniq(items.flatMap((it) => it.conflict_ids)), unknown_ids: uniq(items.flatMap((it) => it.unknown_ids)),
  } });
}

function reviewNext(f, r) {
  const numbered = r.items.map((it, i) => ({ it, n: i + 1 }));
  const fix = numbered.filter((x) => x.it.status === 'CONTRADICTED');
  const covered = new Set(f.tasks.filter((t) => t.status !== 'CANCELLED').flatMap((t) => t.assertion_ids));
  const unsure = numbered.filter((x) => (x.it.status === 'CONFLICT' || x.it.status === 'INSUFFICIENT_EVIDENCE') && !covered.has(x.it.assertion_id));
  const open = f.tasks.filter((t) => t.status === 'OPEN');
  const names = (list) => list.map((x) => `A${x.n}`).join(', ');
  if (fix.length) {
    return {
      text: <>{names(fix)} 문장이 근거와 다릅니다. {fix[0].it.recommendation}</>,
      action: f.write ? <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-input', intakeOpen: true })}>초안 고치기</Btn> : null,
    };
  }
  if (open.length) {
    return {
      text: <>열린 취재 과제 {open.length}건이 있습니다. 확보한 자료를 취재 결과로 등록하고 다시 검토하세요.</>,
      action: <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-reassess', taskId: open[0].id })}>취재 결과 등록</Btn>,
    };
  }
  if (unsure.length) {
    return {
      text: <>{names(unsure)} 문장은 출처끼리 다르거나 근거가 부족합니다. 취재 과제로 넘기세요.</>,
      action: f.write ? <Btn kind="primary" size="sm" onClick={() => { pickForTask(r, unsure.map((x) => x.it)); go({ to: 'sec-tasks', creatingTask: true, taskOrigin: { kind: 'review', id: r.id } }); }}>취재 과제 만들기</Btn> : null,
    };
  }
  if (!f.exports.some((x) => x.input_id === r.id && x.status === 'COMPLETED')) {
    return {
      text: <>검토 결과를 보고서로 만들어 데스크와 공유하세요. 게재 판단은 사람이 합니다.</>,
      action: <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-report', exportInput: { kind: 'DRAFT_REVIEW', id: r.id } })}>보고서 만들기</Btn>,
    };
  }
  return { text: <>보고서를 받아 데스크와 공유하세요. 게재 판단은 사람이 합니다.</>, action: <Btn size="sm" onClick={() => go({ to: 'sec-report' })}>보고서 보기</Btn> };
}

function ReviewSummary({ f, r }) {
  const counts = countStatus(r.items);
  const total = r.items.length;
  const fix = counts.CONTRADICTED;
  const unsure = counts.CONFLICT + counts.INSUFFICIENT_EVIDENCE;
  const [tone, label] = fix ? ['neg', '고칠 문장 있음'] : unsure ? ['warn', '확인 필요'] : ['pos', '근거 확인됨'];
  const headline = !total ? '판정할 문장이 없습니다'
    : fix ? `초안 ${total}문장 중 ${fix}문장이 근거와 다릅니다`
      : unsure ? `초안 ${total}문장 중 ${unsure}문장은 더 확인해야 합니다`
        : '판정 대상 문장은 모두 근거가 있습니다';
  const delta = f.deltas.find((d) => d.after_review_id === r.id);
  const moved = delta ? delta.items.filter((it) => it.change_types.includes('STATUS_CHANGED')).length : 0;
  const next = reviewNext(f, r);
  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <Verdict tone={tone} label={label} sub={fix ? `${fix}문장` : unsure ? `${unsure}문장` : `${total}문장`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-g500">검토 요약 · 기준 {when(r.as_of)}{r.status === 'PARTIAL' ? ' · 부분 결과' : ''}</p>
          <p className="mt-1 text-[17px] font-bold leading-snug text-g900">{headline}</p>
          <p className="mt-1 text-sm text-g600">
            {delta ? <>재검토로 판정이 바뀐 문장 {moved}개 · </> : null}
            과제 {f.tasks.length}건 · 보고서 {f.exports.filter((x) => x.status === 'COMPLETED').length}건
          </p>
        </div>
      </div>
      {total ? <div className="mt-4"><SplitBar counts={counts} total={total} /></div> : null}
      <div className="mt-4"><NextAction action={next.action}>{next.text}</NextAction></div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <LinkBtn onClick={() => go({ to: 'sec-review', view: { kind: 'review', id: r.id }, sub: 'sheet' })}>문장별 판정 <ArrowDown className="size-3.5" aria-hidden="true" /></LinkBtn>
        <LinkBtn onClick={() => go({ to: 'sec-evidence' })}>근거 <ArrowDown className="size-3.5" aria-hidden="true" /></LinkBtn>
        {delta ? <LinkBtn onClick={() => go({ to: 'sec-compare', deltaId: delta.id })}>달라진 점 <ArrowDown className="size-3.5" aria-hidden="true" /></LinkBtn> : null}
        <LinkBtn onClick={() => go({ to: 'sec-report' })}>보고서 <ArrowDown className="size-3.5" aria-hidden="true" /></LinkBtn>
      </p>
    </>
  );
}

function BriefSummary({ f, b }) {
  const count = (sec) => { const s = b.sections.find((x) => x.section === sec); return s ? s.items.length : 0; };
  const known = count('WHAT_WE_KNOW');
  const disputed = count('WHAT_IS_DISPUTED');
  const unknown = count('WHAT_IS_STILL_UNKNOWN');
  const [tone, label] = disputed ? ['warn', '상충 있음'] : unknown ? ['mute', '공백 있음'] : ['pos', '정리됨'];
  const open = f.tasks.filter((t) => t.status === 'OPEN');
  const next = open.length
    ? { text: <>열린 취재 과제 {open.length}건이 있습니다. 확보한 자료로 근거를 다시 실행하세요.</>, action: <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-reassess', taskId: open[0].id })}>취재 결과 등록</Btn> }
    : disputed || unknown
      ? { text: <>서로 다른 것과 아직 모르는 것을 취재 과제로 넘기세요.</>, action: f.write ? <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-tasks', creatingTask: true, taskOrigin: { kind: 'brief', id: b.id } })}>취재 과제 만들기</Btn> : null }
      : { text: <>기획 요약을 보고서로 만들어 공유하세요.</>, action: <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-report', exportInput: { kind: 'BRIEF', id: b.id } })}>보고서 만들기</Btn> };
  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <Verdict tone={tone} label={label} sub="초안 없는 검토" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-g500">기획 요약 · 기준 {when(b.as_of)}</p>
          <p className="mt-1 text-[17px] font-bold leading-snug text-g900">말할 수 있는 것 {known} · 서로 다른 것 {disputed} · 아직 모르는 것 {unknown}</p>
          <p className="mt-1 text-sm text-g600">질문 {b.questions.length}개 · 과제 {f.tasks.length}건</p>
        </div>
      </div>
      <div className="mt-4"><NextAction action={next.action}>{next.text}</NextAction></div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <LinkBtn onClick={() => go({ to: 'sec-review', view: { kind: 'brief', id: b.id }, sub: 'brief' })}>기획 요약 <ArrowDown className="size-3.5" aria-hidden="true" /></LinkBtn>
        <LinkBtn onClick={() => go({ to: 'sec-evidence' })}>근거 <ArrowDown className="size-3.5" aria-hidden="true" /></LinkBtn>
        <LinkBtn onClick={() => go({ to: 'sec-report' })}>보고서 <ArrowDown className="size-3.5" aria-hidden="true" /></LinkBtn>
      </p>
    </>
  );
}

function StartSummary({ f }) {
  const lastExec = f.executions[f.executions.length - 1];
  const failed = lastExec && (lastExec.status === 'FAILED' || lastExec.status === 'BLOCKED');
  let text;
  let action = null;
  if (failed) {
    text = <>근거 수집이 {lastExec.status === 'BLOCKED' ? '차단되었습니다' : '실패했습니다'}. 원인을 확인하고 입력을 고쳐 다시 시작하세요.</>;
    action = <Btn size="sm" onClick={() => go({ to: 'sec-evidence' })}>근거 수집 보기</Btn>;
  } else if (f.head.pack_id && !f.draftless) {
    text = <>근거 묶음이 준비됐습니다. 이 근거로 초안 검토를 시작하세요.</>;
    action = <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-evidence' })}>초안 검토 시작</Btn>;
  } else if (f.head.pack_id) {
    text = <>근거 묶음이 준비됐습니다. 이 근거로 기획 요약을 만드세요.</>;
    action = <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-evidence' })}>기획 요약 만들기</Btn>;
  } else {
    text = <>근거 수집을 기다리고 있습니다.</>;
  }
  return <NextAction action={action}>{text}</NextAction>;
}

export function Summary() {
  const f = useCase();
  if (!f.hasInput) return null;
  const r = f.headReview && isDone(f.headReview) ? f.headReview : null;
  const b = !r && f.headBrief ? f.headBrief : null;
  const live = f.running[0];
  return (
    <div className="rounded-2xl border-2 border-brand-bg bg-white p-5 shadow-sm">
      {live ? (
        <div className={cx('flex flex-wrap items-center gap-3 rounded-xl bg-brand-bg px-4 py-3', (r || b) && 'mb-4')} role="status">
          <LoaderCircle className="size-5 animate-spin text-brand" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm font-semibold text-g900">{RUNNING_TEXT[live.kind]}
            {live.d.stage && L.STAGE[live.d.stage] ? <span className="ml-1.5 font-normal text-g600">· {L.STAGE[live.d.stage]} 단계</span> : null}
            {f.running.length > 1 ? <span className="ml-1.5 font-normal text-g600">· 그 밖에 {f.running.length - 1}건</span> : null}
          </p>
          <Btn size="sm" onClick={() => go({ to: SEC_OF[live.kind] || 'sec-evidence' })}>{JOB[live.kind].label} 보기</Btn>
        </div>
      ) : null}
      {r ? <ReviewSummary f={f} r={r} /> : null}
      {b ? <BriefSummary f={f} b={b} /> : null}
      {!r && !b && !live ? <StartSummary f={f} /> : null}
      {f.unread ? (
        <button type="button" onClick={() => go({ to: 'sec-alerts' })} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-warning-bg px-3 py-1.5 text-xs font-semibold text-warning-ink">
          <Bell className="size-3.5" aria-hidden="true" />읽지 않은 출처 변경 알림 {f.unread}건<ArrowRight className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-g400">판정은 기준 시각까지 확인한 자료 범위 안에서만 유효합니다. 점수나 확률이 아니며, 게재 판단은 사람이 합니다.</p>
    </div>
  );
}
