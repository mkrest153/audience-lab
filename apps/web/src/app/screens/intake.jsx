// UI-01 기획 입력: 모드, 제목, 질문, 기준 시각, 초안 또는 공개 원문.
/* global React */
import * as L from '../../labels.js';
import { app, useStore, go, openCase, bump } from '../store.js';
import { api, useIdem, fieldErrors, NetError, kick, newKey } from '../api.js';
import DEMO, { sourceBody } from '../demo.js';
import { Id, Pins, Btn, Field, TimeField, useClockField, ApiError, NetNote, DemoFill, useMe, useDemo, canWrite, cx, labelOr } from '../ui.jsx';
import { when, whenShort, short, count, toLocalInput, fromLocalInput } from '../time.js';

const { useState, useRef } = React;
const MODES = ['DRAFT_REVIEW', 'SOURCE_REVIEW', 'QUESTION_ONLY'];
const RIGHTS_OPTIONS = ['OPEN', 'UNKNOWN', 'RESTRICTED_LINK_ONLY', 'LICENSED_FULL_TEXT', 'LICENSED_PASSAGE'];
let uidSeq = 0;
const blankSource = () => { uidSeq += 1; return { uid: `src-${uidSeq}`, title: '', source_url: '', recorded: '', rights_class: 'OPEN', body: '' }; };

function Versions({ c, versions }) {
  const head = c.head || {};
  return (
    <div className="form-grid">
      <div>
        <h4>질문 상태 버전 <span className="count">{versions.states.length}</span></h4>
        <div className="scroll-x">
          <table className="grid">
            <thead><tr><th scope="col">버전</th><th scope="col">질문</th><th scope="col">저장한 이유</th><th scope="col">만든 시각</th></tr></thead>
            <tbody>
              {versions.states.map((s) => (
                <tr key={s.id} className={cx(head.state_version_id === s.id && 'row-on')}>
                  <td>v{s.version_number} <Id v={s.id} />{head.state_version_id === s.id ? <span className="chip chip-on">활성</span> : null}</td>
                  <td>{s.state.primary_editorial_question}</td>
                  <td>{labelOr(L.STATE_REASON, s.reason)}</td>
                  <td>{whenShort(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4>본문 버전 <span className="count">{versions.contents.length}</span></h4>
        {versions.contents.length === 0 ? <p className="empty">저장한 본문이 없습니다.</p> : (
          <div className="scroll-x">
            <table className="grid">
              <thead><tr><th scope="col">버전</th><th scope="col">종류</th><th scope="col">글자 수</th><th scope="col">SHA-256</th><th scope="col">만든 시각</th></tr></thead>
              <tbody>
                {versions.contents.map((v) => (
                  <tr key={v.id} className={cx(head.content_version_id === v.id && 'row-on')}>
                    <td>v{v.version_number} <Id v={v.id} />{head.content_version_id === v.id ? <span className="chip chip-on">활성 초안</span> : null}</td>
                    <td>{v.origin === 'USER_INPUT' ? '사용자 초안' : '등록한 자료'}</td>
                    <td className="num">{v.body === null ? '볼 수 없음' : count(v.body).toLocaleString('ko-KR')}</td>
                    <td><span className="hash">{v.body_sha256.slice(0, 12)}…</span></td>
                    <td>{whenShort(v.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="foot">등록한 자료의 본문은 번호가 더 높아도 초안이 되지 않습니다. 활성 초안은 마지막으로 저장한 기획 입력이 정합니다.</p>
      </div>
    </div>
  );
}

export function IntakeScreen({ c, versions }) {
  const me = useMe();
  const led = useStore(app, (s) => (c ? s.ledger[c.id] : null));
  const isNew = !c;
  const head = c && c.head ? c.head : {};
  const curState = c ? versions.states.find((s) => s.id === head.state_version_id) : null;
  const curDraft = c ? versions.contents.find((v) => v.id === head.content_version_id) : null;
  const knownMode = led && head.state_version_id ? led.modes[head.state_version_id] : null;
  const [mode, setMode] = useState(knownMode || (isNew || curDraft ? 'DRAFT_REVIEW' : 'SOURCE_REVIEW'));
  const [title, setTitle] = useState(c ? c.title : '');
  const [question, setQuestion] = useState(curState ? curState.state.primary_editorial_question : '');
  const [draft, setDraft] = useState(curDraft && curDraft.body ? curDraft.body : '');
  const [sources, setSources] = useState([blankSource()]);
  const [partial, setPartial] = useState(false);
  const [qb, setQb] = useState(10);
  const [sb, setSb] = useState(20);
  const asOf = useClockField();
  const [prog, setProg] = useState({ intake: null, reused: false, subs: {}, done: false });
  const [err, setErr] = useState(null);       // { step, error, status } | { step, net }
  const [subErr, setSubErr] = useState({});   // uid -> { error, status } | { net }
  const [busy, setBusy] = useState(false);
  const idemIntake = useIdem();
  const idemExec = useIdem();
  const subKeys = useRef({});
  const execAt = useRef(null);   // the evidence run's as_of, kept for retries of the same intent
  const write = canWrite(me);
  const demoOk = useDemo(c);
  const locked = !!prog.intake;
  const fe = err && err.error ? fieldErrors(err.error) : {};
  const num = (v) => (v === '' ? '' : Number(v));
  const setSource = (uid, k, v) => setSources((list) => list.map((s) => (s.uid === uid ? { ...s, [k]: v } : s)));
  const sourcePayload = (s) => ({
    title: s.title, source_url: s.source_url, transcript_locator: null,
    recorded_at: fromLocalInput(s.recorded || asOf.value), sensitivity: 'PUBLIC', rights_class: s.rights_class,
    body: s.rights_class === 'OPEN' ? s.body : null,
  });
  const subKey = (uid, body) => {
    const sig = JSON.stringify(body);
    const cur = subKeys.current[uid];
    if (!cur || cur.sig !== sig) subKeys.current[uid] = { sig, key: newKey() };
    return subKeys.current[uid].key;
  };

  const fillDraft = () => {
    setMode('DRAFT_REVIEW'); setTitle(c ? c.title : DEMO.intake.title); setQuestion(DEMO.intake.question); setDraft(DEMO.intake.draft);
    asOf.set(toLocalInput(DEMO.intake.as_of));
  };
  const fillSources = () => {
    setMode('SOURCE_REVIEW'); setTitle(c ? c.title : DEMO.intake.title); setQuestion(DEMO.intake.question);
    setSources(['S1', 'S2', 'S3', 'S4'].map((k) => { const s = sourceBody(k); return { ...blankSource(), title: s.title, source_url: s.source_url, recorded: toLocalInput(s.recorded_at), rights_class: s.rights_class, body: s.body }; }));
  };
  const fillQuestion = () => { setMode('QUESTION_ONLY'); setTitle(c ? c.title : DEMO.intake.title); setQuestion(DEMO.intake.question); asOf.set(toLocalInput(DEMO.intake.as_of)); };

  const submit = async () => {
    setBusy(true); setErr(null);
    let step = 'intake';
    try {
      let ids = prog.intake;
      if (!ids) {
        const body = { mode, title, question, as_of: asOf.iso };
        if (mode === 'DRAFT_REVIEW') body.draft = draft;
        const res = await api(isNew ? 'createCaseIntake' : 'appendCaseIntake', { params: isNew ? {} : { case_id: c.id }, body, key: idemIntake.keyFor(body) });
        idemIntake.settle();
        if (!res.ok) { setErr({ step, error: res.error, status: res.status }); return; }
        ids = res.data;
        setProg((p) => ({ ...p, intake: ids, reused: !!res.data.reused }));
        bump();
      }
      const params = { case_id: ids.case_id };
      const subs = { ...prog.subs };
      if (mode === 'SOURCE_REVIEW') {
        step = 'subs';
        let failed = false;
        const errs = {};
        for (const s of sources) {
          if (subs[s.uid]) continue;
          const body = sourcePayload(s);
          try {
            const res = await api('createEvidenceSubmission', { params, body, key: subKey(s.uid, body) });
            delete subKeys.current[s.uid];
            if (res.ok) { subs[s.uid] = res.data.submission.id; setProg((p) => ({ ...p, subs: { ...p.subs, [s.uid]: res.data.submission.id } })); }
            else { failed = true; errs[s.uid] = { error: res.error, status: res.status }; }
          } catch (e) {
            if (!(e instanceof NetError)) throw e;
            failed = true; errs[s.uid] = { net: { lost: e.lost } };
          }
        }
        setSubErr(errs);
        if (failed) { setErr({ step }); return; }
      }
      step = 'exec';
      // taken after the sources were received, so a time that follows the clock is never earlier than them
      if (!execAt.current) execAt.current = asOf.fresh();
      const body = {
        mode, state_version_id: ids.state_version_id, content_version_id: ids.content_version_id, baseline_pack_id: null,
        submission_ids: sources.map((s) => subs[s.uid]).filter(Boolean), reporting_result_ids: [], as_of: execAt.current,
        allow_partial: partial, parameters: { query_budget: qb, source_budget: sb, language: 'ko' },
      };
      if (mode !== 'SOURCE_REVIEW') body.submission_ids = [];
      const res = await api('createRealityExecution', { params, body, key: idemExec.keyFor(body) });
      idemExec.settle();
      if (!res.ok) { setErr({ step, error: res.error, status: res.status }); return; }
      setProg((p) => ({ ...p, done: true }));
      execAt.current = null;
      bump(); kick();
      if (isNew) openCase(ids.case_id, 'status'); else go({ tab: 'status' });
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setErr({ step, net: { lost: e.lost } });
    } finally { setBusy(false); }
  };
  const restart = () => { setProg({ intake: null, reused: false, subs: {}, done: false }); setErr(null); setSubErr({}); subKeys.current = {}; execAt.current = null; };

  return (
    <div className="screen">
      <div className="screen-top">
        <h2>{isNew ? '새 기획' : '기획 입력'}</h2>
        <DemoFill show={demoOk} items={[
          { label: '청람시 초안 검토', run: fillDraft },
          { label: '청람시 자료 검토(S1–S4)', run: fillSources },
          { label: '청람시 질문만', run: fillQuestion },
        ]} />
      </div>
      <p className="lede">질문과 초안 또는 공개 자료를 저장하고, 저장한 그 버전으로 검토를 시작합니다.</p>
      {c ? (
        <>
          <header className="viewhead">
            <div className="viewhead-t"><h3>지금 활성 입력</h3>{c.head ? null : <span className="chip chip-warn">활성 입력이 아직 지정되지 않음</span>}</div>
            {c.head ? (
              <Pins items={[
                { label: '입력 모드', text: knownMode ? labelOr(L.MODE, knownMode) : (head.content_version_id ? '초안 있음' : '초안 없음') },
                { label: '질문 상태 버전', id: head.state_version_id },
                { label: '활성 초안', text: head.content_version_id ? undefined : '없음', id: head.content_version_id || undefined },
                { label: '활성 근거 묶음', text: head.pack_id ? undefined : '없음', id: head.pack_id || undefined },
                { label: '활성 검토', text: head.review_id ? undefined : '없음', id: head.review_id || undefined },
                { label: '활성 입력 버전', text: `${head.row_version}` },
                { label: '최초 기준 시각', text: when(c.as_of) },
              ]} />
            ) : null}
          </header>
          <Versions c={c} versions={versions} />
        </>
      ) : null}

      {!write ? <p className="note tone-info">열람 권한에서는 기획을 저장하거나 검토를 시작할 수 없습니다.</p> : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <div className="form-head"><h3>{isNew ? '기획 저장하고 검토 시작' : '새 입력 저장하고 검토 시작'}</h3></div>
          {c ? <p className="foot">저장하면 새 버전이 활성 입력이 됩니다. 진행 중이던 검토는 이전 버전을 기준으로 끝나며 새 버전의 결과로 바뀌지 않습니다.</p> : null}
          <fieldset className={cx('fieldset', fe.mode && 'has-error')} disabled={locked}>
            <legend>입력 모드 <span className="req">필수</span></legend>
            {MODES.map((m) => (
              <label key={m} className="check check-block">
                <input type="radio" name="intake-mode" id={`intake-mode-${m}`} checked={mode === m} onChange={() => setMode(m)} />
                <span><b>{L.MODE[m]}</b> <span className="muted">{L.MODE_HINT[m]}</span></span>
              </label>
            ))}
            {fe.mode ? <p className="field-error" role="alert">{fe.mode}</p> : null}
          </fieldset>
          <div className="form-grid">
            <Field id="intake-title" label="제목" required error={fe.title} count={count(title)} max={300} hint={c ? '기존 기획의 제목은 그대로 둡니다.' : ''}>
              <input id="intake-title" type="text" value={title} readOnly={!!c || locked} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!fe.title} />
            </Field>
            <TimeField id="intake-asof" label="기준 시각" required field={asOf} readOnly={locked} error={fe.as_of} hint="이 시각까지 확인된 자료만 근거로 씁니다." />
          </div>
          <Field id="intake-question" label="기획 질문" required error={fe.question} count={count(question)} max={500}>
            <input id="intake-question" type="text" value={question} readOnly={locked} onChange={(e) => setQuestion(e.target.value)} aria-invalid={!!fe.question} />
          </Field>
          {mode === 'DRAFT_REVIEW' ? (
            <Field id="intake-draft" label="초안" required error={fe.draft} count={count(draft)} max={50000} hint="입력한 그대로 보존합니다. 맞춤법 교정이나 공백 정리를 하지 않습니다. 넘치면 나누어 검토합니다.">
              <textarea id="intake-draft" className="doc" rows={6} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={draft} readOnly={locked} onChange={(e) => setDraft(e.target.value)} aria-invalid={!!fe.draft}></textarea>
            </Field>
          ) : null}
          {mode === 'SOURCE_REVIEW' ? (
            <fieldset className={cx('fieldset', fe.submission_ids && 'has-error')}>
              <legend>공개 원문과 출처 <span className="req">필수</span> <span className="muted">공개 원문이 하나 이상 있어야 합니다</span></legend>
              {sources.map((s, i) => {
                const saved = prog.subs[s.uid];
                const se = subErr[s.uid];
                const sfe = se && se.error ? fieldErrors(se.error) : {};
                const meta = s.rights_class !== 'OPEN';
                return (
                  <div key={s.uid} className={cx('srcrow', saved && 'srcrow-saved')}>
                    <p className="srcrow-h"><b>원문 {i + 1}</b>
                      {saved ? <span className="chip chip-on">등록됨 <span className="mono">{short(saved)}</span></span> : null}
                      {!saved && sources.length > 1 ? <button type="button" className="link quiet" onClick={() => setSources((list) => list.filter((x) => x.uid !== s.uid))}>빼기<span className="sr"> 원문 {i + 1}</span></button> : null}
                    </p>
                    <div className="form-grid">
                      <Field id={`${s.uid}-title`} label="자료 제목" required error={sfe.title}>
                        <input id={`${s.uid}-title`} type="text" value={s.title} readOnly={!!saved} onChange={(e) => setSource(s.uid, 'title', e.target.value)} />
                      </Field>
                      <Field id={`${s.uid}-url`} label="출처 주소(HTTPS)" required error={sfe.source_url}>
                        <input id={`${s.uid}-url`} type="url" inputMode="url" placeholder="https://" value={s.source_url} readOnly={!!saved} onChange={(e) => setSource(s.uid, 'source_url', e.target.value)} />
                      </Field>
                      <Field id={`${s.uid}-rec`} label="기록 시각" required error={sfe.recorded_at} hint="비워 두면 기준 시각을 씁니다.">
                        <input id={`${s.uid}-rec`} type="datetime-local" value={s.recorded} readOnly={!!saved} onChange={(e) => setSource(s.uid, 'recorded', e.target.value)} />
                      </Field>
                      <Field id={`${s.uid}-rights`} label="권리" required error={sfe.rights_class} hint={meta ? '제목과 출처만 보관하고 원문은 받지 않습니다.' : ''}>
                        <select id={`${s.uid}-rights`} value={s.rights_class} disabled={!!saved} onChange={(e) => setSource(s.uid, 'rights_class', e.target.value)}>
                          {RIGHTS_OPTIONS.map((r) => <option key={r} value={r}>{labelOr(L.RIGHTS, r)}</option>)}
                        </select>
                      </Field>
                    </div>
                    <Field id={`${s.uid}-body`} label="원문" required={!meta} error={sfe.body} count={count(meta ? '' : s.body)} max={200000}>
                      <textarea id={`${s.uid}-body`} className="doc" rows={2} spellCheck={false} disabled={meta} readOnly={!!saved} value={meta ? '' : s.body} onChange={(e) => setSource(s.uid, 'body', e.target.value)}></textarea>
                    </Field>
                    {se && se.net ? <NetNote lost={se.net.lost} /> : null}
                    {se && se.error ? <ApiError error={{ ...se.error, details: (se.error.details || []).filter((d) => !['title', 'source_url', 'recorded_at', 'rights_class', 'body'].includes(d.field)) }} status={se.status} title={`원문 ${i + 1}을 등록하지 못했습니다`} /> : null}
                  </div>
                );
              })}
              {fe.submission_ids ? <p className="field-error" role="alert">{fe.submission_ids}</p> : null}
              <p><Btn kind="ghost" onClick={() => setSources((list) => [...list, blankSource()])}>원문 추가</Btn></p>
            </fieldset>
          ) : null}
          {mode === 'QUESTION_ONLY' ? <p className="foot">초안과 자료 없이 질문으로 공개 자료를 찾아 근거를 정리합니다. 결과는 Brief이며 문장별 판정은 만들지 않습니다.</p> : null}
          <details className="more">
            <summary>세부 설정</summary>
            <div className="form-grid form-grid-3">
              <Field id="intake-qb" label="질의 예산" error={fe['parameters.query_budget']} hint="1에서 20. 기본 10">
                <input id="intake-qb" type="number" inputMode="numeric" value={qb} onChange={(e) => setQb(num(e.target.value))} />
              </Field>
              <Field id="intake-sb" label="자료 예산" error={fe['parameters.source_budget']} hint="1에서 50. 기본 20">
                <input id="intake-sb" type="number" inputMode="numeric" value={sb} onChange={(e) => setSb(num(e.target.value))} />
              </Field>
            </div>
            <label className="check"><input type="checkbox" id="intake-partial" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> 일부 자료 수집이 실패해도 부분 결과를 받겠습니다</label>
          </details>

          {locked ? (
            <div className="note tone-ok" role="status">
              <p className="note-h">입력을 저장했습니다{prog.reused ? ' (같은 요청을 이미 받은 적이 있어 그때의 결과를 돌려받았습니다)' : ''}</p>
              <Pins items={[{ label: '기획', id: prog.intake.case_id }, { label: '질문 상태 버전', id: prog.intake.state_version_id }, { label: '초안 버전', text: prog.intake.content_version_id ? undefined : '없음', id: prog.intake.content_version_id || undefined }]} />
              {!prog.done ? <p>받은 ID를 보관했습니다. 아래 단추를 다시 누르면 저장을 되풀이하지 않고 남은 단계부터 이어갑니다.</p> : null}
            </div>
          ) : null}
          {err && err.net ? <NetNote lost={err.net.lost} /> : null}
          {err && err.error ? (
            <ApiError error={{ ...err.error, details: (err.error.details || []).filter((d) => !['mode', 'title', 'question', 'as_of', 'draft', 'submission_ids', 'parameters.query_budget', 'parameters.source_budget'].includes(d.field)) }}
              status={err.status} title={err.step === 'intake' ? '입력을 저장하지 못했습니다' : '근거 실행을 접수하지 못했습니다'} />
          ) : null}
          {err && err.step === 'subs' && !err.net ? <p className="note tone-warn" role="alert">등록하지 못한 원문이 있습니다. 이미 등록된 원문의 ID는 그대로 두었습니다. 고친 뒤 다시 누르면 남은 원문만 등록합니다.</p> : null}
          <div className="form-foot">
            <Btn kind="primary" type="submit" busy={busy}>{locked ? '남은 단계 이어서 진행' : '저장하고 검토 시작'}</Btn>
            {locked && !prog.done ? <Btn kind="ghost" onClick={restart}>새 입력으로 다시 쓰기</Btn> : null}
          </div>
        </form>
      )}
    </div>
  );
}
