// 4단계 취재 과제: 검토 결과에서 고른 문장·상충·공백을 과제로 넘기고, 끝냈는지 기록합니다.
import { useState } from 'react';
import { Plus, Trash2, Wand2, ChevronDown, ArrowRight, Sparkles, UserRound, ClipboardList } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, go } from '../app/store.js';
import { useQuery, useAction, fieldErrors } from '../app/api.js';
import DEMO from '../app/demo.js';
import { Status } from '../ui/status.jsx';
import { Section, Btn, LinkBtn, Field, Select, Choice, Notice, More, KV, IdLine, Code, Empty, QueryState, ActionState, Tag, inputCls, areaCls, cx, labelOr } from '../ui/kit.jsx';
import { when, whenShort, count } from '../app/time.js';
import { useCase, defaultView } from './facts.js';

function useOrigin(caseId, origin) {
  const review = useQuery('getDraftReview', { case_id: caseId, review_id: origin && origin.kind === 'review' ? origin.id : '' }, !!origin && origin.kind === 'review');
  const brief = useQuery('getEditorialBrief', { case_id: caseId, brief_id: origin && origin.kind === 'brief' ? origin.id : '' }, !!origin && origin.kind === 'brief');
  const view = origin ? (origin.kind === 'review' ? review.data : brief.data) : null;
  const board = useQuery('getRealityBoard', { case_id: caseId, pack_id: view ? view.reality_pack_id : '' }, !!view);
  return { view, board: board.data, q: origin && origin.kind === 'review' ? review : brief };
}

function memberName(members, id) {
  if (!id) return '담당자 없음';
  const m = (members || []).find((x) => x.actor_id === id);
  return m ? m.name : '다른 구성원';
}
const originText = (t, f) => {
  const isHead = t.review_id ? f.head.review_id === t.review_id : f.head.pack_id === t.reality_pack_id;
  return `${t.review_id ? '초안 검토' : '기획 요약'}${isHead ? ' (활성 결과)' : ' (이전 결과)'}`;
};

// ---------------------------------------------------------------- create
function TaskCreate({ f, origin, members }) {
  const draft = useStore(app, (s) => s.taskDraft);
  const { view, board, q } = useOrigin(f.c.id, origin);
  const a = useAction();
  const mine = draft.origin && origin && draft.origin.id === origin.id ? draft : { assertion_ids: [], conflict_ids: [], unknown_ids: [] };
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState(['']);
  const [refs, setRefs] = useState({ assertion_ids: mine.assertion_ids, conflict_ids: mine.conflict_ids, unknown_ids: mine.unknown_ids });
  const [assignee, setAssignee] = useState('');
  const fe = fieldErrors(a.error);
  if (!origin) return <Notice tone="mute">과제의 원본으로 삼을 끝난 검토나 기획 요약이 없습니다.</Notice>;
  if (!view) return <QueryState q={q} what="원본 검토" />;
  const isReview = origin.kind === 'review';
  const items = isReview ? view.items : [];
  const conflicts = board ? [...board.what_is_disputed.map((x) => ({ ...x, open: true })), ...board.resolved_conflicts.map((x) => ({ ...x, open: false }))] : [];
  const unknowns = board ? board.what_remains_unknown : [];
  const toggle = (kind, id) => setRefs((r) => ({ ...r, [kind]: r[kind].includes(id) ? r[kind].filter((x) => x !== id) : [...r[kind], id] }));
  const setQ = (i, v) => setQuestions((qs) => qs.map((x, j) => (j === i ? v : x)));
  const picked = refs.assertion_ids.length + refs.conflict_ids.length + refs.unknown_ids.length;
  const body = {
    review_id: isReview ? origin.id : null, brief_id: isReview ? null : origin.id, title, questions,
    assertion_ids: refs.assertion_ids, conflict_ids: refs.conflict_ids, unknown_ids: refs.unknown_ids, assignee_id: assignee || null,
  };
  const fill = () => {
    setTitle(DEMO.task_default.title);
    setQuestions([...DEMO.task_default.questions]);
    setRefs({
      assertion_ids: items.filter((it) => it.status !== 'SUPPORTED').map((it) => it.assertion_id),
      conflict_ids: conflicts.map((x) => x.conflict_id),
      unknown_ids: unknowns.map((u) => u.unknown_id),
    });
  };
  // questions drafted from what was picked: needed evidence, open conflicts and gaps
  const suggest = () => {
    const out = [];
    const add = (x) => { const t = String(x || '').trim(); if (t && !out.includes(t) && out.length < 20) out.push(t.slice(0, 500)); };
    items.filter((it) => refs.assertion_ids.includes(it.assertion_id)).forEach((it) => it.needed_evidence.forEach((n) => add(`${n} 확보`)));
    conflicts.filter((x) => refs.conflict_ids.includes(x.conflict_id)).forEach((x) => add(`${x.question} — 출처 간 차이의 이유 확인`));
    unknowns.filter((u) => refs.unknown_ids.includes(u.unknown_id)).forEach((u) => add(u.question));
    if (out.length) setQuestions(out);
    if (!title.trim() && out.length) setTitle(out[0].slice(0, 60));
  };
  const submit = () => a.run('createReportingTask', {
    params: { case_id: f.c.id }, body,
    onOk: (res) => {
      app.set({ taskDraft: { assertion_ids: [], conflict_ids: [], unknown_ids: [] } });
      go({ creatingTask: false, taskId: res.data.task.id, taskJustMade: res.data.task.id });
    },
  });
  return (
    <form className="rounded-2xl border border-brand/30 bg-white p-5 shadow-sm sm:p-6" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold text-g900">새 취재 과제</h3>
        <span className="text-xs text-g500">원본 · {isReview ? '초안 검토' : '기획 요약'} · 기준 {when(view.as_of)}</span>
        {f.demo ? <LinkBtn className="ml-auto text-xs" onClick={fill}><Sparkles className="size-3.5 text-example" aria-hidden="true" />예시 과제 채우기</LinkBtn> : null}
      </div>
      <p className="mt-1 text-xs text-g500">과제는 이 원본에 고정됩니다. 질문과 참조는 이 원본에 들어 있는 것만 고를 수 있습니다.</p>

      <fieldset className="mt-5">
        <legend className="text-sm text-g600">이 과제가 가리키는 것 <span className="text-[11px] font-semibold text-brand">필수</span> <span className="text-xs text-g400">하나 이상 · {picked}개 고름</span></legend>
        {isReview ? (
          <div className="mt-2">
            <p className="mb-1.5 text-xs font-semibold text-g500">초안 문장</p>
            <div className="grid gap-2">
              {items.map((it, i) => (
                <Choice key={it.assertion_id} compact id={`ref-a-${i}`} checked={refs.assertion_ids.includes(it.assertion_id)} onChange={() => toggle('assertion_ids', it.assertion_id)}>
                  <span className="flex flex-wrap items-start gap-2 text-sm text-g800"><b className="num">A{i + 1}</b><span className="min-w-0 flex-1">{it.text}</span><Status kind="review" code={it.status} /></span>
                </Choice>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-g500">서로 다른 것</p>
            {conflicts.length === 0 ? <Empty /> : <div className="grid gap-2">{conflicts.map((x, i) => (
              <Choice key={x.conflict_id} compact id={`ref-c-${i}`} checked={refs.conflict_ids.includes(x.conflict_id)} onChange={() => toggle('conflict_ids', x.conflict_id)}>
                <span className="text-sm text-g800"><b className="num">{x.key}</b> {x.question}{x.open ? '' : ' (정정으로 정리됨)'}</span>
              </Choice>
            ))}</div>}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-g500">아직 모르는 것</p>
            {unknowns.length === 0 ? <Empty /> : <div className="grid gap-2">{unknowns.map((u, i) => (
              <Choice key={u.unknown_id} compact id={`ref-u-${i}`} checked={refs.unknown_ids.includes(u.unknown_id)} onChange={() => toggle('unknown_ids', u.unknown_id)}>
                <span className="text-sm text-g800"><b className="num">{u.key}</b> {u.question}</span>
              </Choice>
            ))}</div>}
          </div>
        </div>
        {fe.assertion_ids || fe.conflict_ids || fe.unknown_ids ? <p className="mt-2 text-xs text-negative-ink" role="alert">{fe.assertion_ids || fe.conflict_ids || fe.unknown_ids}</p> : null}
      </fieldset>

      <div className="mt-5 grid gap-4">
        <Field id="task-title" label="과제 제목" required error={fe.title} count={count(title)} max={300}>
          <input id="task-title" type="text" className={inputCls} placeholder="예: 계약 예외와 같은 범위 비용 확인" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!fe.title} />
        </Field>
        <fieldset>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <legend className="text-sm text-g600">취재 질문 <span className="text-[11px] font-semibold text-brand">필수</span> <span className="text-xs text-g400">1개에서 20개</span></legend>
            <LinkBtn className="ml-auto text-xs" disabled={!picked} onClick={suggest}><Wand2 className="size-3.5" aria-hidden="true" />고른 항목으로 질문 채우기</LinkBtn>
          </div>
          <div className="space-y-2">
            {questions.map((qq, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="num grid size-7 shrink-0 place-items-center rounded-lg bg-g100 text-xs font-bold text-g600" aria-hidden="true">{i + 1}</span>
                <label htmlFor={`task-q-${i}`} className="sr-only">취재 질문 {i + 1}</label>
                <input id={`task-q-${i}`} type="text" className={inputCls} value={qq} onChange={(e) => setQ(i, e.target.value)} />
                <button type="button" className="shrink-0 rounded-lg p-2 text-g400 hover:bg-g100 hover:text-g600 disabled:opacity-30" disabled={questions.length === 1} onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label={`질문 ${i + 1} 빼기`}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          {fe.questions ? <p className="mt-1.5 text-xs text-negative-ink" role="alert">{fe.questions}</p> : null}
          <Btn size="sm" icon={Plus} className="mt-2" disabled={questions.length >= 20} onClick={() => setQuestions((qs) => [...qs, ''])}>질문 추가</Btn>
        </fieldset>
        <Field id="task-assignee" label="담당자" error={fe.assignee_id} hint="같은 공간의 구성원만 지정할 수 있습니다. 기본 담당자나 기한은 넣지 않습니다.">
          <Select id="task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">담당자 없음</option>
            {(members || []).map((m) => <option key={m.actor_id} value={m.actor_id}>{m.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-4 empty:hidden"><ActionState a={a} fields={['title', 'questions', 'assertion_ids', 'conflict_ids', 'unknown_ids', 'assignee_id']} /></div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Btn kind="primary" size="lg" type="submit" busy={a.busy}>과제 저장</Btn>
        <Btn size="lg" kind="ghost" onClick={() => go({ creatingTask: false })}>그만두기</Btn>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- one task
function TaskDetail({ f, taskId, members, justMade }) {
  const q = useQuery('getReportingTask', { case_id: f.c.id, task_id: taskId });
  const t = q.data;
  const origin = t ? (t.review_id ? { kind: 'review', id: t.review_id } : { kind: 'brief', id: t.brief_id }) : null;
  const { view } = useOrigin(f.c.id, origin);
  const a = useAction();
  const [status, setStatus] = useState('DONE');
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState(null);
  if (!t) return <div className="px-5 pb-5"><QueryState q={q} what="과제" /></div>;
  const etag = q.headers.ETag;
  const fe = fieldErrors(a.error);
  const qs = view ? Object.fromEntries(view.questions.map((x) => [x.id, x])) : {};
  const qaOrigin = view ? Object.fromEntries(view.question_assessments.map((x) => [x.question_id, x])) : {};
  const headView = f.headReview || f.headBrief;
  const qaNow = headView && headView.question_assessments ? Object.fromEntries(headView.question_assessments.map((x) => [x.question_id, x])) : null;
  const refIds = [...t.conflict_ids, ...t.unknown_ids];
  const kids = Object.values(qs).filter((x) => refIds.includes(x.parent_id)).map((x) => x.id);
  const shownQs = [...refIds, ...kids].filter((id) => qs[id]);
  const items = view && view.items ? view.items : [];
  const submit = async () => {
    const sent = { status, etag };
    const res = await a.run('updateReportingTask', { params: { case_id: f.c.id, task_id: t.id }, body: { status, reason }, ifMatch: etag });
    if (res && !res.ok && res.error.code === 'TASK_VERSION_CONFLICT') { setConflict(sent); q.refetch(); }
    if (res && res.ok) { setConflict(null); setReason(''); }
  };
  return (
    <div className="space-y-4 border-t border-g100 px-5 pb-5 pt-4">
      {justMade ? <Notice tone="ok" role="status">저장한 과제를 서버에서 다시 읽어 확인했습니다.</Notice> : null}
      {q.net ? <QueryState q={q} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-g500">취재 질문</p>
          <ol className="space-y-1.5">{t.questions.map((x, i) => <li key={i} className="flex gap-2 text-sm text-g800"><span className="num shrink-0 font-bold text-g400">{i + 1}</span>{x}</li>)}</ol>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-g500">가리키는 것</p>
          <ul className="space-y-1.5 text-sm text-g800">
            {t.assertion_ids.map((id) => {
              const i = items.findIndex((it) => it.assertion_id === id);
              return <li key={id}><Tag tone="line">문장</Tag> {i >= 0 ? <><b className="num">A{i + 1}</b> {items[i].text}</> : '원본의 문장'}</li>;
            })}
            {t.conflict_ids.map((id) => <li key={id}><Tag tone="warn">상충</Tag> {qs[id] ? `${qs[id].question_key} ${qs[id].question}` : '원본의 상충'}</li>)}
            {t.unknown_ids.map((id) => <li key={id}><Tag>공백</Tag> {qs[id] ? `${qs[id].question_key} ${qs[id].question}` : '원본의 공백'}</li>)}
          </ul>
        </div>
      </div>
      {shownQs.length ? (
        <div className="rounded-xl border border-g100">
          <p className="border-b border-g100 px-4 py-2 text-xs font-semibold text-g500">질문은 풀렸는가 · 과제를 끝낸 기록과 따로, 새 자료로 다시 검토한 결과에서만 바뀝니다</p>
          <ul className="divide-y divide-g100">
            {shownQs.map((id) => (
              <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 text-g800"><b className="num">{qs[id].question_key}</b> {qs[id].question}</span>
                <span className="flex items-center gap-1.5 text-xs text-g500">만든 때 {qaOrigin[id] ? <Status kind="question" code={qaOrigin[id].status} /> : '평가 없음'}</span>
                <ArrowRight className="size-3.5 text-g300" aria-hidden="true" />
                <span className="flex items-center gap-1.5 text-xs text-g500">지금 {qaNow && qaNow[id] ? <Status kind="question" code={qaNow[id].status} /> : '활성 결과 없음'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {conflict ? (
        <Notice tone="warn" role="alert" title="다른 사람이 먼저 이 과제를 바꿨습니다">
          <p>내가 보낸 변경은 '{labelOr(L.TASK_STATUS, conflict.status)}'였고, 방금 다시 읽은 상태는 '{labelOr(L.TASK_STATUS, t.status)}'입니다. 자동으로 덮어쓰지 않았습니다. 끝난 과제는 다시 열 수 없습니다.</p>
          <More><KV rows={[['응답', <Code key="c">409 TASK_VERSION_CONFLICT</Code>], ['보던 버전', <Code key="a">{conflict.etag}</Code>], ['지금 버전', <Code key="b">{etag}</Code>]]} /></More>
        </Notice>
      ) : null}
      {!conflict ? <div className="empty:hidden"><ActionState a={a} fields={['reason', 'status']} /></div> : null}
      {t.status === 'OPEN' && f.write ? (
        <form className="rounded-xl border border-g200 bg-g50 p-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-g900">과제 닫기</p>
            {f.demo ? <LinkBtn className="ml-auto text-xs" onClick={() => { setStatus('DONE'); setReason(DEMO.task_done_reason); }}><Sparkles className="size-3.5 text-example" aria-hidden="true" />예시 사유</LinkBtn> : null}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="기록할 상태">
            <Choice type="radio" name={`task-status-${t.id}`} id="task-status-done" compact checked={status === 'DONE'} onChange={() => setStatus('DONE')} title="완료" desc="취재를 마쳤습니다. 결과는 계속 등록할 수 있습니다." />
            <Choice type="radio" name={`task-status-${t.id}`} id="task-status-cancel" compact checked={status === 'CANCELLED'} onChange={() => setStatus('CANCELLED')} title="취소" desc="이 과제는 더 하지 않습니다. 결과를 붙일 수 없습니다." />
          </div>
          <Field id="task-reason" label="사유" required error={fe.reason} count={count(reason)} max={500} className="mt-3" hint="그사이 다른 사람이 과제를 바꿨다면 저장되지 않습니다.">
            <textarea id="task-reason" rows={2} className={areaCls} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!fe.reason}></textarea>
          </Field>
          <Btn kind="primary" type="submit" className="mt-3" busy={a.busy}>상태 기록</Btn>
        </form>
      ) : null}
      {t.status !== 'OPEN' ? <p className="text-sm text-g500">닫힌 과제입니다. 다시 열 수 없습니다.{t.status === 'DONE' ? ' 보충 자료는 취재 결과로 계속 등록할 수 있습니다.' : ' 취소된 과제에는 결과를 등록할 수 없습니다.'}</p> : null}
      {t.status === 'OPEN' && !f.write ? <p className="text-sm text-g500">열람 권한에서는 과제를 바꿀 수 없습니다.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Btn kind="primary" disabled={t.status === 'CANCELLED'} icon={ArrowRight} onClick={() => go({ to: 'sec-reassess', taskId: t.id })}>취재 결과 등록</Btn>
        <Btn kind="ghost" onClick={() => go({ to: 'sec-review', view: origin, sub: origin.kind === 'review' ? 'sheet' : 'brief' })}>원본 검토 열기</Btn>
        <More className="ml-auto">
          <KV rows={[['과제', <IdLine key="t" v={t.id} />], ['원본', <IdLine key="o" v={t.review_id || t.brief_id} />], ['근거 묶음', <IdLine key="p" v={t.reality_pack_id} />],
            ['질문 상태 버전', <IdLine key="s" v={t.state_version_id} />], ['과제 버전', <Code key="v">{t.row_version}{etag ? ` · ETag ${etag}` : ''}</Code>], ['만든 시각', when(t.created_at)], ['고친 시각', when(t.updated_at)]]} />
        </More>
      </div>
    </div>
  );
}

export function TasksSection() {
  const f = useCase();
  const route = useStore(app, (s) => s.route);
  const members = useQuery('listWorkspaceMembers', {}, f.anyResult);
  const list = f.tasks;
  const selected = route.taskId && list.some((t) => t.id === route.taskId) ? route.taskId : null;
  const origin = route.taskOrigin || defaultView(f.c, f.led);
  const mem = members.data ? members.data.items : [];
  const locked = !f.anyResult ? '검토 결과가 나오면 더 취재할 문장과 질문을 과제로 넘깁니다.' : null;
  return (
    <Section id="sec-tasks" n={4} title="취재 과제" locked={locked}
      desc="더 확인할 질문을 과제로 남기고, 취재를 마쳤는지 기록합니다. 과제를 끝낸 것과 질문이 풀린 것은 따로 봅니다."
      right={f.write && !route.creatingTask ? <Btn icon={Plus} onClick={() => go({ creatingTask: true, taskOrigin: origin })}>새 과제</Btn> : null}>
      <QueryState q={f.tasksQ} what="과제 목록" />
      {route.creatingTask && f.write ? <TaskCreate key={origin ? origin.id : 'none'} f={f} origin={origin} members={mem} /> : null}
      {f.tasksQ.data && list.length === 0 && !route.creatingTask ? (
        <Empty icon={ClipboardList} action={f.write ? <Btn size="sm" kind="primary" onClick={() => go({ creatingTask: true, taskOrigin: origin })}>과제 만들기</Btn> : null}>
          아직 취재 과제가 없습니다. 초안 검토의 문장 카드에서 '과제에 담기'로 고른 뒤 만들 수 있습니다.
        </Empty>
      ) : null}
      {list.length ? (
        <ul className="space-y-3">
          {list.map((t) => {
            const on = selected === t.id;
            return (
              <li key={t.id} className={cx('overflow-hidden rounded-2xl border bg-white shadow-sm', on ? 'border-brand' : 'border-g200')}>
                <button type="button" aria-expanded={on} onClick={() => go({ taskId: on ? null : t.id, creatingTask: false, taskJustMade: null })}
                  className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-g900">{t.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-g500">
                      <span>질문 {t.questions.length}개</span><span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1"><UserRound className="size-3" aria-hidden="true" />{memberName(mem, t.assignee_id)}</span><span aria-hidden="true">·</span>
                      <span>원본 {originText(t, f)}</span><span aria-hidden="true">·</span><span>고친 시각 {whenShort(t.updated_at)}</span>
                    </p>
                  </div>
                  <Status kind="task" code={t.status} />
                  <ChevronDown className={cx('size-4 text-g400 transition-transform', on && 'rotate-180')} aria-hidden="true" />
                </button>
                {on ? <TaskDetail key={t.id} f={f} taskId={t.id} members={mem} justMade={route.taskJustMade === t.id} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}
