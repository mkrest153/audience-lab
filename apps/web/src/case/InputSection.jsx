// 1단계 기획 입력: 모드, 제목, 질문, 기준 시각, 초안 또는 공개 원문을 저장하고 검토를 시작합니다.
import { useState, useRef } from 'react';
import { PenLine, FileSearch, CircleHelp, Plus, Trash2, Sparkles, Settings2, FilePlus2 } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, go, openCase, bump } from '../app/store.js';
import { api, useIdem, fieldErrors, NetError, kick, newKey } from '../app/api.js';
import DEMO, { sourceBody } from '../app/demo.js';
import { Section, Btn, LinkBtn, Field, Select, Segmented, TimeField, useClockField, ApiError, NetNote, Notice, More, KV, IdLine, Check2, inputCls, areaCls, useMe, useDemo, canWrite, cx, labelOr, laterIso } from '../ui/kit.jsx';
import { when, whenShort, count, toLocalInput, fromLocalInput } from '../app/time.js';
import { FetchFromUrl } from './fetchurl.jsx';
import { useCase } from './facts.js';

const MODES = [
  { id: 'DRAFT_REVIEW', label: '초안 검토', icon: PenLine },
  { id: 'SOURCE_REVIEW', label: '공개 자료 검토', icon: FileSearch },
  { id: 'QUESTION_ONLY', label: '질문만', icon: CircleHelp },
];
const RIGHTS_OPTIONS = ['OPEN', 'UNKNOWN', 'RESTRICTED_LINK_ONLY', 'LICENSED_FULL_TEXT', 'LICENSED_PASSAGE'];
const FORM_FIELDS = ['mode', 'title', 'question', 'as_of', 'draft', 'submission_ids', 'parameters.query_budget', 'parameters.source_budget'];
const SOURCE_FIELDS = ['title', 'source_url', 'recorded_at', 'rights_class', 'body'];
let uidSeq = 0;
const blankSource = () => { uidSeq += 1; return { uid: `src-${uidSeq}`, title: '', source_url: '', recorded: '', rights_class: 'OPEN', body: '' }; };

export function IntakeForm({ c, versions, onCancel }) {
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
  const subsAt = useRef({});     // uid -> when the server received that source
  const execAt = useRef(null);   // the evidence run's as_of, kept for retries of the same intent
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
            if (res.ok) { subs[s.uid] = res.data.submission.id; subsAt.current[s.uid] = res.data.submission.received_at; setProg((p) => ({ ...p, subs: { ...p.subs, [s.uid]: res.data.submission.id } })); }
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
      if (!execAt.current) {
        const at = asOf.fresh();
        execAt.current = asOf.following && mode === 'SOURCE_REVIEW' ? laterIso(at, ...sources.map((x) => subsAt.current[x.uid])) : at;
      }
      const body = {
        mode, state_version_id: ids.state_version_id, content_version_id: ids.content_version_id, baseline_pack_id: null,
        submission_ids: mode === 'SOURCE_REVIEW' ? sources.map((s) => subs[s.uid]).filter(Boolean) : [], reporting_result_ids: [], as_of: execAt.current,
        allow_partial: partial, parameters: { query_budget: qb, source_budget: sb, language: 'ko' },
      };
      const res = await api('createRealityExecution', { params, body, key: idemExec.keyFor(body) });
      idemExec.settle();
      if (!res.ok) { setErr({ step, error: res.error, status: res.status }); return; }
      setProg((p) => ({ ...p, done: true }));
      execAt.current = null;
      bump(); kick();
      if (isNew) openCase(ids.case_id, 'sec-evidence'); else go({ to: 'sec-evidence', intakeOpen: false });
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setErr({ step, net: { lost: e.lost } });
    } finally { setBusy(false); }
  };
  const restart = () => { setProg({ intake: null, reused: false, subs: {}, done: false }); setErr(null); setSubErr({}); subKeys.current = {}; subsAt.current = {}; execAt.current = null; };
  const hint = L.MODE_HINT[mode];
  const need = mode === 'DRAFT_REVIEW' ? [title, question, draft] : mode === 'SOURCE_REVIEW' ? [title, question, ...sources.map((s) => s.title)] : [title, question];
  const filled = need.filter((x) => String(x || '').trim()).length;

  return (
    <form className="rounded-2xl border border-g200 bg-white p-5 shadow-sm sm:p-6" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[15px] font-bold text-g900">{isNew ? '기획 입력' : '새 입력 저장'}</h3>
        <div className="ml-auto"><Segmented id="intake-mode" label="입력 모드" items={MODES} value={mode} onChange={setMode} disabled={locked} /></div>
      </div>
      <p className="mt-2 text-sm text-g500">{hint}{fe.mode ? <span className="ml-1 text-negative-ink">{fe.mode}</span> : null}</p>
      {c ? <p className="mt-1 text-xs text-g400">저장하면 새 버전이 활성 입력이 됩니다. 진행 중이던 검토는 이전 버전을 기준으로 끝나며, 새 버전의 결과로 바뀌지 않습니다.</p> : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field id="intake-title" label="제목" required error={fe.title} count={count(title)} max={300} hint={c ? '기존 기획의 제목은 그대로 둡니다.' : ''}>
          <input id="intake-title" type="text" className={inputCls} placeholder="예: 청람시 도서관 계약 검토" value={title} readOnly={!!c || locked} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!fe.title} />
        </Field>
        <TimeField id="intake-asof" label="기준 시각" required field={asOf} readOnly={locked} error={fe.as_of} hint="이 시각까지 확인된 자료만 근거로 씁니다." />
        <Field id="intake-question" label="기획 질문" required error={fe.question} count={count(question)} max={500} className="md:col-span-2">
          <input id="intake-question" type="text" className={inputCls} placeholder="예: 계약 경쟁 확대와 비용 절감 주장을 기사에 쓸 수 있는가" value={question} readOnly={locked} onChange={(e) => setQuestion(e.target.value)} aria-invalid={!!fe.question} />
        </Field>
        {mode === 'DRAFT_REVIEW' ? (
          <Field id="intake-draft" label="초안" required error={fe.draft} count={count(draft)} max={50000} className="md:col-span-2"
            hint="입력한 그대로 보존합니다. 맞춤법 교정이나 공백 정리를 하지 않습니다. 넘치면 나누어 검토합니다.">
            <textarea id="intake-draft" className={areaCls} rows={7} spellCheck={false} autoCorrect="off" autoCapitalize="off" placeholder="검토할 기사 초안이나 대본을 붙여 넣으세요." value={draft} readOnly={locked} onChange={(e) => setDraft(e.target.value)} aria-invalid={!!fe.draft}></textarea>
          </Field>
        ) : null}
      </div>

      {mode === 'SOURCE_REVIEW' ? (
        <fieldset className="mt-5">
          <legend className="text-sm text-g600">공개 원문과 출처 <span className="text-[11px] font-semibold text-brand">필수</span> <span className="text-xs text-g400">공개 원문이 하나 이상 있어야 합니다</span></legend>
          <div className="mt-2 space-y-3">
            {sources.map((s, i) => {
              const saved = prog.subs[s.uid];
              const se = subErr[s.uid];
              const sfe = se && se.error ? fieldErrors(se.error) : {};
              const meta = s.rights_class !== 'OPEN';
              return (
                <div key={s.uid} className={cx('rounded-xl border p-4', saved ? 'border-positive/40 bg-positive-bg/40' : 'border-g200 bg-g50/50')}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-sm font-bold text-g800">원문 {i + 1}</span>
                    {saved ? <span className="text-xs font-semibold text-positive-ink">등록됨</span> : null}
                    {!saved && sources.length > 1 ? (
                      <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-g500 hover:bg-g100" onClick={() => setSources((list) => list.filter((x) => x.uid !== s.uid))}>
                        <Trash2 className="size-3.5" aria-hidden="true" />빼기<span className="sr-only"> 원문 {i + 1}</span>
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field id={`${s.uid}-title`} label="자료 제목" required error={sfe.title}>
                      <input id={`${s.uid}-title`} type="text" className={inputCls} value={s.title} readOnly={!!saved} onChange={(e) => setSource(s.uid, 'title', e.target.value)} />
                    </Field>
                    <Field id={`${s.uid}-url`} label="출처 주소(HTTPS)" required error={sfe.source_url}>
                      <input id={`${s.uid}-url`} type="url" inputMode="url" className={inputCls} placeholder="https://" value={s.source_url} readOnly={!!saved} onChange={(e) => setSource(s.uid, 'source_url', e.target.value)} />
                    </Field>
                    <Field id={`${s.uid}-rec`} label="기록 시각" required error={sfe.recorded_at} hint="비워 두면 기준 시각을 씁니다.">
                      <input id={`${s.uid}-rec`} type="datetime-local" className={inputCls} value={s.recorded} readOnly={!!saved} onChange={(e) => setSource(s.uid, 'recorded', e.target.value)} />
                    </Field>
                    <Field id={`${s.uid}-rights`} label="권리" required error={sfe.rights_class} hint={meta ? '제목과 출처만 보관하고 원문은 받지 않습니다.' : ''}>
                      <Select id={`${s.uid}-rights`} value={s.rights_class} disabled={!!saved} onChange={(e) => setSource(s.uid, 'rights_class', e.target.value)}>
                        {RIGHTS_OPTIONS.map((r) => <option key={r} value={r}>{labelOr(L.RIGHTS, r)}</option>)}
                      </Select>
                    </Field>
                    <Field id={`${s.uid}-body`} label="원문" required={!meta} error={sfe.body} count={count(meta ? '' : s.body)} max={200000} className="md:col-span-2">
                      <textarea id={`${s.uid}-body`} className={areaCls} rows={3} spellCheck={false} disabled={meta} readOnly={!!saved} value={meta ? '' : s.body} onChange={(e) => setSource(s.uid, 'body', e.target.value)}></textarea>
                      {!demoOk && !saved && !meta ? (
                        <FetchFromUrl url={s.source_url}
                          onFill={(page) => setSources((list) => list.map((x) => (x.uid === s.uid ? { ...x, title: x.title || [...(page.title || '')].slice(0, 300).join(''), source_url: page.final_url || x.source_url, body: page.text, rights_class: 'OPEN' } : x)))}
                          onRecorded={(at) => { if (at) setSource(s.uid, 'recorded', toLocalInput(at)); }} />
                      ) : null}
                    </Field>
                  </div>
                  {se && se.net ? <div className="mt-3"><NetNote lost={se.net.lost} /></div> : null}
                  {se && se.error ? <div className="mt-3"><ApiError error={{ ...se.error, details: (se.error.details || []).filter((d) => !SOURCE_FIELDS.includes(d.field)) }} status={se.status} title={`원문 ${i + 1}을 등록하지 못했습니다`} /></div> : null}
                </div>
              );
            })}
          </div>
          {fe.submission_ids ? <p className="mt-2 text-xs text-negative-ink" role="alert">{fe.submission_ids}</p> : null}
          <Btn size="sm" icon={Plus} className="mt-3" onClick={() => setSources((list) => [...list, blankSource()])}>원문 추가</Btn>
        </fieldset>
      ) : null}
      {mode === 'QUESTION_ONLY' ? <Notice tone="mute" className="mt-5">초안과 자료 없이 질문으로 공개 자료를 찾아 근거를 정리합니다. 결과는 기획 요약이며, 문장별 판정은 만들지 않습니다.</Notice> : null}

      <details className="group mt-5 rounded-xl border border-g100 px-4 py-3">
        <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-g600"><Settings2 className="size-4 text-g400" aria-hidden="true" />세부 설정 <span className="text-xs text-g400">질의 {qb} · 자료 {sb}{partial ? ' · 부분 결과 허용' : ''}</span></summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id="intake-qb" label="질의 예산" error={fe['parameters.query_budget']} hint="1에서 20. 기본 10">
            <input id="intake-qb" type="number" inputMode="numeric" className={inputCls} value={qb} onChange={(e) => setQb(num(e.target.value))} />
          </Field>
          <Field id="intake-sb" label="자료 예산" error={fe['parameters.source_budget']} hint="1에서 50. 기본 20">
            <input id="intake-sb" type="number" inputMode="numeric" className={inputCls} value={sb} onChange={(e) => setSb(num(e.target.value))} />
          </Field>
        </div>
        <div className="mt-3"><Check2 id="intake-partial" checked={partial} onChange={(e) => setPartial(e.target.checked)}>일부 자료 수집이 실패해도 부분 결과를 받겠습니다</Check2></div>
      </details>

      {locked ? (
        <Notice tone="ok" role="status" className="mt-5" title={`입력을 저장했습니다${prog.reused ? ' (같은 요청을 이미 받은 적이 있어 그때의 결과를 돌려받았습니다)' : ''}`}>
          {!prog.done ? <p>받은 번호를 보관했습니다. 아래 단추를 다시 누르면 저장을 되풀이하지 않고 남은 단계부터 이어갑니다.</p> : null}
          <More><KV rows={[['기획', <IdLine key="c" v={prog.intake.case_id} />], ['질문 상태 버전', <IdLine key="s" v={prog.intake.state_version_id} />], ['초안 버전', <IdLine key="d" v={prog.intake.content_version_id} />]]} /></More>
        </Notice>
      ) : null}
      {err && err.net ? <div className="mt-4"><NetNote lost={err.net.lost} /></div> : null}
      {err && err.error ? (
        <div className="mt-4">
          <ApiError error={{ ...err.error, details: (err.error.details || []).filter((d) => !FORM_FIELDS.includes(d.field)) }}
            status={err.status} title={err.step === 'intake' ? '입력을 저장하지 못했습니다' : '근거 수집을 접수하지 못했습니다'} />
        </div>
      ) : null}
      {err && err.step === 'subs' && !err.net ? <Notice tone="warn" role="alert" className="mt-4">등록하지 못한 원문이 있습니다. 이미 등록된 원문은 그대로 두었습니다. 고친 뒤 다시 누르면 남은 원문만 등록합니다.</Notice> : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {demoOk && !locked ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1 font-semibold text-example"><Sparkles className="size-4" aria-hidden="true" />시연 자료 채우기</span>
            <LinkBtn onClick={fillDraft}>청람시 초안</LinkBtn>
            <LinkBtn onClick={fillSources}>청람시 자료(S1–S4)</LinkBtn>
            <LinkBtn onClick={fillQuestion}>질문만</LinkBtn>
          </p>
        ) : null}
        <span className="ml-auto text-xs text-g400">필수 정보 {filled}/{need.length}개 입력</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn kind="primary" size="lg" type="submit" icon={FilePlus2} busy={busy}>{locked ? '남은 단계 이어서 진행' : '저장하고 검토 시작'}</Btn>
        {locked && !prog.done ? <Btn size="lg" kind="ghost" onClick={restart}>새 입력으로 다시 쓰기</Btn> : null}
        {onCancel && !locked ? <Btn size="lg" kind="ghost" onClick={onCancel}>닫기</Btn> : null}
      </div>
    </form>
  );
}

function Versions({ c, versions }) {
  const head = c.head || {};
  return (
    <More label={`저장된 버전 · 질문 ${versions.states.length} · 본문 ${versions.contents.length}`}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 font-semibold text-g700">질문 상태</p>
          <ul className="space-y-1.5">
            {versions.states.map((s) => (
              <li key={s.id}>
                <b className="text-g800">v{s.version_number}</b>{head.state_version_id === s.id ? <span className="ml-1 text-brand">활성</span> : null} · {s.state.primary_editorial_question}
                <span className="block text-g500">{labelOr(L.STATE_REASON, s.reason)} · {whenShort(s.created_at)} · <IdLine v={s.id} /></span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 font-semibold text-g700">본문</p>
          {versions.contents.length === 0 ? <p>저장한 본문이 없습니다.</p> : (
            <ul className="space-y-1.5">
              {versions.contents.map((v) => (
                <li key={v.id}>
                  <b className="text-g800">v{v.version_number}</b>{head.content_version_id === v.id ? <span className="ml-1 text-brand">활성 초안</span> : null} · {v.origin === 'USER_INPUT' ? '사용자 초안' : '등록한 자료'} · {v.body === null ? '볼 수 없음' : `${count(v.body).toLocaleString('ko-KR')}자`}
                  <span className="block text-g500">{whenShort(v.created_at)} · SHA-256 {v.body_sha256.slice(0, 12)}… · <IdLine v={v.id} /></span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-g500">등록한 자료의 본문은 번호가 더 높아도 초안이 되지 않습니다. 활성 초안은 마지막으로 저장한 기획 입력이 정합니다.</p>
        </div>
      </div>
    </More>
  );
}

// on a case page: the saved input folded into one bar, the form on demand
export function InputSection() {
  const f = useCase();
  const route = useStore(app, (s) => s.route);
  const { c, head, state, draft, versions } = f;
  const knownMode = f.led && head.state_version_id ? f.led.modes[head.state_version_id] : null;
  const open = route.intakeOpen || !f.hasInput;
  return (
    <Section id="sec-input" n={1} title="기획 입력" desc="질문과 초안 또는 공개 자료를 저장하고, 저장한 그 버전으로 검토를 시작합니다.">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-g200 bg-white px-5 py-3.5 shadow-sm">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-g800">
            {f.hasInput ? <>입력 · {knownMode ? labelOr(L.MODE, knownMode) : draft ? '초안 검토' : '초안 없음'}{draft ? ` · 초안 v${draft.version_number}` : ''}{state ? ` · 질문 v${state.version_number}` : ''}</> : '아직 저장한 입력이 없습니다'}
          </p>
          {state ? <p className="mt-0.5 truncate text-xs text-g500">질문 · {state.state.primary_editorial_question} · 기준 {when(c.as_of)}</p> : null}
        </div>
        {f.hasInput && f.write ? (
          <LinkBtn tone={open ? 'gray' : 'brand'} onClick={() => go({ intakeOpen: !route.intakeOpen })} aria-expanded={open}>{open ? '닫기' : '초안 고치기 · 새 버전 저장'}</LinkBtn>
        ) : null}
      </div>
      {f.hasInput && f.versionsLoaded ? <Versions c={c} versions={versions} /> : null}
      {open && f.write && f.versionsLoaded ? <IntakeForm key={`${c.id}:${head.row_version || 0}`} c={c} versions={versions} onCancel={f.hasInput ? () => go({ intakeOpen: false }) : null} /> : null}
      {open && !f.write ? <Notice tone="mute">열람 권한에서는 기획을 저장하거나 검토를 시작할 수 없습니다.</Notice> : null}
    </Section>
  );
}

// the page for a new case: the same form, nothing else yet
export function NewCase() {
  const me = useMe();
  return (
    <>
      <div className="mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-bg px-3 py-1 text-xs font-semibold text-brand"><FilePlus2 className="size-3.5" aria-hidden="true" />1단계 · 기획 입력</span>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-g900">새 기획</h1>
        <p className="mt-1 text-sm text-g600">질문과 초안 또는 공개 자료를 넣으면, 공개 자료에서 근거를 모아 문장마다 대조합니다. 게재 판단은 사람이 합니다.</p>
      </div>
      {canWrite(me) ? <IntakeForm c={null} versions={{ contents: [], states: [] }} /> : <Notice tone="mute">열람 권한에서는 기획을 만들 수 없습니다.</Notice>}
    </>
  );
}
