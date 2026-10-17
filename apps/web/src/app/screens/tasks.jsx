// UI-05 취재 과제: 목록, 만들기, 완료·취소 기록.
/* global React */
import * as L from '../../labels.js';
import { app, useStore, go } from '../store.js';
import { useQuery, useAction, fieldErrors } from '../api.js';
import DEMO from '../demo.js';
import { St, Id, Pins, Btn, Field, QueryState, Empty, ActionState, DemoFill, useMe, useDemo, canWrite, cx, labelOr } from '../ui.jsx';
import { when, whenShort, short, count } from '../time.js';
import { defaultView } from './review.jsx';

const { useState } = React;

function useOrigin(caseId, origin) {
  const review = useQuery('getDraftReview', { case_id: caseId, review_id: origin && origin.kind === 'review' ? origin.id : '' }, !!origin && origin.kind === 'review');
  const brief = useQuery('getEditorialBrief', { case_id: caseId, brief_id: origin && origin.kind === 'brief' ? origin.id : '' }, !!origin && origin.kind === 'brief');
  const view = origin ? (origin.kind === 'review' ? review.data : brief.data) : null;
  const board = useQuery('getRealityBoard', { case_id: caseId, pack_id: view ? view.reality_pack_id : '' }, !!view);
  return { view, board: board.data, q: origin && origin.kind === 'review' ? review : brief };
}

function memberName(members, id) {
  if (!id) return '없음';
  const m = (members || []).find((x) => x.actor_id === id);
  return m ? m.name : short(id);
}

// ---------------------------------------------------------------- create
function TaskCreate({ c, origin, members }) {
  const draft = useStore(app, (s) => s.taskDraft);
  const { view, board, q } = useOrigin(c.id, origin);
  const a = useAction();
  const mine = draft.origin && origin && draft.origin.id === origin.id ? draft : { assertion_ids: [], conflict_ids: [], unknown_ids: [] };
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState(['']);
  const [refs, setRefs] = useState({ assertion_ids: mine.assertion_ids, conflict_ids: mine.conflict_ids, unknown_ids: mine.unknown_ids });
  const [assignee, setAssignee] = useState('');
  const demoOk = useDemo(c);
  const fe = fieldErrors(a.error);
  if (!origin) return <p className="note tone-info">과제의 원본으로 삼을 끝난 검토나 Brief가 없습니다. 기획 검토 화면에서 결과를 먼저 확인하세요.</p>;
  if (!view) return <QueryState q={q} what="원본 검토" />;
  const isReview = origin.kind === 'review';
  const items = isReview ? view.items : [];
  const conflicts = board ? [...board.what_is_disputed.map((x) => ({ ...x, open: true })), ...board.resolved_conflicts.map((x) => ({ ...x, open: false }))] : [];
  const unknowns = board ? board.what_remains_unknown : [];
  const toggle = (kind, id) => setRefs((r) => ({ ...r, [kind]: r[kind].includes(id) ? r[kind].filter((x) => x !== id) : [...r[kind], id] }));
  const setQ = (i, v) => setQuestions((qs) => qs.map((x, j) => (j === i ? v : x)));
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
    params: { case_id: c.id }, body,
    onOk: (res) => {
      app.set({ taskDraft: { assertion_ids: [], conflict_ids: [], unknown_ids: [] } });
      go({ creatingTask: false, taskId: res.data.task.id, taskJustMade: res.data.task.id });
    },
  });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <div className="form-head">
        <h3>새 취재 과제</h3>
        <DemoFill show={demoOk} items={[{ label: '예시 과제 채우기', run: fill }]} />
      </div>
      <Pins items={[
        { label: '원본', text: isReview ? '초안 검토' : 'Brief', extra: short(origin.id) },
        { label: '기준 시각', text: when(view.as_of) },
        { label: '근거 묶음', id: view.reality_pack_id },
        { label: '초안 버전', text: view.content_version_id ? undefined : '없음', id: view.content_version_id || undefined },
      ]} />
      <p className="foot">과제는 이 원본에 고정됩니다. 질문과 참조는 이 원본에 들어 있는 것만 고를 수 있습니다.</p>
      <Field id="task-title" label="과제 제목" required error={fe.title} count={count(title)} max={300}>
        <input id="task-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!fe.title} />
      </Field>
      <fieldset className={cx('fieldset', fe.questions && 'has-error')}>
        <legend>취재 질문 <span className="req">필수</span> <span className="muted">1개에서 20개</span></legend>
        {questions.map((qq, i) => (
          <div key={i} className="qrow">
            <label htmlFor={`task-q-${i}`} className="sr">취재 질문 {i + 1}</label>
            <span className="qrow-n" aria-hidden="true">{i + 1}</span>
            <input id={`task-q-${i}`} type="text" value={qq} onChange={(e) => setQ(i, e.target.value)} />
            <button type="button" className="link quiet" disabled={questions.length === 1} onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>빼기<span className="sr"> 질문 {i + 1}</span></button>
          </div>
        ))}
        {fe.questions ? <p className="field-error" role="alert">{fe.questions}</p> : null}
        <p>
          <Btn kind="ghost" disabled={questions.length >= 20} onClick={() => setQuestions((qs) => [...qs, ''])}>질문 추가</Btn>{' '}
          <Btn kind="ghost" disabled={!(refs.assertion_ids.length + refs.conflict_ids.length + refs.unknown_ids.length)} onClick={suggest}>아래에서 고른 항목으로 질문 채우기</Btn>
        </p>
      </fieldset>
      <fieldset className={cx('fieldset', (fe.assertion_ids || fe.conflict_ids || fe.unknown_ids) && 'has-error')}>
        <legend>이 과제가 가리키는 것 <span className="req">필수</span> <span className="muted">하나 이상</span></legend>
        {isReview ? (
          <div className="refs">
            <p className="refs-h">초안 문장</p>
            {items.map((it, i) => (
              <label key={it.assertion_id} className="check">
                <input type="checkbox" id={`ref-a-${i}`} checked={refs.assertion_ids.includes(it.assertion_id)} onChange={() => toggle('assertion_ids', it.assertion_id)} />
                <span><b>A{i + 1}</b> {it.text} <St kind="review" code={it.status} small plain /></span>
              </label>
            ))}
          </div>
        ) : <p className="muted">초안 없는 검토의 과제에는 문장 참조를 넣지 않습니다.</p>}
        <div className="refs">
          <p className="refs-h">상충</p>
          {conflicts.length === 0 ? <p className="muted">해당 항목 없음</p> : conflicts.map((x, i) => (
            <label key={x.conflict_id} className="check">
              <input type="checkbox" id={`ref-c-${i}`} checked={refs.conflict_ids.includes(x.conflict_id)} onChange={() => toggle('conflict_ids', x.conflict_id)} />
              <span><b>{x.key}</b> {x.question}{x.open ? '' : ' (정정으로 정리됨)'}</span>
            </label>
          ))}
        </div>
        <div className="refs">
          <p className="refs-h">공백</p>
          {unknowns.length === 0 ? <p className="muted">해당 항목 없음</p> : unknowns.map((u, i) => (
            <label key={u.unknown_id} className="check">
              <input type="checkbox" id={`ref-u-${i}`} checked={refs.unknown_ids.includes(u.unknown_id)} onChange={() => toggle('unknown_ids', u.unknown_id)} />
              <span><b>{u.key}</b> {u.question}</span>
            </label>
          ))}
        </div>
        {fe.assertion_ids || fe.conflict_ids || fe.unknown_ids ? <p className="field-error" role="alert">{fe.assertion_ids || fe.conflict_ids || fe.unknown_ids}</p> : null}
      </fieldset>
      <Field id="task-assignee" label="담당자" error={fe.assignee_id} hint="같은 workspace의 사용자만 지정할 수 있습니다. 기본 담당자나 기한은 넣지 않습니다.">
        <select id="task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">담당자 없음</option>
          {(members || []).map((m) => <option key={m.actor_id} value={m.actor_id}>{m.name}</option>)}
        </select>
      </Field>
      <ActionState a={a} fields={['title', 'questions', 'assertion_ids', 'conflict_ids', 'unknown_ids', 'assignee_id']} />
      <div className="form-foot">
        <Btn kind="primary" type="submit" busy={a.busy}>과제 저장</Btn>
        <Btn kind="ghost" onClick={() => go({ creatingTask: false })}>그만두기</Btn>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- detail
function TaskDetail({ c, taskId, members, justMade }) {
  const me = useMe();
  const jobs = useStore(app, (s) => s.jobs);
  const q = useQuery('getReportingTask', { case_id: c.id, task_id: taskId });
  const t = q.data;
  const origin = t ? (t.review_id ? { kind: 'review', id: t.review_id } : { kind: 'brief', id: t.brief_id }) : null;
  const { view, board } = useOrigin(c.id, origin);
  const a = useAction();
  const [status, setStatus] = useState('DONE');
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState(null);
  const demoOk = useDemo(c);
  if (!t) return <QueryState q={q} what="과제" />;
  const etag = q.headers.ETag;
  const fe = fieldErrors(a.error);
  const write = canWrite(me);
  const qs = view ? Object.fromEntries(view.questions.map((x) => [x.id, x])) : {};
  const qaOrigin = view ? Object.fromEntries(view.question_assessments.map((x) => [x.question_id, x])) : {};
  const headView = c.head && c.head.review_id && jobs[c.head.review_id] ? jobs[c.head.review_id].data : null;
  const qaNow = headView && headView.question_assessments ? Object.fromEntries(headView.question_assessments.map((x) => [x.question_id, x])) : null;
  const refIds = [...t.conflict_ids, ...t.unknown_ids];
  const kids = Object.values(qs).filter((x) => refIds.includes(x.parent_id)).map((x) => x.id);
  const shownQs = [...refIds, ...kids].filter((id) => qs[id]);
  const items = view && view.items ? view.items : [];
  const submit = async () => {
    const sent = { status, etag };
    const res = await a.run('updateReportingTask', { params: { case_id: c.id, task_id: t.id }, body: { status, reason }, ifMatch: etag });
    if (res && !res.ok && res.error.code === 'TASK_VERSION_CONFLICT') { setConflict(sent); q.refetch(); }
    if (res && res.ok) { setConflict(null); setReason(''); }
  };
  return (
    <div className="detail">
      <div className="viewhead-t">
        <h3>{t.title}</h3>
        <St kind="task" code={t.status} />
      </div>
      {justMade ? <p className="note tone-ok" role="status">저장한 과제를 서버에서 다시 읽어 확인했습니다. 원본과 상태가 아래와 같습니다.</p> : null}
      {q.net ? <QueryState q={q} /> : null}
      <Pins items={[
        { label: '원본', text: t.review_id ? '초안 검토' : 'Brief', extra: short(t.review_id || t.brief_id) },
        { label: '근거 묶음', id: t.reality_pack_id },
        { label: '초안 버전', text: t.content_version_id ? undefined : '없음', id: t.content_version_id || undefined },
        { label: '질문 상태 버전', id: t.state_version_id },
        { label: '담당자', text: memberName(members, t.assignee_id) },
        { label: '과제 버전', text: `${t.row_version}`, extra: etag ? `ETag ${etag}` : '' },
        { label: '만든 시각', text: when(t.created_at) },
        { label: '고친 시각', text: when(t.updated_at) },
      ]} />
      <h4>취재 질문</h4>
      <ol className="plain-ol">{t.questions.map((x, i) => <li key={i}>{x}</li>)}</ol>
      <h4>가리키는 것</h4>
      <ul className="plain">
        {t.assertion_ids.map((id) => {
          const i = items.findIndex((it) => it.assertion_id === id);
          return <li key={id}><span className="lbl">초안 문장</span>{i >= 0 ? <><b>A{i + 1}</b> {items[i].text}</> : <Id v={id} />}</li>;
        })}
        {t.conflict_ids.map((id) => <li key={id}><span className="lbl">상충</span>{qs[id] ? `${qs[id].question_key} ${qs[id].question}` : <Id v={id} />}</li>)}
        {t.unknown_ids.map((id) => <li key={id}><span className="lbl">공백</span>{qs[id] ? `${qs[id].question_key} ${qs[id].question}` : <Id v={id} />}</li>)}
      </ul>
      <h4>질문은 풀렸는가</h4>
      <p className="foot">과제를 끝냈다는 기록은 취재 행동의 기록입니다. 질문이 풀렸는지는 새 자료로 다시 검토한 결과에서만 바뀝니다.</p>
      {shownQs.length === 0 ? <Empty /> : (
        <div className="scroll-x">
          <table className="grid">
            <thead><tr><th scope="col">질문</th><th scope="col">과제를 만든 때</th><th scope="col">지금 활성 결과</th></tr></thead>
            <tbody>
              {shownQs.map((id) => (
                <tr key={id}>
                  <td><span className="mono">{qs[id].question_key}</span> {qs[id].question}</td>
                  <td>{qaOrigin[id] ? <St kind="question" code={qaOrigin[id].status} small /> : '평가 없음'}</td>
                  <td>{qaNow && qaNow[id] ? <St kind="question" code={qaNow[id].status} small /> : <span className="muted">활성 검토 없음</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {conflict ? (
        <div className="note tone-warn" role="alert">
          <p className="note-h">다른 사람이 먼저 이 과제를 바꿨습니다 <code>409 TASK_VERSION_CONFLICT</code></p>
          <p>내가 보낸 변경: {labelOr(L.TASK_STATUS, conflict.status)}, 내가 보고 있던 버전 {conflict.etag}. 방금 다시 읽은 상태: {labelOr(L.TASK_STATUS, t.status)}, 버전 {etag}.</p>
          <p>자동으로 덮어쓰지 않았습니다. 끝난 과제는 다시 열 수 없습니다.</p>
        </div>
      ) : null}
      {!conflict ? <ActionState a={a} fields={['reason', 'status']} /> : null}

      {t.status === 'OPEN' && write ? (
        <form className="form form-inline" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <div className="form-head">
            <h4>과제 닫기</h4>
            <DemoFill show={demoOk} items={[{ label: '예시 사유', run: () => { setStatus('DONE'); setReason(DEMO.task_done_reason); } }]} />
          </div>
          <fieldset className="fieldset radios">
            <legend>기록할 상태</legend>
            <label className="check"><input type="radio" name="task-status" id="task-status-done" checked={status === 'DONE'} onChange={() => setStatus('DONE')} /> 완료 <code>DONE</code></label>
            <label className="check"><input type="radio" name="task-status" id="task-status-cancel" checked={status === 'CANCELLED'} onChange={() => setStatus('CANCELLED')} /> 취소 <code>CANCELLED</code></label>
          </fieldset>
          <Field id="task-reason" label="사유" required error={fe.reason} count={count(reason)} max={500} hint={`조회한 버전 ${etag || ''}을 기준으로 보냅니다. 그사이 다른 사람이 바꿨다면 저장되지 않습니다.`}>
            <textarea id="task-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!fe.reason}></textarea>
          </Field>
          <div className="form-foot"><Btn kind="primary" type="submit" busy={a.busy}>상태 기록</Btn></div>
        </form>
      ) : null}
      {t.status !== 'OPEN' ? <p className="muted">닫힌 과제입니다. 다시 열 수 없습니다.{t.status === 'DONE' ? ' 보충 자료는 취재 결과로 계속 등록할 수 있습니다.' : ' 취소된 과제에는 결과를 등록할 수 없습니다.'}</p> : null}
      {t.status === 'OPEN' && !write ? <p className="muted">열람 권한에서는 과제를 바꿀 수 없습니다.</p> : null}
      <div className="form-foot">
        <Btn disabled={t.status === 'CANCELLED'} onClick={() => go({ tab: 'results', taskId: t.id })}>취재 결과 등록</Btn>
        <Btn kind="ghost" onClick={() => go({ tab: 'review', view: origin, sub: origin.kind === 'review' ? 'sheet' : 'brief' })}>원본 검토 열기</Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- screen
export function TasksScreen({ c }) {
  const me = useMe();
  const route = useStore(app, (s) => s.route);
  const led = useStore(app, (s) => s.ledger[c.id]);
  const tasks = useQuery('listReportingTasks', { case_id: c.id });
  const members = useQuery('listWorkspaceMembers', {});
  const list = tasks.data ? tasks.data.items : [];
  const selected = route.taskId && list.some((t) => t.id === route.taskId) ? route.taskId : (list[0] ? list[0].id : null);
  const origin = route.taskOrigin || defaultView(c, led);
  const write = canWrite(me);
  return (
    <div className="screen">
      <div className="screen-top">
        <h2>취재 과제 <span className="count">{list.length}</span></h2>
        {write ? <Btn kind="primary" disabled={route.creatingTask} onClick={() => go({ creatingTask: true, taskOrigin: origin })}>새 과제</Btn> : <span className="muted">열람 권한에서는 과제를 만들 수 없습니다.</span>}
      </div>
      <p className="lede">더 확인할 질문을 과제로 남기고, 취재를 마쳤는지 기록합니다. 과제를 끝낸 것과 질문이 풀린 것은 따로 봅니다.</p>
      <QueryState q={tasks} what="과제 목록" />
      {route.creatingTask && write ? <TaskCreate key={origin ? origin.id : 'none'} c={c} origin={origin} members={members.data ? members.data.items : []} /> : null}
      {tasks.data && list.length === 0 && !route.creatingTask ? (
        <p className="empty">아직 취재 과제가 없습니다. 기획 검토에서 취재할 문장을 고른 뒤 과제를 만들 수 있습니다.</p>
      ) : null}
      {list.length ? (
        <div className="split">
          <div className="scroll-x split-list">
            <table className="grid">
              <thead><tr><th scope="col">과제</th><th scope="col">원본</th><th scope="col">담당</th><th scope="col">상태</th><th scope="col">버전</th><th scope="col">고친 시각</th></tr></thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} className={cx(selected === t.id && 'row-on')}>
                    <td><button type="button" className="link strong" aria-current={selected === t.id ? 'true' : undefined} onClick={() => go({ taskId: t.id, creatingTask: false, taskJustMade: null })}>{t.title}</button><br /><span className="muted">질문 {t.questions.length}개</span></td>
                    <td>{t.review_id ? '초안 검토' : 'Brief'} <span className="mono">{short(t.review_id || t.brief_id)}</span></td>
                    <td>{memberName(members.data ? members.data.items : [], t.assignee_id)}</td>
                    <td><St kind="task" code={t.status} small /></td>
                    <td className="num">{t.row_version}</td>
                    <td>{whenShort(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && !route.creatingTask ? <TaskDetail key={selected} c={c} taskId={selected} members={members.data ? members.data.items : []} justMade={route.taskJustMade === selected} /> : null}
        </div>
      ) : null}
    </div>
  );
}
