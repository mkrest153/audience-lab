// 5단계 재검토: 확보한 원문을 과제의 취재 결과로 묶고, 그 자료로 다시 검토해
// 무엇이 왜 바뀌었는지 봅니다. 공개 자료 다시 찾기와 출처 변경 알림도 여기 있습니다.
import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Sparkles, Link2, FileText } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, go, serverNow } from '../app/store.js';
import { useMany, useAction, fieldErrors } from '../app/api.js';
import DEMO, { sourceBody } from '../app/demo.js';
import { Status } from '../ui/status.jsx';
import { Section, Card, Btn, LinkBtn, Field, Select, Segmented, Choice, Check2, TimeField, useClockField, Notice, More, KV, IdLine, Code, Empty, ActionState, inputCls, areaCls, cx, labelOr, laterIso } from '../ui/kit.jsx';
import { whenShort, count, toLocalInput } from '../app/time.js';
import { useCase, isDone } from './facts.js';
import { FetchFromUrl } from './fetchurl.jsx';
import { JobProgress, JobFailed, BranchNote } from './jobs.jsx';
import { CompareBlock } from './compare.jsx';
import { SearchCard } from './search.jsx';
import { AlertsCard } from './alerts.jsx';

const RIGHTS_OPTIONS = ['OPEN', 'UNKNOWN', 'RESTRICTED_LINK_ONLY', 'LICENSED_FULL_TEXT', 'LICENSED_PASSAGE'];
const SENSITIVITY = { PUBLIC: '공개 자료', INTERNAL: '내부 자료', CONFIDENTIAL_UNPUBLISHED: '미공개 기밀', ORGANIZATION_PRIVATE_DATA: '조직 비공개 데이터' };
const BLANK = { title: '', locator: 'url', source_url: '', transcript_locator: '', rights_class: 'OPEN', sensitivity: 'PUBLIC', body: '' };

// a numbered step inside the workflow card
function Step({ n, title, done, children, last }) {
  return (
    <li className="relative flex gap-4">
      {!last ? <span className="absolute bottom-0 left-[13px] top-8 w-px bg-g200" aria-hidden="true" /> : null}
      <span className={cx('num relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', done ? 'bg-positive text-white' : 'bg-brand-bg text-brand')}>{n}</span>
      <div className={cx('min-w-0 flex-1', !last && 'pb-8')}>
        <p className="pt-1 text-[15px] font-bold text-g900">{title}</p>
        <div className="mt-3 space-y-3">{children}</div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- ① 원문 등록
function SubmissionForm({ f, onDone }) {
  const a = useAction();
  const [form, setForm] = useState(BLANK);
  const rec = useClockField();
  const fe = fieldErrors(a.error);
  const metaOnly = form.rights_class !== 'OPEN';
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const body = {
    title: form.title,
    source_url: form.locator === 'url' ? form.source_url : null,
    transcript_locator: form.locator === 'transcript' ? form.transcript_locator : null,
    recorded_at: rec.iso, sensitivity: form.sensitivity, rights_class: form.rights_class,
    body: metaOnly ? null : form.body,
  };
  const fill = (k) => {
    const s = sourceBody(k);
    setForm({ ...BLANK, title: s.title, source_url: s.source_url, rights_class: s.rights_class, body: s.body || '' });
    rec.set(toLocalInput(s.recorded_at));
  };
  const fillOwn = () => {
    setForm({ ...BLANK, title: '시연 자료에 없는 글', source_url: 'https://example.org/own-note', body: '담당 부서와 통화한 내용을 직접 정리한 글이다.' });
    rec.reset();
  };
  const submit = () => a.run('createEvidenceSubmission', {
    params: { case_id: f.c.id }, body,
    onOk: (res) => { onDone(res.data.submission); setForm(BLANK); rec.reset(); },
  });
  return (
    <form className="rounded-xl border border-g200 p-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      {f.demo ? (
        <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1 font-semibold text-example"><Sparkles className="size-4" aria-hidden="true" />시연 자료</span>
          <LinkBtn onClick={() => fill('S6')}>S6 분리 내역</LinkBtn>
          <LinkBtn onClick={() => fill('S7')}>S7 계약대장 보충</LinkBtn>
          <LinkBtn onClick={() => fill('S5')}>S5 권리 미확인</LinkBtn>
          <LinkBtn onClick={fillOwn}>시연 밖 자료</LinkBtn>
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="sub-title" label="자료 제목" required error={fe.title} count={count(form.title)} max={300}>
          <input id="sub-title" type="text" className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} aria-invalid={!!fe.title} />
        </Field>
        <TimeField id="sub-recorded" label="기록 시각" required field={rec} error={fe.recorded_at} hint="자료가 기록·발행된 때입니다. 받은 시각은 서버가 따로 남깁니다." />
        <div className="md:col-span-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-sm text-g600">출처 <span className="text-[11px] font-semibold text-brand">필수</span></span>
            <Segmented id="sub-locator" label="출처 종류" value={form.locator} onChange={(v) => set('locator', v)} items={[{ id: 'url', label: 'HTTPS 주소', icon: Link2 }, { id: 'transcript', label: '공개 전사 위치', icon: FileText }]} />
          </div>
          {form.locator === 'url' ? (
            <>
              <label htmlFor="sub-url" className="sr-only">HTTPS 주소</label>
              <input id="sub-url" type="url" inputMode="url" className={inputCls} placeholder="https://" value={form.source_url} onChange={(e) => set('source_url', e.target.value)} aria-invalid={!!fe.source_url} />
              {!f.demo ? (
                <FetchFromUrl url={form.source_url}
                  onFill={(page) => setForm((x) => ({ ...x, title: x.title || [...(page.title || '')].slice(0, 300).join(''), source_url: page.final_url || x.source_url, body: page.text, rights_class: 'OPEN', sensitivity: 'PUBLIC' }))}
                  onRecorded={(at) => { if (at) rec.set(toLocalInput(at)); }} />
              ) : null}
            </>
          ) : (
            <><label htmlFor="sub-tr" className="sr-only">공개 전사 위치</label><input id="sub-tr" type="text" className={inputCls} placeholder="예: 공개 회의록 3쪽" value={form.transcript_locator} onChange={(e) => set('transcript_locator', e.target.value)} aria-invalid={!!fe.transcript_locator} /></>
          )}
          {fe.source_url || fe.transcript_locator ? <p className="mt-1.5 text-xs text-negative-ink" role="alert">{fe.source_url || fe.transcript_locator}</p> : null}
        </div>
        <Field id="sub-rights" label="권리" required error={fe.rights_class} hint={metaOnly ? '전문을 쓸 권리가 확인되지 않은 자료는 제목과 출처만 보관합니다. 원문은 받지 않습니다.' : '전문을 저장하고 검토에 쓸 수 있는 공개 자료입니다.'}>
          <Select id="sub-rights" value={form.rights_class} onChange={(e) => set('rights_class', e.target.value)}>
            {RIGHTS_OPTIONS.map((r) => <option key={r} value={r}>{labelOr(L.RIGHTS, r)}</option>)}
          </Select>
        </Field>
        <Field id="sub-sens" label="민감도" required error={fe.sensitivity} hint="이 서비스는 공개 자료만 받습니다. 분류는 넣는 사람의 책임입니다.">
          <Select id="sub-sens" value={form.sensitivity} onChange={(e) => set('sensitivity', e.target.value)}>
            {Object.entries(SENSITIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field id="sub-body" label="원문" required={!metaOnly} error={fe.body} count={count(metaOnly ? '' : form.body)} max={200000} className="md:col-span-2" hint="입력한 그대로 보존합니다. 넘치면 나누어 등록합니다. 잘라서 저장하지 않습니다.">
          <textarea id="sub-body" className={areaCls} rows={4} spellCheck={false} disabled={metaOnly} value={metaOnly ? '' : form.body} onChange={(e) => set('body', e.target.value)} aria-invalid={!!fe.body}></textarea>
        </Field>
      </div>
      <div className="mt-3 empty:hidden"><ActionState a={a} fields={['title', 'recorded_at', 'source_url', 'transcript_locator', 'rights_class', 'sensitivity', 'body']} /></div>
      <Btn kind="primary" type="submit" className="mt-3" busy={a.busy}>원문 등록</Btn>
    </form>
  );
}

function Submissions({ subs, picked, onToggle }) {
  if (!subs.length) return <Empty>이 기획에 등록한 원문이 아직 없습니다.</Empty>;
  return (
    <div className="grid gap-2">
      {subs.map((s, i) => (
        <Choice key={s.id} id={`pick-sub-${i}`} compact checked={picked.includes(s.id)} onChange={() => onToggle(s.id)}>
          <span className="flex flex-wrap items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-g900">{s.title}</span>
              <span className="block break-all text-xs text-g500">{s.source_url || s.transcript_locator}</span>
              <span className="mt-0.5 block text-xs text-g500">기록 {whenShort(s.recorded_at)} · 받은 시각 {whenShort(s.received_at)} · {labelOr(L.RIGHTS, s.rights_class)} · {s.access_mode === 'FULL_TEXT' ? '전문 보관' : '제목과 출처만 보관'}</span>
            </span>
            <Status kind="submission" code={s.status} />
          </span>
        </Choice>
      ))}
      <p className="text-xs text-g500">등록한 원문의 본문은 이 목록에 싣지 않습니다. 근거로 반영된 뒤 원문 확인에서 고정된 구간과 함께 봅니다. 위에서 고른 원문을 아래 취재 결과에 넣습니다.</p>
    </div>
  );
}

// ---------------------------------------------------------------- ② 취재 결과
function ResultForm({ f, task, picked, questions }) {
  const a = useAction();
  const [note, setNote] = useState('');
  const [qids, setQids] = useState([]);
  const fe = fieldErrors(a.error);
  const toggle = (id) => setQids((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const fill = () => {
    setNote(DEMO.result_note);
    setQids(questions.filter((q) => ['U1', 'U1a', 'U1b'].includes(q.question_key)).map((q) => q.id));
  };
  const submit = () => a.run('createReportingResult', {
    params: { case_id: f.c.id }, body: { task_id: task.id, submission_ids: picked, note, question_ids: qids },
    onOk: () => { setNote(''); setQids([]); },
  });
  return (
    <form className="rounded-xl border border-g200 p-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <div className="flex flex-wrap items-center gap-2">
        <p className={cx('text-sm', fe.submission_ids ? 'text-negative-ink' : 'text-g700')}>결과에 넣을 원문 <b className="num text-g900">{picked.length}</b>건 <span className="text-xs text-g400">위에서 고릅니다 · 1건에서 20건</span></p>
        {f.demo ? <LinkBtn className="ml-auto text-xs" onClick={fill}><Sparkles className="size-3.5 text-example" aria-hidden="true" />예시 메모와 질문</LinkBtn> : null}
      </div>
      {fe.submission_ids ? <p className="mt-1 text-xs text-negative-ink" role="alert">{fe.submission_ids}</p> : null}
      <fieldset className="mt-3">
        <legend className="text-sm text-g600">이 자료로 답하려는 질문 <span className="text-[11px] font-semibold text-brand">필수</span></legend>
        {questions.length === 0 ? <p className="mt-2 text-sm text-g500">과제의 원본에 질문이 없습니다.</p> : (
          <div className="mt-2 grid gap-2">
            {questions.map((q, i) => (
              <Choice key={q.id} id={`res-q-${i}`} compact className={q.parent_id ? 'ml-5' : ''} checked={qids.includes(q.id)} onChange={() => toggle(q.id)}>
                <span className="text-sm text-g800"><b className="num">{q.question_key}</b> {q.question}</span>
              </Choice>
            ))}
          </div>
        )}
        {fe.question_ids ? <p className="mt-1.5 text-xs text-negative-ink" role="alert">{fe.question_ids}</p> : null}
      </fieldset>
      <Field id="res-note" label="취재 메모" error={fe.note} count={count(note)} max={5000} className="mt-3" hint="메모는 사용자 메모로만 남습니다. 근거 진술이나 원문 구간으로 바뀌지 않습니다.">
        <textarea id="res-note" rows={2} className={areaCls} value={note} onChange={(e) => setNote(e.target.value)}></textarea>
      </Field>
      <div className="mt-3 empty:hidden"><ActionState a={a} fields={['submission_ids', 'question_ids', 'note']} /></div>
      <Btn kind="primary" type="submit" className="mt-3" busy={a.busy} disabled={task.status === 'CANCELLED'}>취재 결과 저장</Btn>
    </form>
  );
}

function Results({ results, questions, subTitle }) {
  if (!results.length) return <Empty>이 과제에 저장한 취재 결과가 아직 없습니다.</Empty>;
  const qk = Object.fromEntries(questions.map((q) => [q.id, q.question_key]));
  return (
    <ul className="space-y-2">
      {results.map((r) => (
        <li key={r.id} className="rounded-xl border border-g100 p-3.5 text-sm">
          <p className="font-semibold text-g900">취재 결과 · {whenShort(r.received_at)}</p>
          <p className="mt-1 text-g700">원문: {r.submission_ids.map(subTitle).join(', ')}</p>
          <p className="mt-0.5 text-g600">답하려는 질문: {r.question_ids.map((id) => qk[id] || '원본의 질문').join(', ')}</p>
          <p className="mt-0.5 text-g600">메모: {r.note || '없음'}</p>
          <More className="mt-1.5"><KV rows={[['취재 결과', <IdLine key="r" v={r.id} />], ['메모 종류', <Code key="k">{r.note_kind}</Code>]]} /></More>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- ③ 재검토
function Reassess({ f, task, results, subs }) {
  const a = useAction();
  const asOf = useClockField();
  const [partial, setPartial] = useState(false);
  const [off, setOff] = useState([]);                // results left out
  const [baseline, setBaseline] = useState(null);
  const [mode, setMode] = useState(null);
  const [sent, setSent] = useState(false);
  const sentAt = useRef(null);
  const fe = fieldErrors(a.error);
  const head = f.head;
  const isDraft = !!task.review_id;
  // material received after the chosen time cannot be part of this view; a
  // time that follows the clock is "now" at the moment of sending
  const asOfMs = asOf.following ? serverNow() + 60000 : Date.parse(asOf.iso);
  const lateAt = (r) => {
    const times = r.submission_ids.map((id) => subs.find((s) => s.id === id)).filter(Boolean).map((s) => s.received_at);
    const last = times.sort().pop();
    return last && !Number.isNaN(asOfMs) && Date.parse(last) > asOfMs ? last : null;
  };
  const use = results.filter((r) => !off.includes(r.id) && !lateAt(r)).map((r) => r.id);
  const reviews = f.reviews.filter(isDone);
  const base = baseline || (isDraft ? (head.review_id || task.review_id) : (head.pack_id || task.reality_pack_id));
  const knownMode = f.led ? f.led.modes[head.state_version_id || task.state_version_id] : null;
  const useMode = mode || (knownMode && knownMode !== 'DRAFT_REVIEW' ? knownMode : 'SOURCE_REVIEW');
  const submit = () => {
    setSent(false);
    // one as_of per intent, so a retry after a lost answer is the same request
    const sig = JSON.stringify([base, use, partial, useMode]);
    if (!sentAt.current || sentAt.current.sig !== sig || !asOf.following) {
      let at0 = asOf.fresh();
      if (asOf.following) {
        // never earlier than the baseline or the newest source the results carry
        const received = results.filter((r) => use.includes(r.id)).flatMap((r) => r.submission_ids)
          .map((id) => subs.find((x) => x.id === id)).filter(Boolean).map((x) => x.received_at);
        const baseAt = isDraft
          ? (f.reviews.find((d) => d.id === base) || {}).as_of
          : laterIso(...[...f.briefs.filter((d) => d.reality_pack_id === base), ...f.executions.filter((d) => d.result_pack_id === base)].map((d) => d.as_of), at0);
        at0 = laterIso(at0, baseAt, ...received);
      }
      sentAt.current = { sig, at: at0 };
    }
    const at = sentAt.current.at;
    const done = () => { setSent(true); sentAt.current = null; };
    if (isDraft) {
      return a.run('createReassessment', { params: { case_id: f.c.id }, body: { baseline_review_id: base, reporting_result_ids: use, as_of: at, allow_partial: partial }, onOk: done });
    }
    return a.run('createRealityExecution', { params: { case_id: f.c.id }, body: {
      mode: useMode, state_version_id: head.state_version_id || task.state_version_id, content_version_id: null, baseline_pack_id: base,
      submission_ids: [], reporting_result_ids: use, as_of: at, allow_partial: partial, parameters: { query_budget: 10, source_budget: 20, language: 'ko' },
    }, onOk: done });
  };
  return (
    <form className="rounded-xl border border-brand/30 bg-brand/5 p-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <p className="text-sm text-g600">
        {isDraft
          ? '기준이 되는 검토와 넣을 취재 결과, 새 기준 시각을 고정해서 보냅니다. 접수한 뒤에 등록되는 자료는 이번 재검토에 들어가지 않습니다. 이전 검토는 그대로 남습니다.'
          : '초안이 없는 검토는 기준 근거 묶음과 취재 결과로 근거를 다시 모은 뒤, 그 묶음으로 새 기획 요약을 만듭니다.'}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {isDraft ? (
          <Field id="re-base" label="기준 검토" required error={fe.baseline_review_id} hint={base !== head.review_id ? '활성 결과가 아닌 검토를 기준으로 하면 새 결과는 별도 가지로 보존됩니다.' : '지금 활성 결과입니다.'}>
            <Select id="re-base" value={base} onChange={(e) => setBaseline(e.target.value)}>
              {reviews.map((d) => <option key={d.id} value={d.id}>초안 검토 · 기준 {whenShort(d.as_of)}{d.id === head.review_id ? ' · 활성' : ''}</option>)}
              {!reviews.some((d) => d.id === base) ? <option value={base}>과제의 원본 검토</option> : null}
            </Select>
          </Field>
        ) : (
          <Field id="re-mode" label="입력 모드" required error={fe.mode} hint={knownMode ? '이 기획을 저장할 때 고른 모드입니다.' : '서버가 저장 당시의 모드를 돌려주지 않아 다시 고릅니다.'}>
            <Select id="re-mode" value={useMode} onChange={(e) => setMode(e.target.value)}>
              <option value="SOURCE_REVIEW">{L.MODE.SOURCE_REVIEW}</option>
              <option value="QUESTION_ONLY">{L.MODE.QUESTION_ONLY}</option>
            </Select>
          </Field>
        )}
        <TimeField id="re-asof" label="새 기준 시각" required field={asOf} error={fe.as_of} hint="넣을 자료를 받은 뒤의 시각이어야 합니다." />
      </div>
      <fieldset className="mt-3">
        <legend className="text-sm text-g600">넣을 취재 결과 <span className="text-[11px] font-semibold text-brand">필수</span></legend>
        {results.length === 0 ? <p className="mt-2 text-sm text-g500">먼저 취재 결과를 저장하세요.</p> : (
          <div className="mt-2 grid gap-2">
            {results.map((r, i) => {
              const late = lateAt(r);
              return (
                <Choice key={r.id} id={`re-res-${i}`} compact disabled={!!late} checked={!late && !off.includes(r.id)} onChange={() => setOff((x) => (x.includes(r.id) ? x.filter((y) => y !== r.id) : [...x, r.id]))}>
                  <span className="text-sm text-g800">취재 결과 · 받은 시각 {whenShort(r.received_at)} · 원문 {r.submission_ids.length}건
                    {late ? <span className="block text-xs text-negative-ink">뺌: 원문을 받은 시각({whenShort(late)})이 새 기준 시각보다 늦습니다</span> : null}</span>
                </Choice>
              );
            })}
          </div>
        )}
        {fe.reporting_result_ids ? <p className="mt-1.5 text-xs text-negative-ink" role="alert">{fe.reporting_result_ids}</p> : null}
      </fieldset>
      <div className="mt-3"><Check2 id="re-partial" checked={partial} onChange={(e) => setPartial(e.target.checked)}>일부 자료 수집이 실패해도 부분 결과를 받겠습니다</Check2></div>
      <div className="mt-3 empty:hidden"><ActionState a={a} fields={['as_of', 'reporting_result_ids', 'baseline_review_id', 'mode']} /></div>
      {sent ? <Notice tone="ok" role="status" className="mt-3">접수했습니다. 끝나면 알려 드리고, 결과는 이 단계 위쪽 비교에 나타납니다.</Notice> : null}
      <Btn kind="primary" size="block" type="submit" icon={RefreshCw} className="mt-4" busy={a.busy} disabled={!use.length}>{isDraft ? '이 자료로 재검토 제출' : '이 자료로 근거 다시 모으기'}</Btn>
    </form>
  );
}

function Workflow({ f }) {
  const route = useStore(app, (s) => s.route);
  const list = f.tasks;
  const taskId = route.taskId && list.some((t) => t.id === route.taskId) ? route.taskId : (list.find((t) => t.status === 'OPEN') || list[0] || {}).id;
  const task = list.find((t) => t.id === taskId) || null;
  const subIds = f.led ? f.led.submission : [];
  const resIds = f.led ? f.led.result : [];
  const subs = useMany('getEvidenceSubmission', { case_id: f.c.id }, 'submission_id', subIds).filter(Boolean);
  const allResults = useMany('getReportingResult', { case_id: f.c.id }, 'result_id', resIds).filter(Boolean);
  const [picked, setPicked] = useState([]);
  const originId = task ? (task.review_id || task.brief_id) : null;
  const origin = originId && f.jobs[originId] ? f.jobs[originId].data : null;
  const questions = origin && origin.questions ? origin.questions : [];
  const results = task ? allResults.filter((r) => r.task_id === task.id) : [];
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const subTitle = (id) => { const s = subs.find((x) => x.id === id); return s ? s.title : '원문'; };
  if (!task) {
    return <Empty action={<Btn size="sm" onClick={() => go({ to: 'sec-tasks' })}>취재 과제로</Btn>}>취재 결과는 과제에 연결해 저장합니다. 과제를 먼저 만드세요.</Empty>;
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-g50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-g500">이 결과를 붙일 과제</p>
          {list.length > 1 ? (
            <Select small label="과제" value={taskId} onChange={(e) => { go({ taskId: e.target.value }); setPicked([]); }} className="mt-1 max-w-[420px]">
              {list.map((t) => <option key={t.id} value={t.id}>{t.title} · {labelOr(L.TASK_STATUS, t.status)}</option>)}
            </Select>
          ) : <p className="mt-0.5 text-sm font-semibold text-g900">{task.title}</p>}
        </div>
        <Status kind="task" code={task.status} />
      </div>
      {task.status === 'CANCELLED' ? <Notice tone="warn">취소된 과제에는 결과를 등록할 수 없습니다.</Notice> : null}
      {!f.write ? <Notice tone="mute">열람 권한에서는 자료 등록과 저장을 할 수 없습니다.</Notice> : null}
      <ol>
        <Step n={1} title="확보한 원문 등록" done={subs.length > 0}>
          {f.write ? <SubmissionForm f={f} onDone={(s) => setPicked((x) => (x.includes(s.id) ? x : [...x, s.id]))} /> : null}
          <Submissions subs={subs} picked={picked} onToggle={toggle} />
        </Step>
        <Step n={2} title="과제의 취재 결과로 묶기" done={results.length > 0}>
          {f.write ? <ResultForm f={f} task={task} picked={picked} questions={questions} /> : null}
          <Results results={results} questions={questions} subTitle={subTitle} />
        </Step>
        <Step n={3} title={task.review_id ? '재검토 제출' : '근거 다시 모으기'} last>
          {f.write ? <Reassess key={task.id} f={f} task={task} results={results} subs={subs} /> : <p className="text-sm text-g500">열람 권한에서는 제출할 수 없습니다.</p>}
        </Step>
      </ol>
    </div>
  );
}

export function ReassessSection() {
  const f = useCase();
  const route = useStore(app, (s) => s.route);
  const [deltaId, setDeltaId] = useState(null);
  const hasCompare = f.deltas.length > 0 || (f.draftless && f.briefs.length >= 2);
  const [openFlow, setOpenFlow] = useState(null);
  const flowOpen = openFlow === null ? !hasCompare : openFlow;
  // a step that brings the person here to work (the stepper, '취재 결과 등록') opens the workflow
  useEffect(() => { if (route.to && route.to.id === 'sec-reassess') setOpenFlow(true); }, [route.to && route.to.seq]);
  const live = f.reassessments.filter((d) => d.status === 'QUEUED' || d.status === 'RUNNING');
  const last = f.reassessments[f.reassessments.length - 1] || null;
  const corr = (d) => (f.led ? f.led.corr[d.id] : null);
  const noTask = f.tasks.length === 0;
  return (
    <Section id="sec-reassess" n={5} title="재검토"
      desc="확보한 자료를 과제의 취재 결과로 묶고, 그 자료로 다시 검토합니다. 이전 결과는 지워지지 않습니다.">
      {live.map((d) => <JobProgress key={d.id} kind="reassessment" d={d} title="새 자료로 다시 검토하는 중입니다" corr={corr(d)} />)}
      {last && (last.status === 'FAILED' || last.status === 'BLOCKED') ? <JobFailed kind="reassessment" d={last} corr={corr(last)}><p>이전 검토는 그대로입니다. 넣은 자료와 기준 시각을 확인하고 다시 제출하세요.</p></JobFailed> : null}
      {last && isDone(last) && last.head_updated === false ? <BranchNote /> : null}
      {hasCompare ? <CompareBlock f={f} deltaId={route.deltaId || deltaId} onPick={(id) => { setDeltaId(id); go({ deltaId: id }); }} /> : null}
      {noTask ? (
        <div className="rounded-2xl border border-dashed border-g300 bg-white/60 px-5 py-4 text-sm text-g500">취재 과제를 만들면, 확보한 자료로 다시 검토하고 무엇이 바뀌었는지 비교할 수 있습니다.</div>
      ) : (
        <Card title="새 자료로 다시 검토" icon={RefreshCw}
          sub={hasCompare ? '자료를 더 확보했다면 다시 등록하고 재검토할 수 있습니다.' : '① 원문 등록 → ② 취재 결과로 묶기 → ③ 재검토 제출'}
          right={hasCompare ? <LinkBtn tone="gray" onClick={() => setOpenFlow(!flowOpen)} aria-expanded={flowOpen}>{flowOpen ? '접기' : '펼치기'}</LinkBtn> : null}>
          {flowOpen ? <Workflow f={f} /> : <p className="text-sm text-g500">과제 {f.tasks.length}건 · 등록한 원문 {f.led ? f.led.submission.length : 0}건 · 취재 결과 {f.led ? f.led.result.length : 0}건</p>}
        </Card>
      )}
      {f.anyResult ? <SearchCard f={f} /> : null}
      <AlertsCard f={f} />
    </Section>
  );
}
