// UI-02 실행 상태: 접수한 작업의 고정 입력, 단계, 상태, 경고, 결과.
/* global React */
import * as L from '../../labels.js';
import { app, useStore, go, navigate } from '../store.js';
import { useAction, pollNow, JOB, ACTIVE, resultRoute } from '../api.js';
import { St, Id, Pins, Btn, Warnings, NetNote, ApiError, ActionState, useMe, canWrite, cx, labelOr } from '../ui.jsx';
import { when, whenShort, short, clockTime, bytes } from '../time.js';

const { useState } = React;
const KINDS = ['execution', 'review', 'reassessment', 'search', 'export'];
const yes = (b) => (b ? '허용' : '허용 안 함');

function pinsFor(kind, d) {
  if (kind === 'execution') {
    return [
      { label: '입력 모드', text: labelOr(L.MODE, d.mode) },
      { label: '질문 상태 버전', id: d.state_version_id },
      { label: '초안 버전', text: d.content_version_id ? undefined : '없음', id: d.content_version_id || undefined },
      { label: '기준 근거 묶음', text: d.baseline_pack_id ? undefined : '없음(새로 수집)', id: d.baseline_pack_id || undefined },
      { label: '넣은 자료', text: `원문 ${d.submission_ids.length}건 · 취재 결과 ${d.reporting_result_ids.length}건` },
      { label: '기준 시각', text: when(d.as_of) },
      { label: '부분 결과', text: yes(d.allow_partial) },
      { label: '예산', text: `질의 ${d.parameters.query_budget} · 자료 ${d.parameters.source_budget}` },
    ];
  }
  if (kind === 'review') {
    return [
      { label: '초안 버전', id: d.content_version_id }, { label: '질문 상태 버전', id: d.state_version_id },
      { label: '근거 묶음', id: d.reality_pack_id }, { label: '기준 시각', text: when(d.as_of) }, { label: '부분 결과', text: yes(d.allow_partial) },
    ];
  }
  if (kind === 'reassessment') {
    return [
      { label: '기준 검토', id: d.baseline_review_id }, { label: '넣은 취재 결과', text: `${d.reporting_result_ids.length}건` },
      { label: '기준 시각', text: when(d.as_of) }, { label: '부분 결과', text: yes(d.allow_partial) },
    ];
  }
  if (kind === 'search') {
    return [
      { label: '기준 근거 묶음', id: d.baseline_pack_id }, { label: '질문', text: d.question }, { label: '기준 시각', text: when(d.as_of) },
      { label: '예산', text: `질의 ${d.parameters.query_budget} · 자료 ${d.parameters.source_budget}` },
    ];
  }
  return [
    { label: '출력 대상', text: d.input_kind === 'BRIEF' ? 'Brief' : '초안 검토', extra: short(d.input_id) },
    { label: '형식', text: d.format },
  ];
}

function outputsFor(kind, d) {
  if (kind === 'execution') return [d.result_pack_id ? { label: '만든 근거 묶음', id: d.result_pack_id } : null];
  if (kind === 'reassessment') {
    return [
      d.result_pack_id ? { label: '새 근거 묶음', id: d.result_pack_id } : null,
      d.result_review_id ? { label: '새 검토', id: d.result_review_id } : null,
      d.delta_id ? { label: '비교', id: d.delta_id } : null,
    ];
  }
  if (kind === 'search') return [{ label: '새 자료', text: `${d.new_submission_ids.length}건` }, { label: '후보 근거 묶음', text: d.candidate_pack_id ? undefined : '없음', id: d.candidate_pack_id || undefined }];
  if (kind === 'export') return [d.filename ? { label: '파일', text: d.filename } : null, d.size_bytes ? { label: '크기', text: bytes(d.size_bytes) } : null];
  return [d.completed_at ? { label: '판정', text: `${d.items.length}문장` } : null];
}

// The next step after a finished evidence run, with the IDs it actually returned.
function AfterExecution({ c, d }) {
  const me = useMe();
  const led = useStore(app, (s) => s.ledger[c.id]);
  const jobs = useStore(app, (s) => s.jobs);
  const a = useAction();
  const [ack, setAck] = useState(false);
  const partial = d.status === 'PARTIAL';
  if (!d.result_pack_id) return null;
  const write = canWrite(me);
  if (d.content_version_id) {
    const same = led ? led.review.map((id) => jobs[id] && jobs[id].data).filter((r) => r && r.reality_pack_id === d.result_pack_id && r.content_version_id === d.content_version_id) : [];
    const made = same.find((r) => r.status !== 'FAILED');
    if (made) return <Btn onClick={() => go({ tab: 'review', view: { kind: 'review', id: made.id }, sub: 'sheet' })}>이 근거로 한 초안 검토 열기</Btn>;
    if (!write) return <span className="muted">열람 권한에서는 검토를 시작할 수 없습니다.</span>;
    return (
      <div className="after">
        {partial ? <label className="check"><input type="checkbox" id={`ack-${d.id}`} checked={ack} onChange={(e) => setAck(e.target.checked)} /> 일부 자료가 빠진 부분 결과로 검토한다는 점을 확인했습니다</label> : null}
        {same.length ? <p className="muted">이 근거로 한 검토가 실패한 적이 있습니다. 실패한 결과는 그대로 두고 새로 시작합니다.</p> : null}
        <Btn kind="primary" busy={a.busy} disabled={partial && !ack}
          onClick={() => a.run('createDraftReview', { params: { case_id: c.id }, body: { content_version_id: d.content_version_id, state_version_id: d.state_version_id, reality_pack_id: d.result_pack_id, allow_partial: partial ? ack : false } })}>
          {same.length ? '초안 검토 다시 시작' : '이 근거 묶음으로 초안 검토 시작'}
        </Btn>
        <ActionState a={a} />
      </div>
    );
  }
  const briefId = led ? led.briefByPack[d.result_pack_id] : null;
  if (briefId) return <Btn onClick={() => go({ tab: 'review', view: { kind: 'brief', id: briefId }, sub: 'brief' })}>이 근거로 만든 Brief 열기</Btn>;
  if (!write) return <span className="muted">열람 권한에서는 Brief를 만들 수 없습니다.</span>;
  return (
    <div className="after">
      {partial ? <label className="check"><input type="checkbox" id={`ack-${d.id}`} checked={ack} onChange={(e) => setAck(e.target.checked)} /> 일부 자료가 빠진 부분 결과로 만든다는 점을 확인했습니다</label> : null}
      <Btn kind="primary" busy={a.busy} disabled={partial && !ack}
        onClick={() => a.run('createEditorialBrief', {
          params: { case_id: c.id }, body: { state_version_id: d.state_version_id, reality_pack_id: d.result_pack_id, content_version_id: null, allow_partial: partial ? ack : false },
          onOk: (res) => go({ tab: 'review', view: { kind: 'brief', id: res.data.brief.id }, sub: 'brief' }),
        })}>
        이 근거 묶음으로 Brief 만들기
      </Btn>
      <ActionState a={a} />
    </div>
  );
}

function Job({ c, kind, id, entry, corr }) {
  const d = entry && entry.data;
  if (!d) {
    return (
      <article className="job">
        <div className="job-h"><h3>{JOB[kind].label}</h3><span className="muted">{entry && entry.gone ? '이 범위에서 찾을 수 없습니다' : '상태를 확인하는 중'}</span><Id v={id} /></div>
      </article>
    );
  }
  const done = !ACTIVE.has(d.status);
  const branch = (d.warnings || []).some((w) => w.code === 'BRANCH_ONLY');
  const headed = kind === 'execution' || kind === 'reassessment' ? d.head_updated : null;
  return (
    <article className={cx('job', !done && 'job-live')}>
      <div className="job-h">
        <h3>{JOB[kind].label}</h3>
        <St kind="job" code={d.status} />
        {d.stage ? <span className="stage">단계: {labelOr(L.STAGE, d.stage)} <code>{d.stage}</code></span> : null}
        <span className="muted">접수 {whenShort(d.created_at)}{d.completed_at ? ` · 끝 ${whenShort(d.completed_at)}` : ''}</span>
      </div>
      <div className="job-b">
        <div>
          <p className="job-l">고정한 입력</p>
          <Pins items={pinsFor(kind, d)} />
        </div>
        <div>
          <p className="job-l">결과</p>
          {done ? <Pins items={outputsFor(kind, d)} /> : <p className="muted">끝나면 실제 결과 ID가 여기에 나옵니다.</p>}
          {d.error_code ? <p className="off">오류 코드 <code>{d.error_code}</code></p> : null}
          <Warnings items={d.warnings} compact />
          {done && headed === true ? <p className="muted">활성 결과로 반영했습니다.</p> : null}
          {done && (headed === false || branch) && d.status !== 'FAILED' ? (
            <p className="note tone-warn">정상적으로 끝난 결과이지만 지금 활성 결과는 아닙니다. 그사이 활성 입력이나 결과가 바뀌어 별도 가지로 보존했습니다. 자동으로 합치지 않습니다.</p>
          ) : null}
          {done && kind === 'execution' ? <AfterExecution c={c} d={d} /> : null}
          {done && kind !== 'execution' && d.status !== 'FAILED' && d.status !== 'BLOCKED' ? (
            <p><Btn onClick={() => navigate(resultRoute(kind, c.id, d))}>결과 열기</Btn>
              {kind === 'reassessment' && d.result_review_id ? <> <Btn kind="ghost" onClick={() => go({ tab: 'review', view: { kind: 'review', id: d.result_review_id }, sub: 'sheet' })}>새 검토 열기</Btn></> : null}</p>
          ) : null}
        </div>
        <div>
          <p className="job-l">확인</p>
          <Pins items={[
            { label: JOB[kind].label, id: d.id },
            d.job_id ? { label: '작업', id: d.job_id } : null,
            { label: '추적 번호', text: corr ? undefined : '기록 없음', id: corr || undefined },
            { label: '마지막 확인', text: clockTime(entry.checkedAt) },
          ]} />
        </div>
      </div>
    </article>
  );
}

export function StatusScreen({ c }) {
  const led = useStore(app, (s) => s.ledger[c.id]);
  const jobs = useStore(app, (s) => s.jobs);
  const watch = useStore(app, (s) => s.watch);
  const rows = [];
  if (led) KINDS.forEach((kind) => led[kind].forEach((id, idx) => rows.push({ kind, id, idx, entry: jobs[id] })));
  // a job not read yet was just submitted, so it goes on top
  const t = (r) => (r.entry && r.entry.data && r.entry.data.created_at) || '9999';
  // newest first; equal times fall back to the order the browser learned them
  rows.sort((a, b) => t(b).localeCompare(t(a)) || KINDS.indexOf(b.kind) - KINDS.indexOf(a.kind) || b.idx - a.idx);
  const live = rows.filter((r) => r.entry && r.entry.data && ACTIVE.has(r.entry.data.status)).length;
  return (
    <div className="screen">
      <div className="screen-top">
        <h2>실행 상태 <span className="count">{rows.length}</span></h2>
        <Btn onClick={() => pollNow(true)}>지금 다시 확인</Btn>
      </div>
      <p className="lede">접수한 작업이 어떤 입력에 고정되어 어디까지 갔는지 봅니다. 끝난 작업은 실제로 만들어진 결과로 이어집니다.</p>
      <p className="pollbar" role="status">
        <span>진행 중 {live}건</span>
        <span>{live ? `${Math.round(watch.interval / 100) / 10}초마다 확인` : '진행 중인 작업이 없어 확인을 쉬고 있습니다'}</span>
        <span>마지막 확인 {clockTime(watch.lastAt)}</span>
        {watch.paused && live ? <span>화면이 가려져 있어 확인을 멈췄습니다. 돌아오면 바로 한 번 확인합니다.</span> : null}
      </p>
      {watch.failing ? (
        watch.problem
          ? <ApiError error={watch.problem} status="" title="상태를 확인하지 못했습니다" />
          : <NetNote at={watch.lastAt} onRetry={() => pollNow(true)} />
      ) : null}
      {rows.length === 0 ? <p className="empty">이 기획에서 실행한 작업이 아직 없습니다. 기획 입력에서 검토를 시작하면 여기에 나타납니다.</p> : null}
      <div className="jobs">
        {rows.map((r) => <Job key={r.id} c={c} kind={r.kind} id={r.id} entry={r.entry} corr={led.corr[r.id]} />)}
      </div>
      <p className="foot">확인 간격은 화면 권장값입니다. 서버와 통신이 끊겨도 작업을 실패로 바꾸지 않고, 마지막으로 확인한 상태를 그대로 둡니다.</p>
    </div>
  );
}
