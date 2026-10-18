// A running job drawn in its own section: the stages it goes through, the one
// it is on, and how often the page checks. Identifiers stay behind '자세히'.
import { LoaderCircle, Check } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore } from '../app/store.js';
import { pollNow, JOB } from '../app/api.js';
import { Status } from '../ui/status.jsx';
import { Notice, More, KV, IdLine, Code, LinkBtn, Warnings, cx, josa } from '../ui/kit.jsx';
import { when, clockTime } from '../app/time.js';

const STAGES = {
  execution: ['QUEUED', 'INGEST', 'REALITY', 'COMMIT'],
  review: ['QUEUED', 'RUNNING'],
  reassessment: ['QUEUED', 'INGEST', 'REALITY', 'REVIEW', 'COMMIT'],
  search: ['QUEUED', 'RUNNING'],
  export: ['QUEUED', 'RUNNING'],
};
const RUNNING_AS = { review: '초안 대조', search: '공개 자료 검색', export: '파일 만들기' };
const stageLabel = (kind, s) => (s === 'RUNNING' && RUNNING_AS[kind]) || L.STAGE[s] || s;

export function JobProgress({ kind, d, title, corr }) {
  const watch = useStore(app, (s) => s.watch);
  const stages = STAGES[kind] || ['QUEUED', 'RUNNING'];
  const at = Math.max(0, stages.indexOf(d.stage));
  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <LoaderCircle className="size-5 animate-spin text-brand" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[15px] font-bold text-g900">{title}</p>
        <Status kind="job" code={d.status} />
      </div>
      <ol className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="진행 단계">
        {stages.map((s, j) => (
          <li key={s} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
            j < at ? 'bg-positive-bg text-positive-ink' : j === at ? 'bg-brand text-white' : 'bg-white text-g400 ring-1 ring-inset ring-g200')}>
            {j < at ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : null}{stageLabel(kind, s)}
            {j === at ? <span className="sr-only"> 진행 중</span> : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-g500">
        {watch.paused ? '화면이 가려져 있어 확인을 멈췄습니다. 돌아오면 바로 한 번 확인합니다.' : `${Math.round(watch.interval / 100) / 10}초마다 상태를 확인합니다.`}
        {' '}마지막 확인 {clockTime(watch.lastAt)} · 접수 {when(d.created_at)} <LinkBtn className="ml-1 text-xs" onClick={() => pollNow(true)}>지금 확인</LinkBtn>
      </p>
      <More className="mt-2"><JobIds kind={kind} d={d} corr={corr} /></More>
    </div>
  );
}

export function JobIds({ kind, d, corr }) {
  return (
    <KV rows={[
      [JOB[kind] ? JOB[kind].label : kind, <IdLine key="i" v={d.id} />],
      d.job_id ? ['작업', <IdLine key="j" v={d.job_id} />] : null,
      ['추적 번호', <IdLine key="c" v={corr} />],
      ['상태 코드', <Code key="s">{d.status}{d.stage ? ` · ${d.stage}` : ''}</Code>],
      d.error_code ? ['오류 코드', <Code key="e">{d.error_code}</Code>] : null,
    ]} />
  );
}

// a job that ended without a usable result
export function JobFailed({ kind, d, title, corr, children }) {
  return (
    <Notice tone="bad" role="alert" title={title || (() => { const w = JOB[kind] ? JOB[kind].label : '작업'; return `${w}${josa(w, '이', '가')} ${d.status === 'BLOCKED' ? '차단되었습니다' : '실패했습니다'}`; })()}>
      {children}
      <Warnings items={d.warnings} />
      <More><JobIds kind={kind} d={d} corr={corr} /></More>
    </Notice>
  );
}

// a finished result that is not the active one
export function BranchNote() {
  return <Notice tone="warn">정상적으로 끝난 결과이지만 지금 활성 결과는 아닙니다. 그사이 활성 입력이나 결과가 바뀌어 별도 가지로 보존했습니다. 자동으로 합치지 않습니다.</Notice>;
}
