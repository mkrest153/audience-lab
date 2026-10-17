// UI-06 취재 결과: 공개 원문 등록, 사용자 메모, 결과 저장, 재검토 제출.
/* global React */
import * as L from '../../labels.js';
import { app, useStore, go, serverNow } from '../store.js';
import { useQuery, useMany, useAction, fieldErrors, api, NetError } from '../api.js';
import DEMO, { sourceBody } from '../demo.js';
import { St, Id, Pins, Btn, Field, TimeField, useClockField, QueryState, Empty, ActionState, DemoFill, useMe, useDemo, canWrite, cx, labelOr } from '../ui.jsx';
import { when, whenShort, short, count, toLocalInput } from '../time.js';

const { useState, useRef } = React;

// Fills the form from a public-record page the server fetches itself (only
// national and local government domains, whose works are free to use).
export function FetchFromUrl({ url, onFill, onRecorded }) {
  const [raw, setSt] = useState(null);
  // a message belongs to the address it was about; a new address or a cleared form drops it
  const st = raw && (raw.busy || raw.for === url) ? raw : null;
  const run = async () => {
    setSt({ busy: true, for: url });
    try {
      const res = await api('previewSource', { body: { url } });
      if (!res.ok) { setSt({ for: url, error: res.error.details && res.error.details[0] ? res.error.details[0].reason : res.error.message }); return; }
      onFill(res.data);
      onRecorded(res.data.published_at);
      setSt({ for: res.data.final_url || url, ok: `원문 ${[...res.data.text].length.toLocaleString('ko-KR')}자를 가져왔습니다. 내용을 확인한 뒤 등록하세요.` });
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setSt({ for: url, error: '서버에 닿지 않았습니다.' });
    }
  };
  return (
    <p className="fetchrow">
      <Btn kind="ghost" busy={st && st.busy} disabled={!/^https?:\/\/\S+$/.test(url || '')} onClick={run}>주소에서 원문 가져오기</Btn>
      {st && st.error ? <span className="off"> {st.error}</span> : null}
      {st && st.ok ? <span className="muted"> {st.ok}</span> : null}
      {!st ? <span className="muted"> 정부·지자체 공개 자료(go.kr, korea.kr, kosis.kr) 주소만 가져옵니다. 그 밖의 자료는 원문을 직접 붙여 넣으세요.</span> : null}
    </p>
  );
}

const RIGHTS_OPTIONS = ['OPEN', 'UNKNOWN', 'RESTRICTED_LINK_ONLY', 'LICENSED_FULL_TEXT', 'LICENSED_PASSAGE'];
const SENSITIVITY = { PUBLIC: '공개 자료', INTERNAL: '내부 자료', CONFIDENTIAL_UNPUBLISHED: '미공개 기밀', ORGANIZATION_PRIVATE_DATA: '조직 비공개 데이터' };
const BLANK = { title: '', locator: 'url', source_url: '', transcript_locator: '', rights_class: 'OPEN', sensitivity: 'PUBLIC', body: '' };

// ---------------------------------------------------------------- 원문 등록
function SubmissionForm({ c, onDone }) {
  const a = useAction();
  const [f, setF] = useState(BLANK);
  const demoOk = useDemo(c);
  const rec = useClockField();
  const fe = fieldErrors(a.error);
  const metaOnly = f.rights_class !== 'OPEN';
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const body = {
    title: f.title,
    source_url: f.locator === 'url' ? f.source_url : null,
    transcript_locator: f.locator === 'transcript' ? f.transcript_locator : null,
    recorded_at: rec.iso, sensitivity: f.sensitivity, rights_class: f.rights_class,
    body: metaOnly ? null : f.body,
  };
  const fill = (k) => {
    const s = sourceBody(k);
    setF({ ...BLANK, title: s.title, source_url: s.source_url, rights_class: s.rights_class, body: s.body || '' });
    rec.set(toLocalInput(s.recorded_at));
  };
  const fillOwn = () => {
    setF({ ...BLANK, title: '시연 자료에 없는 글', source_url: 'https://example.org/own-note', body: '담당 부서와 통화한 내용을 직접 정리한 글이다.' });
    rec.reset();
  };
  const submit = () => a.run('createEvidenceSubmission', {
    params: { case_id: c.id }, body,
    onOk: (res) => { onDone(res.data.submission); setF(BLANK); rec.reset(); },
  });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <div className="form-head">
        <h3>공개 원문 등록</h3>
        <DemoFill show={demoOk} items={[
          { label: 'S6 분리 내역', run: () => fill('S6') },
          { label: 'S7 계약대장 보충', run: () => fill('S7') },
          { label: 'S5 권리 미확인', run: () => fill('S5') },
          { label: '시연 밖 자료', run: fillOwn },
        ]} />
      </div>
      <p className="foot">확보한 원문을 그대로 넣습니다. 등록만으로 질문이 풀리거나 과제가 끝나지는 않습니다. 정부·지자체 공개 자료는 주소로 원문을 가져올 수 있습니다.</p>
      <div className="form-grid">
        <Field id="sub-title" label="자료 제목" required error={fe.title} count={count(f.title)} max={300}>
          <input id="sub-title" type="text" value={f.title} onChange={(e) => set('title', e.target.value)} aria-invalid={!!fe.title} />
        </Field>
        <TimeField id="sub-recorded" label="기록 시각" required field={rec} error={fe.recorded_at} hint="자료가 기록·발행된 때입니다. 받은 시각은 서버가 따로 남깁니다." />
      </div>
      <fieldset className={cx('fieldset', (fe.source_url || fe.transcript_locator) && 'has-error')}>
        <legend>출처 <span className="req">필수</span> <span className="muted">둘 중 하나</span></legend>
        <div className="radios">
          <label className="check"><input type="radio" name="sub-locator" id="sub-locator-url" checked={f.locator === 'url'} onChange={() => set('locator', 'url')} /> HTTPS 주소</label>
          <label className="check"><input type="radio" name="sub-locator" id="sub-locator-tr" checked={f.locator === 'transcript'} onChange={() => set('locator', 'transcript')} /> 공개 전사 위치</label>
        </div>
        {f.locator === 'url' ? (
          <>
            <label htmlFor="sub-url" className="sr">HTTPS 주소</label><input id="sub-url" type="url" inputMode="url" placeholder="https://" value={f.source_url} onChange={(e) => set('source_url', e.target.value)} aria-invalid={!!fe.source_url} />
            {!demoOk ? (
              <FetchFromUrl
                url={f.source_url}
                onFill={(page) => setF((x) => ({ ...x, title: x.title || [...(page.title || '')].slice(0, 300).join(''), source_url: page.final_url || x.source_url, body: page.text, rights_class: 'OPEN', sensitivity: 'PUBLIC' }))}
                onRecorded={(at) => { if (at) rec.set(toLocalInput(at)); }}
              />
            ) : null}
          </>
        ) : (
          <><label htmlFor="sub-tr" className="sr">공개 전사 위치</label><input id="sub-tr" type="text" placeholder="예: 공개 회의록 3쪽" value={f.transcript_locator} onChange={(e) => set('transcript_locator', e.target.value)} aria-invalid={!!fe.transcript_locator} /></>
        )}
        {fe.source_url || fe.transcript_locator ? <p className="field-error" role="alert">{fe.source_url || fe.transcript_locator}</p> : null}
      </fieldset>
      <div className="form-grid">
        <Field id="sub-rights" label="권리" required error={fe.rights_class} hint={metaOnly ? '전문을 쓸 권리가 확인되지 않은 자료는 제목과 출처만 보관합니다. 원문은 받지 않습니다.' : '전문을 저장하고 검토에 쓸 수 있는 공개 자료입니다.'}>
          <select id="sub-rights" value={f.rights_class} onChange={(e) => set('rights_class', e.target.value)}>
            {RIGHTS_OPTIONS.map((r) => <option key={r} value={r}>{labelOr(L.RIGHTS, r)}</option>)}
          </select>
        </Field>
        <Field id="sub-sens" label="민감도" required error={fe.sensitivity} hint="이 범위에서는 공개 자료만 받습니다. 분류는 넣는 사람의 책임입니다.">
          <select id="sub-sens" value={f.sensitivity} onChange={(e) => set('sensitivity', e.target.value)}>
            {Object.entries(SENSITIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field id="sub-body" label="원문" required={!metaOnly} error={fe.body} count={count(metaOnly ? '' : f.body)} max={200000} hint="입력한 그대로 보존합니다. 넘치면 나누어 등록합니다. 잘라서 저장하지 않습니다.">
        <textarea id="sub-body" className="doc" rows={4} spellCheck={false} disabled={metaOnly} value={metaOnly ? '' : f.body} onChange={(e) => set('body', e.target.value)} aria-invalid={!!fe.body}></textarea>
      </Field>
      <ActionState a={a} fields={['title', 'recorded_at', 'source_url', 'transcript_locator', 'rights_class', 'sensitivity', 'body']} />
      <div className="form-foot"><Btn kind="primary" type="submit" busy={a.busy}>원문 등록</Btn></div>
    </form>
  );
}

function Submissions({ subs, picked, onToggle }) {
  if (!subs.length) return <p className="empty">이 기획에 등록한 원문이 아직 없습니다.</p>;
  return (
    <div className="scroll-x">
      <table className="grid grid-wide">
        <thead><tr><th scope="col">결과에 넣기</th><th scope="col">자료</th><th scope="col">기록 시각</th><th scope="col">받은 시각</th><th scope="col">권리와 보관</th><th scope="col">상태</th><th scope="col">고정 ID</th></tr></thead>
        <tbody>
          {subs.map((s, i) => (
            <tr key={s.id}>
              <td><input type="checkbox" id={`pick-sub-${i}`} aria-label={`${s.title} 결과에 넣기`} checked={picked.includes(s.id)} onChange={() => onToggle(s.id)} /></td>
              <td>{s.title}<br /><span className="url">{s.source_url || s.transcript_locator}</span></td>
              <td>{whenShort(s.recorded_at)}</td>
              <td>{whenShort(s.received_at)}</td>
              <td>{labelOr(L.RIGHTS, s.rights_class)}<br /><span className="muted">{s.access_mode === 'FULL_TEXT' ? '전문 보관' : '제목과 출처만 보관'}</span></td>
              <td><St kind="submission" code={s.status} small /></td>
              <td><Id v={s.id} />{s.body_sha256 ? <><br /><span className="hash">SHA-256 {s.body_sha256.slice(0, 12)}…</span></> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- 결과 저장
function ResultForm({ c, task, picked, questions }) {
  const a = useAction();
  const [note, setNote] = useState('');
  const [qids, setQids] = useState([]);
  const demoOk = useDemo(c);
  const fe = fieldErrors(a.error);
  const toggle = (id) => setQids((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const fill = () => {
    setNote(DEMO.result_note);
    setQids(questions.filter((q) => ['U1', 'U1a', 'U1b'].includes(q.question_key)).map((q) => q.id));
  };
  const submit = () => a.run('createReportingResult', {
    params: { case_id: c.id }, body: { task_id: task.id, submission_ids: picked, note, question_ids: qids },
    onOk: () => { setNote(''); setQids([]); },
  });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <div className="form-head">
        <h3>취재 결과 저장</h3>
        <DemoFill show={demoOk} items={[{ label: '예시 메모와 질문', run: fill }]} />
      </div>
      <p className={cx('pickline', fe.submission_ids && 'has-error')}>결과에 넣을 원문 <b>{picked.length}</b>건 <span className="muted">위 표에서 고릅니다. 1건에서 20건</span></p>
      {fe.submission_ids ? <p className="field-error" role="alert">{fe.submission_ids}</p> : null}
      <fieldset className={cx('fieldset', fe.question_ids && 'has-error')}>
        <legend>이 자료로 답하려는 질문 <span className="req">필수</span></legend>
        {questions.length === 0 ? <p className="muted">과제의 원본에 질문이 없습니다.</p> : questions.map((q, i) => (
          <label key={q.id} className={cx('check', q.parent_id && 'check-child')}>
            <input type="checkbox" id={`res-q-${i}`} checked={qids.includes(q.id)} onChange={() => toggle(q.id)} />
            <span><span className="mono">{q.question_key}</span> {q.question}</span>
          </label>
        ))}
        {fe.question_ids ? <p className="field-error" role="alert">{fe.question_ids}</p> : null}
      </fieldset>
      <Field id="res-note" label="취재 메모" error={fe.note} count={count(note)} max={5000} hint="메모는 사용자 메모(USER_NOTE)로만 남습니다. 근거 진술이나 원문 구간으로 바뀌지 않습니다.">
        <textarea id="res-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}></textarea>
      </Field>
      <ActionState a={a} fields={['submission_ids', 'question_ids', 'note']} />
      <div className="form-foot"><Btn kind="primary" type="submit" busy={a.busy} disabled={task.status === 'CANCELLED'}>취재 결과 저장</Btn></div>
    </form>
  );
}

function Results({ results, questions, subTitle }) {
  if (!results.length) return <p className="empty">이 과제에 저장한 취재 결과가 아직 없습니다.</p>;
  const qk = Object.fromEntries(questions.map((q) => [q.id, q.question_key]));
  return (
    <div className="scroll-x">
      <table className="grid">
        <thead><tr><th scope="col">취재 결과</th><th scope="col">받은 시각</th><th scope="col">원문</th><th scope="col">답하려는 질문</th><th scope="col">메모 <code>USER_NOTE</code></th></tr></thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id}>
              <td><Id v={r.id} /></td>
              <td>{whenShort(r.received_at)}</td>
              <td>{r.submission_ids.map((id) => <span key={id} className="v-qi">{subTitle(id)}</span>)}</td>
              <td>{r.question_ids.map((id) => qk[id] || short(id)).join(', ')}</td>
              <td>{r.note || <span className="muted">없음</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- 재검토
function Reassess({ c, task, results, subs }) {
  const led = useStore(app, (s) => s.ledger[c.id]);
  const jobs = useStore(app, (s) => s.jobs);
  const a = useAction();
  const asOf = useClockField();
  const [partial, setPartial] = useState(false);
  const [off, setOff] = useState([]);                // results left out
  const [baseline, setBaseline] = useState(null);
  const [mode, setMode] = useState(null);
  const [sent, setSent] = useState(false);
  const fe = fieldErrors(a.error);
  const head = c.head || {};
  const isDraft = !!task.review_id;
  // material received after the chosen time cannot be part of this view; a
  // time that follows the clock is "now" at the moment of sending
  const asOfMs = asOf.following ? serverNow() + 60000 : Date.parse(asOf.iso);
  const sentAt = useRef(null);
  const lateAt = (r) => {
    const times = r.submission_ids.map((id) => subs.find((s) => s.id === id)).filter(Boolean).map((s) => s.received_at);
    const last = times.sort().pop();
    return last && !Number.isNaN(asOfMs) && Date.parse(last) > asOfMs ? last : null;
  };
  const use = results.filter((r) => !off.includes(r.id) && !lateAt(r)).map((r) => r.id);
  const reviews = led ? led.review.map((id) => jobs[id] && jobs[id].data).filter((d) => d && (d.status === 'COMPLETED' || d.status === 'PARTIAL')) : [];
  const base = baseline || (isDraft ? (head.review_id || task.review_id) : (head.pack_id || task.reality_pack_id));
  const knownMode = led ? led.modes[head.state_version_id || task.state_version_id] : null;
  const useMode = mode || (knownMode && knownMode !== 'DRAFT_REVIEW' ? knownMode : 'SOURCE_REVIEW');
  const submit = () => {
    setSent(false);
    // one as_of per intent, so a retry after a lost answer is the same request
    const sig = JSON.stringify([base, use, partial, useMode]);
    if (!sentAt.current || sentAt.current.sig !== sig || !asOf.following) sentAt.current = { sig, at: asOf.fresh() };
    const at = sentAt.current.at;
    const done = () => { setSent(true); sentAt.current = null; };
    if (isDraft) {
      return a.run('createReassessment', { params: { case_id: c.id }, body: { baseline_review_id: base, reporting_result_ids: use, as_of: at, allow_partial: partial }, onOk: done });
    }
    return a.run('createRealityExecution', { params: { case_id: c.id }, body: {
      mode: useMode, state_version_id: head.state_version_id || task.state_version_id, content_version_id: null, baseline_pack_id: base,
      submission_ids: [], reporting_result_ids: use, as_of: at, allow_partial: partial, parameters: { query_budget: 10, source_budget: 20, language: 'ko' },
    }, onOk: done });
  };
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <div className="form-head"><h3>{isDraft ? '새 자료로 재검토' : '새 자료로 근거 다시 실행'}</h3></div>
      <p className="foot">
        {isDraft
          ? '기준이 되는 검토와 넣을 취재 결과, 새 기준 시각을 고정해서 보냅니다. 접수한 뒤에 등록되는 자료는 이번 재검토에 들어가지 않습니다. 이전 검토는 그대로 남습니다.'
          : '초안이 없는 검토는 기준 근거 묶음과 취재 결과로 근거를 다시 실행한 뒤, 그 묶음으로 새 Brief를 만듭니다. 문장별 판정은 만들지 않습니다.'}
      </p>
      <div className="form-grid">
        {isDraft ? (
          <Field id="re-base" label="기준 검토" required error={fe.baseline_review_id} hint={base !== head.review_id ? '활성 결과가 아닌 검토를 기준으로 하면 새 결과는 별도 가지로 보존됩니다.' : '지금 활성 결과입니다.'}>
            <select id="re-base" value={base} onChange={(e) => setBaseline(e.target.value)}>
              {reviews.map((d) => <option key={d.id} value={d.id}>초안 검토 · 기준 {whenShort(d.as_of)} · {short(d.id)}{d.id === head.review_id ? ' · 활성' : ''}</option>)}
              {!reviews.some((d) => d.id === base) ? <option value={base}>초안 검토 · {short(base)}</option> : null}
            </select>
          </Field>
        ) : (
          <Field id="re-mode" label="입력 모드" required error={fe.mode} hint={knownMode ? '이 기획을 저장할 때 고른 모드입니다.' : '서버가 저장 당시의 모드를 돌려주지 않아 다시 고릅니다.'}>
            <select id="re-mode" value={useMode} onChange={(e) => setMode(e.target.value)}>
              <option value="SOURCE_REVIEW">{L.MODE.SOURCE_REVIEW}</option>
              <option value="QUESTION_ONLY">{L.MODE.QUESTION_ONLY}</option>
            </select>
          </Field>
        )}
        <TimeField id="re-asof" label="새 기준 시각" required field={asOf} error={fe.as_of} hint="넣을 자료를 받은 뒤의 시각이어야 합니다." />
      </div>
      {!isDraft ? <Pins items={[{ label: '기준 근거 묶음', id: base }, { label: '질문 상태 버전', id: head.state_version_id || task.state_version_id }]} /> : null}
      <fieldset className={cx('fieldset', fe.reporting_result_ids && 'has-error')}>
        <legend>넣을 취재 결과 <span className="req">필수</span></legend>
        {results.length === 0 ? <p className="muted">먼저 취재 결과를 저장하세요.</p> : results.map((r, i) => {
          const late = lateAt(r);
          return (
            <label key={r.id} className="check">
              <input type="checkbox" id={`re-res-${i}`} disabled={!!late} checked={!late && !off.includes(r.id)} onChange={() => setOff((x) => (x.includes(r.id) ? x.filter((y) => y !== r.id) : [...x, r.id]))} />
              <span>취재 결과 <span className="mono">{short(r.id)}</span> · 받은 시각 {whenShort(r.received_at)} · 원문 {r.submission_ids.length}건
                {late ? <span className="off"> · 뺌: 원문을 받은 시각({whenShort(late)})이 새 기준 시각보다 늦습니다</span> : null}</span>
            </label>
          );
        })}
        {fe.reporting_result_ids ? <p className="field-error" role="alert">{fe.reporting_result_ids}</p> : null}
      </fieldset>
      <label className="check"><input type="checkbox" id="re-partial" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> 일부 자료 수집이 실패해도 부분 결과를 받겠습니다</label>
      <ActionState a={a} fields={['as_of', 'reporting_result_ids', 'baseline_review_id', 'mode']} />
      {sent ? <p className="note tone-ok" role="status">접수했습니다. 끝나면 알려 드립니다. <button type="button" className="link" onClick={() => go({ tab: 'status' })}>실행 상태 보기</button></p> : null}
      <div className="form-foot"><Btn kind="primary" type="submit" busy={a.busy} disabled={!use.length}>{isDraft ? '재검토 제출' : '근거 실행 제출'}</Btn></div>
    </form>
  );
}

// ---------------------------------------------------------------- screen
export function ResultsScreen({ c }) {
  const me = useMe();
  const route = useStore(app, (s) => s.route);
  const led = useStore(app, (s) => s.ledger[c.id]);
  const jobs = useStore(app, (s) => s.jobs);
  const tasks = useQuery('listReportingTasks', { case_id: c.id });
  const list = tasks.data ? tasks.data.items : [];
  const taskId = route.taskId && list.some((t) => t.id === route.taskId) ? route.taskId : (list[0] ? list[0].id : null);
  const task = list.find((t) => t.id === taskId) || null;
  const subIds = led ? led.submission : [];
  const resIds = led ? led.result : [];
  const subs = useMany('getEvidenceSubmission', { case_id: c.id }, 'submission_id', subIds).filter(Boolean);
  const allResults = useMany('getReportingResult', { case_id: c.id }, 'result_id', resIds).filter(Boolean);
  const [picked, setPicked] = useState([]);
  const write = canWrite(me);
  const originId = task ? (task.review_id || task.brief_id) : null;
  const origin = originId && jobs[originId] ? jobs[originId].data : null;
  const questions = origin && origin.questions ? origin.questions : [];
  const results = task ? allResults.filter((r) => r.task_id === task.id) : [];
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const subTitle = (id) => { const s = subs.find((x) => x.id === id); return s ? s.title : short(id); };
  return (
    <div className="screen">
      <div className="screen-top">
        <h2>취재 결과</h2>
        {list.length ? (
          <div className="viewpick">
            <label htmlFor="res-task">과제</label>
            <select id="res-task" value={taskId || ''} onChange={(e) => { go({ taskId: e.target.value }); setPicked([]); }}>
              {list.map((t) => <option key={t.id} value={t.id}>{t.title} · {labelOr(L.TASK_STATUS, t.status)} · {short(t.id)}</option>)}
            </select>
          </div>
        ) : null}
      </div>
      <p className="lede">확보한 공개 원문과 취재 메모를 과제에 붙이고, 그 자료로 다시 검토합니다.</p>
      <QueryState q={tasks} what="과제 목록" />
      {tasks.data && !task ? (
        <div className="note tone-info">
          <p className="note-h">취재 결과를 붙일 과제가 없습니다</p>
          <p>취재 결과는 과제에 연결해 저장합니다. 과제를 먼저 만드세요.</p>
          <p><Btn onClick={() => go({ tab: 'tasks' })}>취재 과제로</Btn></p>
        </div>
      ) : null}
      {task ? (
        <>
          <header className="viewhead">
            <div className="viewhead-t"><h3>{task.title}</h3><St kind="task" code={task.status} /></div>
            <Pins items={[
              { label: '원본', text: task.review_id ? '초안 검토' : 'Brief', extra: short(originId) },
              { label: '근거 묶음', id: task.reality_pack_id },
              { label: '과제', id: task.id },
            ]} />
            <ol className="plain-ol">{task.questions.map((x, i) => <li key={i}>{x}</li>)}</ol>
            {task.status === 'CANCELLED' ? <p className="note tone-warn">취소된 과제에는 결과를 등록할 수 없습니다.</p> : null}
            {!write ? <p className="muted">열람 권한에서는 자료 등록과 저장을 할 수 없습니다.</p> : null}
          </header>
          {write ? <SubmissionForm c={c} onDone={(s) => setPicked((x) => (x.includes(s.id) ? x : [...x, s.id]))} /> : null}
          <section>
            <h3>등록한 원문 <span className="count">{subs.length}</span></h3>
            <Submissions subs={subs} picked={picked} onToggle={toggle} />
            <p className="foot">등록한 원문의 본문은 이 목록에 싣지 않습니다. 근거로 반영된 뒤 원문 패널에서 고정된 구간과 함께 봅니다.</p>
          </section>
          {write ? <ResultForm c={c} task={task} picked={picked} questions={questions} /> : null}
          <section>
            <h3>저장한 취재 결과 <span className="count">{results.length}</span></h3>
            <Results results={results} questions={questions} subTitle={subTitle} />
          </section>
          {write ? <Reassess key={task.id} c={c} task={task} results={results} subs={subs} /> : null}
        </>
      ) : null}
    </div>
  );
}
