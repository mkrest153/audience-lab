// 2단계 근거 수집: 근거 실행의 진행, 근거 판(말할 수 있는 것·서로 다른 것·아직 모르는 것·출처),
// 그리고 이 근거로 초안 검토나 기획 요약을 시작하는 단추.
import { useState } from 'react';
import { Quote, ExternalLink, Play, FileText, ListPlus, Check } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, go, openPanel } from '../app/store.js';
import { useQuery, useAction } from '../app/api.js';
import { Status } from '../ui/status.jsx';
import { Section, Btn, Notice, More, KV, IdLine, Tag, Empty, QueryState, ActionState, Check2, Warnings, cx, labelOr } from '../ui/kit.jsx';
import { when, whenShort } from '../app/time.js';
import { useCase, isDone } from './facts.js';
import { claimMap, EvidenceLine, uniq } from './shared.jsx';
import { JobProgress, JobFailed, JobIds, BranchNote } from './jobs.jsx';

// ---------------------------------------------------------------- the board
function Tile({ label, n, tone, on, onClick, sub }) {
  const color = { pos: 'text-positive', warn: 'text-warning', mute: 'text-g700', brand: 'text-brand' }[tone];
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cx('rounded-2xl border bg-white p-4 text-left transition', on ? 'border-brand ring-2 ring-brand/15' : 'border-g200 hover:border-g300')}>
      <p className="text-sm text-g600">{label}</p>
      <p className={cx('num mt-1 text-3xl font-bold', n ? color : 'text-g300')}>{n}</p>
      {sub ? <p className="mt-1 text-xs text-g500">{sub}</p> : null}
    </button>
  );
}

export function Board({ board, caseId, onPick, picked }) {
  const [tab, setTab] = useState('know');
  const claims = claimMap(board);
  const open = (title, sup, con, focus) => openPanel({
    caseId, packId: board.pack.id, title, focus,
    groups: [{ label: '뒷받침하는 근거', tone: 'ok', claimIds: sup }, { label: '반박하는 근거', tone: 'bad', claimIds: con }],
  });
  const srcTitle = (key) => { const s = board.sources.find((x) => x.key === key); return s ? s.title : key; };
  const used = board.sources.filter((s) => s.included).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="지금 말할 수 있는 것" n={board.what_we_know.length} tone="pos" on={tab === 'know'} onClick={() => setTab('know')} />
        <Tile label="서로 다른 것" n={board.what_is_disputed.length} tone="warn" on={tab === 'disputed'} onClick={() => setTab('disputed')} />
        <Tile label="아직 모르는 것" n={board.what_remains_unknown.length} tone="mute" on={tab === 'unknown'} onClick={() => setTab('unknown')} />
        <Tile label="출처" n={board.sources.length} tone="brand" on={tab === 'sources'} onClick={() => setTab('sources')} sub={`근거에 반영 ${used}건`} />
      </div>
      <div role="region" aria-label="근거 판 내용" className="rounded-2xl border border-g200 bg-white p-5 shadow-sm">
        {tab === 'know' ? (
          <>
            <h3 className="text-[15px] font-bold text-g900">지금 말할 수 있는 것</h3>
            <p className="mt-0.5 text-xs text-g500">저장된 진술이라고 해서 사실로 확정된 것은 아닙니다. 기관이 그렇게 말했다는 기록과 실제로 그러한지는 따로 봅니다.</p>
            {board.what_we_know.length === 0 ? <div className="mt-3"><Empty /></div> : (
              <ul className="mt-3 space-y-2">
                {board.what_we_know.map((k) => (
                  <li key={k.claim_id} className="flex flex-wrap items-start gap-3 rounded-xl border border-g100 p-3.5">
                    <span className="num rounded-md bg-g100 px-1.5 py-0.5 text-xs font-bold text-g600">{k.key}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-relaxed text-g900">{k.text}</p>
                      <p className="mt-1 text-xs text-g500">{srcTitle(k.source_key)} · {labelOr(L.EPISTEMIC, k.epistemic_status)} · 독립 출처 {k.independent_source_groups}묶음</p>
                    </div>
                    <Btn size="sm" kind="soft" icon={Quote} onClick={() => open(k.text, [k.claim_id], [], k.claim_id)}>원문<span className="sr-only"> 보기: {k.text}</span></Btn>
                  </li>
                ))}
              </ul>
            )}
            {board.history.length ? (
              <More className="mt-3" label={`정정 이전 기록 ${board.history.length}건`}>
                <ul className="space-y-1">{board.history.map((h) => <EvidenceLine key={h.claim_id} id={h.claim_id} claims={claims} onOpen={(id) => open('정정 이전 기록', [id], [], id)} muted />)}</ul>
                <p className="mt-2">출처가 정정한 뒤에도 과거 기록은 지우지 않습니다. 지금 판정의 뒷받침에서만 뺍니다.</p>
              </More>
            ) : null}
          </>
        ) : null}
        {tab === 'disputed' ? (
          <>
            <h3 className="text-[15px] font-bold text-g900">서로 다른 것</h3>
            <p className="mt-0.5 text-xs text-g500">같은 대상을 출처마다 다르게 설명한 곳입니다. 어느 쪽이 맞는지 정하지 않고 취재로 넘깁니다.</p>
            {board.what_is_disputed.length === 0 ? <div className="mt-3"><Empty /></div> : (
              <div className="mt-3 space-y-3">
                {board.what_is_disputed.map((x) => (
                  <div key={x.conflict_id} className="rounded-xl border border-g200 p-4">
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="num rounded-md bg-warning-bg px-1.5 py-0.5 text-xs font-bold text-warning-ink">{x.key}</span>
                      <p className="min-w-0 flex-1 text-sm font-semibold text-g900">{x.question}</p>
                      <Status kind="question" code="CONFLICTED" />
                    </div>
                    <p className="mt-2 text-sm text-g600">{x.reason_unresolved}</p>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="mb-1.5 text-sm font-semibold text-positive-ink">한쪽 근거</p>
                        <ul className="space-y-1">{x.supporting_claim_ids.map((id) => <EvidenceLine key={id} id={id} claims={claims} onOpen={(cid) => open(x.question, x.supporting_claim_ids, x.contradicting_claim_ids, cid)} />)}</ul>
                      </div>
                      <div>
                        <p className="mb-1.5 text-sm font-semibold text-negative-ink">다른 쪽 근거</p>
                        <ul className="space-y-1">{x.contradicting_claim_ids.map((id) => <EvidenceLine key={id} id={id} claims={claims} onOpen={(cid) => open(x.question, x.supporting_claim_ids, x.contradicting_claim_ids, cid)} />)}</ul>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {board.resolved_conflicts.length ? (
              <p className="mt-3 text-xs text-g500">정정으로 정리된 상충 {board.resolved_conflicts.length}건: {board.resolved_conflicts.map((x) => x.question).join(', ')}. 이전 버전에서는 여전히 상충으로 남아 있습니다.</p>
            ) : null}
          </>
        ) : null}
        {tab === 'unknown' ? (
          <>
            <h3 className="text-[15px] font-bold text-g900">아직 모르는 것</h3>
            <p className="mt-0.5 text-xs text-g500">근거가 없어 판단을 미룬 질문입니다. 연결된 원문이 없으니 필요한 자료를 과제로 넘기거나 공개 자료를 다시 찾습니다.</p>
            {board.what_remains_unknown.length === 0 ? <div className="mt-3"><Empty /></div> : (
              <div className="mt-3 space-y-3">
                {board.what_remains_unknown.map((u) => {
                  const on = picked && picked.includes(u.unknown_id);
                  return (
                    <div key={u.unknown_id} className="rounded-xl border border-g200 p-4">
                      <div className="flex flex-wrap items-start gap-2">
                        <span className="num rounded-md bg-g100 px-1.5 py-0.5 text-xs font-bold text-g600">{u.key}</span>
                        <p className="min-w-0 flex-1 text-sm font-semibold text-g900">{u.question}</p>
                      </div>
                      <KV className="mt-2 text-sm" rows={[['왜 중요한가', u.why_important], ['필요한 자료', u.needed_evidence]]} />
                      <p className="mt-2 flex flex-wrap gap-1.5">
                        <Tag tone={u.public_search_possible ? 'brand' : 'line'}>{u.public_search_possible ? '공개 자료 검색 가능' : '공개 자료 검색 어려움'}</Tag>
                        <Tag tone={u.human_reporting_needed ? 'warn' : 'line'}>{u.human_reporting_needed ? '사람의 취재 필요' : '사람의 취재 불필요'}</Tag>
                      </p>
                      {onPick ? (
                        <Btn size="sm" className="mt-3" kind={on ? 'soft' : 'second'} icon={on ? Check : ListPlus} aria-pressed={on} onClick={() => onPick(u)}>{on ? '과제에 담음' : '이 공백을 과제에 담기'}</Btn>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
        {tab === 'sources' ? (
          <>
            <h3 className="text-[15px] font-bold text-g900">출처</h3>
            <p className="mt-0.5 text-xs text-g500">같은 계열의 재게시는 독립 확인으로 세지 않습니다. 권리가 확인되지 않은 자료는 본문을 근거로 쓰지 않습니다.</p>
            <ul className="mt-3 space-y-2">
              {board.sources.map((s) => (
                <li key={s.key} className={cx('rounded-xl border p-3.5', s.included ? 'border-g100' : 'border-dashed border-g200 bg-g50')}>
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="num rounded-md bg-g100 px-1.5 py-0.5 text-xs font-bold text-g600">{s.key}</span>
                    <p className="min-w-0 flex-1 text-sm font-semibold text-g900">{s.title}</p>
                    {s.included ? <Tag tone="pos">근거에 반영</Tag> : <Tag tone="line">{L.EXCLUDED[s.excluded_reason] || '제외'}</Tag>}
                  </div>
                  <p className="mt-1 text-xs text-g500">{labelOr(L.FAMILY, s.family)} · {labelOr(L.RIGHTS, s.rights_class)} · 발행 {when(s.published_at, { zone: false })} · 받은 시각 {when(s.available_at, { zone: false })}</p>
                  {/^https?:\/\//.test(s.url || '') ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-xs text-brand hover:underline"><ExternalLink className="size-3 shrink-0" aria-hidden="true" />{s.url}</a>
                  ) : null}
                </li>
              ))}
            </ul>
            {board.families.length ? (
              <ul className="mt-3 space-y-0.5 text-xs text-g500">
                {board.families.map((f) => <li key={f.family}>{labelOr(L.FAMILY, f.family)}: {f.source_keys.map(srcTitle).join(', ')} → 독립 확인 {f.independent_groups}건으로 셉니다</li>)}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- next step
function StartReview({ f, d }) {
  const a = useAction();
  const [ack, setAck] = useState(false);
  const partial = d.status === 'PARTIAL';
  if (!d.result_pack_id) return null;
  if (d.content_version_id) {
    const same = f.reviews.filter((r) => r.reality_pack_id === d.result_pack_id && r.content_version_id === d.content_version_id);
    if (same.some((r) => r.status !== 'FAILED')) return null;
    if (!f.write) return <Notice tone="mute">근거 묶음이 준비됐습니다. 열람 권한에서는 초안 검토를 시작할 수 없습니다.</Notice>;
    return (
      <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5">
        <p className="text-[15px] font-bold text-g900">근거 묶음이 준비됐습니다</p>
        <p className="mt-1 text-sm text-g600">{same.length ? '이 근거로 한 검토가 실패한 적이 있습니다. 실패한 결과는 그대로 두고 새로 시작합니다.' : '이 근거로 초안 문장을 하나씩 대조합니다. 문장마다 판정과 권고, 원문 구간이 붙습니다.'}</p>
        {partial ? <div className="mt-3"><Check2 id={`ack-${d.id}`} checked={ack} onChange={(e) => setAck(e.target.checked)}>일부 자료가 빠진 부분 결과로 검토한다는 점을 확인했습니다</Check2></div> : null}
        <Btn kind="primary" size="block" icon={Play} className="mt-4" busy={a.busy} disabled={partial && !ack}
          onClick={() => a.run('createDraftReview', { params: { case_id: f.c.id }, body: { content_version_id: d.content_version_id, state_version_id: d.state_version_id, reality_pack_id: d.result_pack_id, allow_partial: partial ? ack : false }, onOk: () => go({ to: 'sec-review', view: null }) })}>
          {same.length ? '초안 검토 다시 시작' : '이 근거로 초안 검토 시작'}
        </Btn>
        <div className="mt-3 empty:hidden"><ActionState a={a} /></div>
      </div>
    );
  }
  if (f.led && f.led.briefByPack[d.result_pack_id]) return null;
  if (!f.write) return <Notice tone="mute">근거 묶음이 준비됐습니다. 열람 권한에서는 기획 요약을 만들 수 없습니다.</Notice>;
  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5">
      <p className="text-[15px] font-bold text-g900">근거 묶음이 준비됐습니다</p>
      <p className="mt-1 text-sm text-g600">초안 없이 질문과 자료로 정리한 근거입니다. 이 근거로 먼저 볼 것, 말할 수 있는 것, 서로 다른 것, 아직 모르는 것을 기획 요약으로 묶습니다.</p>
      {partial ? <div className="mt-3"><Check2 id={`ack-${d.id}`} checked={ack} onChange={(e) => setAck(e.target.checked)}>일부 자료가 빠진 부분 결과로 만든다는 점을 확인했습니다</Check2></div> : null}
      <Btn kind="primary" size="block" icon={FileText} className="mt-4" busy={a.busy} disabled={partial && !ack}
        onClick={() => a.run('createEditorialBrief', {
          params: { case_id: f.c.id }, body: { state_version_id: d.state_version_id, reality_pack_id: d.result_pack_id, content_version_id: null, allow_partial: partial ? ack : false },
          onOk: (res) => go({ to: 'sec-review', view: { kind: 'brief', id: res.data.brief.id }, sub: 'brief' }),
        })}>
        이 근거로 기획 요약 만들기
      </Btn>
      <div className="mt-3 empty:hidden"><ActionState a={a} /></div>
    </div>
  );
}

function History({ f }) {
  if (!f.executions.length) return null;
  return (
    <More label={`근거 수집 기록 ${f.executions.length}건`}>
      <ul className="space-y-3">
        {[...f.executions].reverse().map((d) => (
          <li key={d.id} className="rounded-lg bg-white p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm"><Status kind="job" code={d.status} /><span className="font-semibold text-g800">{labelOr(L.MODE, d.mode)}</span>
              <span className="text-g500">기준 {whenShort(d.as_of)} · 접수 {whenShort(d.created_at)}{d.baseline_pack_id ? ' · 이전 근거에 이어서' : ''}</span></p>
            <p className="mt-1 text-g500">넣은 자료: 원문 {d.submission_ids.length}건 · 취재 결과 {d.reporting_result_ids.length}건 · 예산 질의 {d.parameters.query_budget} · 자료 {d.parameters.source_budget}{d.allow_partial ? ' · 부분 결과 허용' : ''}</p>
            <div className="mt-2"><JobIds kind="execution" d={d} corr={f.led ? f.led.corr[d.id] : null} /></div>
            {d.result_pack_id ? <p className="mt-1">만든 근거 묶음 <IdLine v={d.result_pack_id} /></p> : null}
          </li>
        ))}
      </ul>
    </More>
  );
}

export function EvidenceSection() {
  const f = useCase();
  const draft = useStore(app, (s) => s.taskDraft);
  const { c, head } = f;
  const board = useQuery('getRealityBoard', { case_id: c.id, pack_id: head.pack_id || '' }, !!head.pack_id);
  const last = f.executions[f.executions.length - 1] || null;
  const live = f.executions.filter((d) => d.status === 'QUEUED' || d.status === 'RUNNING');
  const corr = (d) => (f.led ? f.led.corr[d.id] : null);
  // unknowns are picked for a task that points at the active result
  const origin = head.review_id ? { kind: 'review', id: head.review_id } : f.headBriefId ? { kind: 'brief', id: f.headBriefId } : null;
  const mine = origin && draft.origin && draft.origin.id === origin.id ? draft : null;
  const pick = (u) => app.set((s) => {
    const d = s.taskDraft.origin && s.taskDraft.origin.id === origin.id ? s.taskDraft : { assertion_ids: [], conflict_ids: [], unknown_ids: [] };
    const has = d.unknown_ids.includes(u.unknown_id);
    return { taskDraft: { origin, assertion_ids: d.assertion_ids, conflict_ids: d.conflict_ids, unknown_ids: has ? d.unknown_ids.filter((x) => x !== u.unknown_id) : uniq([...d.unknown_ids, u.unknown_id]) } };
  });
  const locked = !f.hasInput ? '기획 입력을 저장하면 공개 자료에서 근거를 모읍니다.' : null;
  return (
    <Section id="sec-evidence" n={2} title="근거 수집" locked={locked}
      desc="공개 자료에서 찾은 진술을 원문 구간과 함께 묶습니다. 원문에 실제로 적힌 문장만 근거가 됩니다.">
      {live.map((d) => <JobProgress key={d.id} kind="execution" d={d} title="공개 자료에서 근거를 모으는 중입니다" corr={corr(d)} />)}
      {last && (last.status === 'FAILED' || last.status === 'BLOCKED') ? (
        <JobFailed kind="execution" d={last} corr={corr(last)}>
          <p>근거를 하나도 저장하지 않았습니다. 이전에 끝난 결과는 그대로 남아 있습니다. 입력을 고쳐 다시 시작하거나, 잠시 뒤 같은 입력으로 다시 시도하세요.</p>
        </JobFailed>
      ) : null}
      {last && isDone(last) && last.head_updated === false ? <BranchNote /> : null}
      {last && last.status === 'PARTIAL' ? <Warnings items={last.warnings} /> : null}
      {head.pack_id ? (board.data ? <Board board={board.data} caseId={c.id} onPick={f.write && origin ? pick : null} picked={mine ? mine.unknown_ids : []} /> : <QueryState q={board} what="근거 판" />) : null}
      {!head.pack_id && !live.length && !(last && (last.status === 'FAILED' || last.status === 'BLOCKED')) ? <Empty>근거 수집을 기다리고 있습니다.</Empty> : null}
      {last && isDone(last) ? <StartReview f={f} d={last} /> : null}
      {board.data && board.data.pack.warnings && board.data.pack.warnings.length && !(last && last.status === 'PARTIAL') ? <Warnings items={board.data.pack.warnings} /> : null}
      <History f={f} />
    </Section>
  );
}
