// UI-08 변경과 검색: 알림, 정정 피드, 모니터링 정책, 수동 공개 자료 검색.
/* global React */
import * as L from '../../labels.js';
import { app, useStore, go, bump } from '../store.js';
import { api, useQuery, useAction, fieldErrors, NetError } from '../api.js';
import { St, Id, Pins, Btn, Field, TimeField, useClockField, Warnings, QueryState, Empty, ActionState, NetNote, useMe, canWrite, cx, labelOr, useReveal } from '../ui.jsx';
import { when, whenShort, short, count } from '../time.js';
import { claimMap } from './review.jsx';

const { useState } = React;
const OPEN_Q = ['OPEN', 'PARTIALLY_RESOLVED', 'CONFLICTED'];

// ---------------------------------------------------------------- 알림
function Notifications({ c, notes, feed }) {
  const me = useMe();
  const [busy, setBusy] = useState(null);
  const [net, setNet] = useState(false);
  const runs = feed ? feed.runs : [];
  const target = (n) => runs.find((r) => r.changes.includes(n.change_id)) || null;
  const openNote = async (n) => {
    setBusy(n.id); setNet(false);
    try {
      if (!n.read_at) await api('markNotificationRead', { params: { case_id: c.id, notification_id: n.id }, body: { read: true } });
      bump();
      const r = target(n);
      if (r && r.delta_id) go({ tab: 'compare', deltaId: r.delta_id });
      else if (r && r.result_brief_id) go({ tab: 'review', view: { kind: 'brief', id: r.result_brief_id }, sub: 'brief' });
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setNet(true);
    } finally { setBusy(null); }
  };
  if (!notes.length) return <p className="empty">알림이 없습니다. 출처가 정정되어 판정이 달라지면 여기에 나타납니다.</p>;
  return (
    <>
      {net ? <NetNote lost /> : null}
      <div className="scroll-x">
        <table className="grid">
          <thead><tr><th scope="col">중요도</th><th scope="col">내용</th><th scope="col">생긴 시각</th><th scope="col">{me ? me.name : '나'}의 읽음</th><th scope="col"><span className="sr">열기</span></th></tr></thead>
          <tbody>
            {notes.map((n) => {
              const r = target(n);
              return (
                <tr key={n.id} className={cx(!n.read_at && 'row-on')}>
                  <td><span className="chip chip-warn">{n.priority}</span></td>
                  <td><span className={cx(!n.read_at && 'strong')}>{n.title}</span><br /><span className="muted">{labelOr(L.CHANGE_TYPE, n.change_type)} <code>{n.change_type}</code></span></td>
                  <td>{whenShort(n.created_at)}</td>
                  <td>{n.read_at ? `읽음 ${whenShort(n.read_at)}` : <b>읽지 않음</b>}</td>
                  <td><Btn busy={busy === n.id} onClick={() => openNote(n)}>{r && (r.delta_id || r.result_brief_id) ? '달라진 내용 보기' : '읽음으로 기록'}</Btn></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="foot">읽음은 사람마다 따로 기록됩니다. 열람 권한도 자기 읽음은 남길 수 있습니다. 알림은 이 화면 안에서만 보이며 바깥으로 메시지를 보내지 않습니다.</p>
    </>
  );
}

// ---------------------------------------------------------------- 정정 피드
function Feed({ feed, claims }) {
  if (!feed.changes.length && !feed.runs.length) return <p className="empty">확인된 출처 변경이 없습니다.</p>;
  const why = (list) => list.map((x) => x.reason).filter(Boolean).join(', ');
  return (
    <>
      {feed.changes.length ? (
        <div className="scroll-x">
          <table className="grid">
            <thead><tr><th scope="col">변화</th><th scope="col">확인한 시각</th><th scope="col">출처와 원문 버전</th><th scope="col">관련 근거 진술</th></tr></thead>
            <tbody>
              {feed.changes.map((x) => (
                <tr key={x.id}>
                  <td><span className="chip chip-warn">{x.priority}</span> {labelOr(L.CHANGE_TYPE, x.change_type)} <code>{x.change_type}</code></td>
                  <td>{whenShort(x.detected_at)}</td>
                  <td>출처 <Id v={x.source_id} /><br />원문 버전 <Id v={x.before_revision_id} /> → <Id v={x.after_revision_id} /></td>
                  <td>{x.claim_ids.map((id) => <span key={id} className="v-qi">{claims[id] ? claims[id].text : short(id)}{claims[id] && claims[id].superseded ? ' (정정 이전 기록)' : ''}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <h4>수집 주기 기록 <span className="count">{feed.runs.length}</span></h4>
      {feed.runs.length === 0 ? <Empty /> : (
        <div className="scroll-x">
          <table className="grid grid-wide">
            <thead><tr><th scope="col">시작</th><th scope="col">상태</th><th scope="col">사용량</th><th scope="col">다시 본 것</th><th scope="col">그대로 둔 것</th><th scope="col">예산으로 미룬 것</th><th scope="col">막힌 것</th><th scope="col">결과</th></tr></thead>
            <tbody>
              {feed.runs.map((r) => (
                <tr key={r.id}>
                  <td>{whenShort(r.started_at)}</td>
                  <td><St kind="job" code={r.status} small /></td>
                  <td className="num">질의 {r.query_used} · 자료 {r.source_used}</td>
                  <td className="num">{r.selected.length}</td>
                  <td className="num">{r.unchanged.length}</td>
                  <td className="num">{r.deferred.length}{r.deferred.length ? ` (${why(r.deferred) || '예산'})` : ''}</td>
                  <td className="num">{r.blocked.length}{r.blocked.length ? ` (${why(r.blocked) || '권한·무결성'})` : ''}</td>
                  <td>{r.changes.length === 0 ? <span className="muted">변경 없음</span> : null}
                    {r.delta_id ? <button type="button" className="link" onClick={() => go({ tab: 'compare', deltaId: r.delta_id })}>비교 보기</button> : null}
                    {r.result_brief_id ? <button type="button" className="link" onClick={() => go({ tab: 'review', view: { kind: 'brief', id: r.result_brief_id }, sub: 'brief' })}>새 Brief 보기</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="foot">정정으로 달라진 출처에 기대는 판정만 다시 봅니다. 예산 때문에 미룬 것과 권한·무결성 때문에 막힌 것은 서로 다른 이유로 따로 셉니다. 재게시나 검색 누락만으로 상충이나 해소를 만들지 않습니다.</p>
    </>
  );
}

// ---------------------------------------------------------------- 모니터링 정책
function Policy({ c, data }) {
  const me = useMe();
  const a = useAction();
  const [f, setF] = useState(null);
  const p = f || data.policy;
  const fe = fieldErrors(a.error);
  const set = (k, v) => setF({ ...p, [k]: v });
  const num = (v) => (v === '' ? '' : Number(v));
  if (!data.environment_enabled) {
    return (
      <div className="note tone-info">
        <p className="note-h">이 환경에서는 모니터링이 꺼져 있습니다</p>
        <p>출처를 주기적으로 다시 확인하는 기능은 환경 설정으로 켜는 것이며, 이 화면이 대신 켜 달라고 요청하지 않습니다. 아래의 수동 검색은 그대로 쓸 수 있습니다.</p>
        <p className="muted">켜졌을 때의 기본값: 주기 {data.policy.cadence_minutes}분 · 질의 예산 {data.policy.query_budget} · 자료 예산 {data.policy.source_budget}</p>
      </div>
    );
  }
  const write = canWrite(me);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); a.run('setMonitoringPolicy', { params: { case_id: c.id }, body: p, onOk: () => setF(null) }); }} noValidate>
      <label className="check"><input type="checkbox" id="mon-on" disabled={!write} checked={!!p.monitoring_enabled} onChange={(e) => set('monitoring_enabled', e.target.checked)} /> 이 기획의 출처를 주기적으로 다시 확인</label>
      <div className="form-grid form-grid-3">
        <Field id="mon-cadence" label="확인 주기(분)" error={fe.cadence_minutes} hint="60에서 10080">
          <input id="mon-cadence" type="number" inputMode="numeric" disabled={!write} value={p.cadence_minutes} onChange={(e) => set('cadence_minutes', num(e.target.value))} />
        </Field>
        <Field id="mon-q" label="질의 예산" error={fe.query_budget} hint="5에서 50">
          <input id="mon-q" type="number" inputMode="numeric" disabled={!write} value={p.query_budget} onChange={(e) => set('query_budget', num(e.target.value))} />
        </Field>
        <Field id="mon-s" label="자료 예산" error={fe.source_budget} hint="1에서 200">
          <input id="mon-s" type="number" inputMode="numeric" disabled={!write} value={p.source_budget} onChange={(e) => set('source_budget', num(e.target.value))} />
        </Field>
      </div>
      <ActionState a={a} fields={['cadence_minutes', 'query_budget', 'source_budget']} />
      {a.ok ? <p className="note tone-ok" role="status">정책을 저장했습니다.</p> : null}
      {write ? <div className="form-foot"><Btn kind="primary" type="submit" busy={a.busy}>정책 저장</Btn></div> : <p className="muted">열람 권한에서는 정책을 바꿀 수 없습니다.</p>}
    </form>
  );
}

// ---------------------------------------------------------------- 수동 검색
function SearchForm({ c, view }) {
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
  if (!open.length) return <p className="empty">지금 보는 결과에 남은 질문이 없습니다.</p>;
  const submit = () => a.run('createResearchSearch', {
    params: { case_id: c.id },
    body: { baseline_pack_id: view.reality_pack_id, question_id: qid, question, as_of: asOf.iso, parameters: { query_budget: qb, source_budget: sb, language: 'ko' } },
    // the record and its detail appear below the form; show them without taking focus
    onOk: (res) => go({ searchId: res.data.search_id, reveal: { kind: 'search', id: res.data.search_id, soft: true } }),
  });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <Pins items={[{ label: '기준 근거 묶음', id: view.reality_pack_id }, { label: '보는 결과의 기준 시각', text: when(view.as_of) }]} />
      <Field id="srch-q" label="다시 찾을 질문" required error={fe.question_id} hint="지금 활성 결과에서 아직 풀리지 않은 질문만 고를 수 있습니다.">
        <select id="srch-q" value={qid} onChange={(e) => { setQid(e.target.value); setText(null); }}>
          {open.map((x) => <option key={x.id} value={x.id}>{x.question_key} {x.question} · {labelOr(L.QUESTION_STATUS, qa[x.id].status)}</option>)}
        </select>
      </Field>
      <Field id="srch-text" label="검색에 쓸 질문 문장" required error={fe.question} count={count(question)} max={2000}>
        <input id="srch-text" type="text" value={question} onChange={(e) => setText(e.target.value)} aria-invalid={!!fe.question} />
      </Field>
      <div className="form-grid form-grid-3">
        <Field id="srch-qb" label="질의 예산" error={fe['parameters.query_budget']} hint="1에서 20. 기본 10">
          <input id="srch-qb" type="number" inputMode="numeric" value={qb} onChange={(e) => setQb(num(e.target.value))} />
        </Field>
        <Field id="srch-sb" label="자료 예산" error={fe['parameters.source_budget']} hint="1에서 50. 기본 20">
          <input id="srch-sb" type="number" inputMode="numeric" value={sb} onChange={(e) => setSb(num(e.target.value))} />
        </Field>
        <TimeField id="srch-asof" label="기준 시각" required field={asOf} error={fe.as_of} />
      </div>
      <ActionState a={a} fields={['question_id', 'question', 'parameters.query_budget', 'parameters.source_budget', 'as_of']} />
      <div className="form-foot"><Btn kind="primary" type="submit" busy={a.busy}>검색 제출</Btn></div>
    </form>
  );
}

const READING = {
  QUEUED: ['info', '검색을 접수했습니다.'],
  RUNNING: ['info', '공개 자료를 찾고 있습니다.'],
};
function reading(s) {
  if (READING[s.status]) return READING[s.status];
  const found = s.new_submission_ids.length;
  if (s.status === 'COMPLETED' && found === 0) return ['info', '검색은 끝까지 마쳤고 관련 자료는 0건입니다. 질문은 풀리지 않은 채로 남습니다. 0건은 질문이 풀렸다는 근거가 아닙니다.'];
  if (s.status === 'COMPLETED') return ['ok', `새 자료 ${found}건을 찾았습니다. 원문과 구간을 확인한 뒤 재검토에 넣을 자료를 고릅니다. 질문 평가는 후속 검토에서만 바뀝니다.`];
  if (s.status === 'PARTIAL') return ['warn', '일부 채널이 실패해 확인한 범위가 좁습니다. 실패한 채널에 자료가 있을 수 있으므로 공백이 풀린 것으로 보지 않습니다.'];
  if (s.status === 'FAILED') return ['bad', '모든 채널이 실패했습니다. 검색을 하지 못한 것이며 자료가 없다는 뜻이 아닙니다. 기존 결과는 그대로입니다.'];
  return ['info', ''];
}

function SearchDetail({ s, corr }) {
  const [tone, text] = reading(s);
  const [headRef] = useReveal('search', s.id, 'start');
  const ch = (list) => (list.length ? list.map((x) => labelOr(L.CHANNEL, x)).join(', ') : '없음');
  return (
    <div className="detail">
      <div className="viewhead-t"><h4 ref={headRef} tabIndex={-1} className="landing">{s.question}</h4><St kind="job" code={s.status} /></div>
      <p className={`note tone-${tone}`} role="status">{text}</p>
      <Warnings items={s.warnings} />
      {s.error_code ? <p className="muted">오류 코드 <code>{s.error_code}</code></p> : null}
      <Pins items={[
        { label: '검색', id: s.id }, { label: '기준 근거 묶음', id: s.baseline_pack_id }, { label: '질문', id: s.question_id },
        { label: '기준 시각', text: when(s.as_of) }, { label: '접수', text: when(s.created_at) }, s.completed_at ? { label: '끝난 시각', text: when(s.completed_at) } : null,
        { label: '추적 번호', text: corr ? undefined : '기록 없음', id: corr || undefined },
      ]} />
      <div className="form-grid">
        <div>
          <h5>검색 계획</h5>
          <ul className="plain">{s.plan.map((pl, i) => <li key={i}><span className="lbl">{labelOr(L.PURPOSE, pl.purpose)}</span>{pl.query}</li>)}</ul>
          <h5>확인한 범위</h5>
          <dl className="kv">
            <dt>계획한 채널</dt><dd>{ch(s.coverage.planned_channels)}</dd>
            <dt>끝낸 채널</dt><dd>{ch(s.coverage.completed_channels)}</dd>
            <dt>실패한 채널</dt><dd className={cx(s.coverage.failed_channels.length && 'off')}>{ch(s.coverage.failed_channels)}</dd>
            <dt>예산으로 미룬 자료</dt><dd>{s.coverage.deferred_source_count}건</dd>
          </dl>
        </div>
        <div>
          <h5>누적 사용량</h5>
          <dl className="kv">
            <dt>질의</dt><dd className="num">{s.query_used} / {s.parameters.query_budget}</dd>
            <dt>자료</dt><dd className="num">{s.source_used} / {s.parameters.source_budget}</dd>
            <dt>언어</dt><dd>{s.parameters.language}</dd>
          </dl>
          <h5>찾은 자료</h5>
          <dl className="kv">
            <dt>새 자료</dt><dd>{s.new_submission_ids.length}건</dd>
            <dt>후보 근거 묶음</dt><dd>{s.candidate_pack_id ? <Id v={s.candidate_pack_id} /> : '없음'}</dd>
          </dl>
        </div>
      </div>
      <p className="foot">검색 결과의 요약문은 근거가 아닙니다. 원문 전체와 구간을 받아 근거 검증을 거친 것만 근거가 됩니다. 검색이 초안 검토를 스스로 바꾸지 않습니다.</p>
      {s.status === 'COMPLETED' || s.status === 'PARTIAL' ? (
        <div className="form-foot">
          {s.new_submission_ids.length ? <Btn kind="primary" onClick={() => go({ tab: 'results' })}>재검토에 넣을 자료 고르기</Btn> : <Btn onClick={() => go({ tab: 'tasks' })}>사람의 취재로 넘기기</Btn>}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- screen
export function ChangesScreen({ c }) {
  const me = useMe();
  const route = useStore(app, (s) => s.route);
  const led = useStore(app, (s) => s.ledger[c.id]);
  const jobs = useStore(app, (s) => s.jobs);
  const p = { case_id: c.id };
  const notes = useQuery('listNotifications', p);
  const feed = useQuery('getMonitoringFeed', p);
  const policy = useQuery('getMonitoringPolicy', p);
  const head = c.head || {};
  const board = useQuery('getRealityBoard', { ...p, pack_id: head.pack_id || '' }, !!head.pack_id);
  const viewId = head.review_id || (led && head.pack_id ? led.briefByPack[head.pack_id] : null);
  const view = viewId && jobs[viewId] ? jobs[viewId].data : null;
  const searches = led ? led.search.map((id) => jobs[id] && jobs[id].data).filter(Boolean) : [];
  const sel = searches.find((s) => s.id === route.searchId) || searches[searches.length - 1] || null;
  const unread = notes.data ? notes.data.items.filter((n) => !n.read_at).length : 0;
  return (
    <div className="screen">
      <div className="screen-top"><h2>변경과 검색</h2></div>
      <p className="lede">출처가 정정됐는지 확인하고, 아직 풀리지 않은 질문을 공개 자료에서 다시 찾습니다.</p>
      <section>
        <h3>알림 <span className="count">{notes.data ? notes.data.items.length : 0}</span>{unread ? <span className="chip chip-warn">읽지 않음 {unread}</span> : null}</h3>
        <QueryState q={notes} what="알림" />
        {notes.data ? <Notifications c={c} notes={notes.data.items} feed={feed.data} /> : null}
      </section>
      <section>
        <h3>출처 정정 피드</h3>
        <QueryState q={feed} what="변경 피드" />
        {feed.data ? <Feed feed={feed.data} claims={claimMap(board.data)} /> : null}
      </section>
      <section>
        <h3>모니터링 정책</h3>
        <QueryState q={policy} what="모니터링 정책" />
        {policy.data ? <Policy c={c} data={policy.data} /> : null}
      </section>
      <section>
        <h3>공개 자료 다시 찾기</h3>
        <p className="foot">남은 질문 하나와 기준 근거 묶음, 기준 시각, 예산을 고정해 한 번 검색합니다. 모니터링이 꺼져 있어도 쓸 수 있습니다.</p>
        {!canWrite(me) ? <p className="muted">열람 권한에서는 검색을 제출할 수 없습니다.</p> : null}
        {canWrite(me) && view && view.questions ? <SearchForm key={view.id} c={c} view={view} /> : null}
        {canWrite(me) && !view ? <p className="empty">검색의 기준으로 삼을 활성 결과가 아직 없습니다.</p> : null}
        <h4>검색 기록 <span className="count">{searches.length}</span></h4>
        {searches.length === 0 ? <p className="empty">이 기획에서 제출한 검색이 아직 없습니다.</p> : (
          <div className="scroll-x">
            <table className="grid grid-wide">
              <thead><tr><th scope="col">질문</th><th scope="col">상태</th><th scope="col">실패한 채널</th><th scope="col">사용량</th><th scope="col">새 자료</th><th scope="col">접수</th></tr></thead>
              <tbody>
                {searches.map((s) => (
                  <tr key={s.id} className={cx(sel && sel.id === s.id && 'row-on')}>
                    <td><button type="button" className="link strong" aria-current={sel && sel.id === s.id ? 'true' : undefined} onClick={() => go({ searchId: s.id })}>{s.question}</button></td>
                    <td><St kind="job" code={s.status} small /></td>
                    <td>{s.coverage.failed_channels.length ? s.coverage.failed_channels.map((x) => labelOr(L.CHANNEL, x)).join(', ') : '없음'}</td>
                    <td className="num">질의 {s.query_used}/{s.parameters.query_budget} · 자료 {s.source_used}/{s.parameters.source_budget}</td>
                    <td className="num">{s.new_submission_ids.length}건</td>
                    <td>{whenShort(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sel ? <SearchDetail s={sel} corr={led ? led.corr[sel.id] : null} /> : null}
      </section>
    </div>
  );
}
