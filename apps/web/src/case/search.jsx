// 공개 자료 다시 찾기: 아직 풀리지 않은 질문 하나를 기준 근거·기준 시각·예산에 고정해 한 번 검색합니다.
import { useState } from 'react';
import { Search } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, go } from '../app/store.js';
import { useAction, fieldErrors } from '../app/api.js';
import { Status } from '../ui/status.jsx';
import { Fold, Btn, Field, Select, TimeField, useClockField, Notice, More, KV, IdLine, Code, Tag, Empty, ActionState, Warnings, inputCls, useReveal, cx, labelOr } from '../ui/kit.jsx';
import { when, whenShort, count } from '../app/time.js';
import { JobProgress } from './jobs.jsx';

const OPEN_Q = ['OPEN', 'PARTIALLY_RESOLVED', 'CONFLICTED'];

function SearchForm({ f, view }) {
  const a = useAction();
  const asOf = useClockField();
  const qa = Object.fromEntries(view.question_assessments.map((x) => [x.question_id, x]));
  const open = view.questions.filter((q) => qa[q.id] && OPEN_Q.includes(qa[q.id].status));
  const leafFirst = [...open].sort((x, y) => (y.parent_id ? 1 : 0) - (x.parent_id ? 1 : 0));
  const firstOpenLeaf = leafFirst.find((q) => qa[q.id].status === 'OPEN') || leafFirst[0];
  const [qid, setQid] = useState(firstOpenLeaf ? firstOpenLeaf.id : '');
  const [text, setText] = useState(null);
  const [qb, setQb] = useState(10);
  const [sb, setSb] = useState(20);
  const q = open.find((x) => x.id === qid) || null;
  const question = text === null ? (q ? q.question : '') : text;
  const fe = fieldErrors(a.error);
  const num = (v) => (v === '' ? '' : Number(v));
  if (!open.length) return <Empty>지금 활성 결과에 남은 질문이 없습니다.</Empty>;
  const submit = () => a.run('createResearchSearch', {
    params: { case_id: f.c.id },
    body: { baseline_pack_id: view.reality_pack_id, question_id: qid, question, as_of: asOf.iso, parameters: { query_budget: qb, source_budget: sb, language: 'ko' } },
    // the record and its detail appear below the form; show them without taking focus
    onOk: (res) => go({ searchId: res.data.search_id, reveal: { kind: 'search', id: res.data.search_id, soft: true } }),
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <Field id="srch-q" label="다시 찾을 질문" required error={fe.question_id} hint={`지금 활성 결과(기준 ${when(view.as_of)})에서 아직 풀리지 않은 질문만 고를 수 있습니다.`}>
        <Select id="srch-q" value={qid} onChange={(e) => { setQid(e.target.value); setText(null); }}>
          {open.map((x) => <option key={x.id} value={x.id}>{x.question_key} {x.question} · {labelOr(L.QUESTION_STATUS, qa[x.id].status)}</option>)}
        </Select>
      </Field>
      <Field id="srch-text" label="검색에 쓸 질문 문장" required error={fe.question} count={count(question)} max={2000}>
        <input id="srch-text" type="text" className={inputCls} value={question} onChange={(e) => setText(e.target.value)} aria-invalid={!!fe.question} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="srch-qb" label="질의 예산" error={fe['parameters.query_budget']} hint="1에서 20">
          <input id="srch-qb" type="number" inputMode="numeric" className={inputCls} value={qb} onChange={(e) => setQb(num(e.target.value))} />
        </Field>
        <Field id="srch-sb" label="자료 예산" error={fe['parameters.source_budget']} hint="1에서 50">
          <input id="srch-sb" type="number" inputMode="numeric" className={inputCls} value={sb} onChange={(e) => setSb(num(e.target.value))} />
        </Field>
        <TimeField id="srch-asof" label="기준 시각" required field={asOf} error={fe.as_of} />
      </div>
      <div className="empty:hidden"><ActionState a={a} fields={['question_id', 'question', 'parameters.query_budget', 'parameters.source_budget', 'as_of']} /></div>
      <Btn kind="primary" type="submit" icon={Search} busy={a.busy}>검색 제출</Btn>
    </form>
  );
}

function reading(s) {
  const found = s.new_submission_ids.length;
  if (s.status === 'COMPLETED' && found === 0) return ['mute', '검색은 끝까지 마쳤고 관련 자료는 0건입니다. 질문은 풀리지 않은 채로 남습니다. 0건은 질문이 풀렸다는 근거가 아닙니다.'];
  if (s.status === 'COMPLETED') return ['ok', `새 자료 ${found}건을 찾았습니다. 원문과 구간을 확인한 뒤 재검토에 넣을 자료를 고릅니다. 질문 평가는 후속 검토에서만 바뀝니다.`];
  if (s.status === 'PARTIAL') return ['warn', '일부 채널이 실패해 확인한 범위가 좁습니다. 실패한 채널에 자료가 있을 수 있으므로 공백이 풀린 것으로 보지 않습니다.'];
  if (s.status === 'FAILED') return ['bad', '모든 채널이 실패했습니다. 검색을 하지 못한 것이며 자료가 없다는 뜻이 아닙니다. 기존 결과는 그대로입니다.'];
  return ['mute', ''];
}

function SearchDetail({ s, corr }) {
  const [ref] = useReveal('search', s.id, 'start');
  const ch = (list) => (list.length ? list.map((x) => labelOr(L.CHANNEL, x)).join(', ') : '없음');
  if (s.status === 'QUEUED' || s.status === 'RUNNING') {
    return <div ref={ref} tabIndex={-1} className="focus:outline-none"><JobProgress kind="search" d={s} title={`공개 자료를 찾는 중입니다 · ${s.question}`} corr={corr} /></div>;
  }
  const [tone, text] = reading(s);
  return (
    <div ref={ref} tabIndex={-1} className="space-y-3 rounded-xl border border-g200 p-4 focus:outline-none">
      <div className="flex flex-wrap items-start gap-2"><p className="min-w-0 flex-1 text-sm font-bold text-g900">{s.question}</p><Status kind="job" code={s.status} /></div>
      <Notice tone={tone} role="status">{text}</Notice>
      <Warnings items={s.warnings} />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-g500">검색 계획</p>
          <ul className="space-y-1 text-sm text-g700">{s.plan.map((pl, i) => <li key={i}><Tag tone="line">{labelOr(L.PURPOSE, pl.purpose)}</Tag> {pl.query}</li>)}</ul>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-g500">확인한 범위와 사용량</p>
          <KV className="text-sm" rows={[
            ['끝낸 채널', ch(s.coverage.completed_channels)],
            ['실패한 채널', <span key="f" className={cx(s.coverage.failed_channels.length && 'text-negative-ink')}>{ch(s.coverage.failed_channels)}</span>],
            ['예산으로 미룬 자료', `${s.coverage.deferred_source_count}건`],
            ['사용량', `질의 ${s.query_used}/${s.parameters.query_budget} · 자료 ${s.source_used}/${s.parameters.source_budget}`],
            ['새 자료', `${s.new_submission_ids.length}건`],
          ]} />
        </div>
      </div>
      <p className="text-xs text-g500">검색 결과의 요약문은 근거가 아닙니다. 원문 전체와 구간을 받아 근거 검증을 거친 것만 근거가 됩니다. 검색이 초안 검토를 스스로 바꾸지 않습니다.</p>
      {s.status === 'COMPLETED' || s.status === 'PARTIAL' ? (
        <div className="flex flex-wrap gap-2">
          {s.new_submission_ids.length ? <Btn kind="primary" size="sm" onClick={() => go({ to: 'sec-reassess' })}>재검토에 넣을 자료 고르기</Btn> : <Btn size="sm" onClick={() => go({ to: 'sec-tasks' })}>사람의 취재로 넘기기</Btn>}
        </div>
      ) : null}
      <More>
        <KV rows={[['검색', <IdLine key="i" v={s.id} />], ['기준 근거 묶음', <IdLine key="p" v={s.baseline_pack_id} />], ['질문', <IdLine key="q" v={s.question_id} />],
          ['기준 시각', when(s.as_of)], ['접수', when(s.created_at)], s.completed_at ? ['끝난 시각', when(s.completed_at)] : null, ['추적 번호', <IdLine key="c" v={corr} />],
          s.candidate_pack_id ? ['후보 근거 묶음', <IdLine key="cp" v={s.candidate_pack_id} />] : null, s.error_code ? ['오류 코드', <Code key="e">{s.error_code}</Code>] : null]} />
      </More>
    </div>
  );
}

export function SearchCard({ f }) {
  const route = useStore(app, (s) => s.route);
  const view = f.headReview || f.headBrief;
  const searches = f.searches;
  const sel = searches.find((s) => s.id === route.searchId) || searches[searches.length - 1] || null;
  const live = searches.filter((s) => s.status === 'QUEUED' || s.status === 'RUNNING').length;
  return (
    <Fold id="sec-search" icon={Search} title="공개 자료 다시 찾기" defaultOpen={!!route.searchId || live > 0}
      sub="남은 질문 하나를 기준 근거·기준 시각·예산에 고정해 한 번 검색합니다. 찾은 자료는 위의 재검토에 넣습니다."
      badge={searches.length ? <Tag tone="line">검색 {searches.length}건</Tag> : null}>
      <div className="space-y-5">
        {!f.write ? <Notice tone="mute">열람 권한에서는 검색을 제출할 수 없습니다.</Notice> : null}
        {f.write && view && view.questions ? <SearchForm key={view.id} f={f} view={view} /> : null}
        {f.write && !view ? <Empty>검색의 기준으로 삼을 활성 결과가 아직 없습니다.</Empty> : null}
        {searches.length ? (
          <div>
            <p className="mb-2 text-xs font-semibold text-g500">검색 기록</p>
            <ul className="mb-3 flex flex-wrap gap-2">
              {[...searches].reverse().map((s) => (
                <li key={s.id}>
                  <button type="button" aria-pressed={sel && sel.id === s.id} onClick={() => go({ searchId: s.id })}
                    className={cx('inline-flex max-w-[280px] items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs', sel && sel.id === s.id ? 'border-brand bg-brand-bg text-brand' : 'border-g200 text-g600 hover:border-g300')}>
                    <span className="truncate">{s.question}</span><span className="shrink-0 text-g400">{whenShort(s.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {sel ? <SearchDetail s={sel} corr={f.led ? f.led.corr[sel.id] : null} /> : null}
          </div>
        ) : <p className="text-sm text-g500">이 기획에서 제출한 검색이 아직 없습니다.</p>}
      </div>
    </Fold>
  );
}
