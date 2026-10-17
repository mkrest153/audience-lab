// UI-03 기획 검토: 초안 주장, 근거 판, Brief, 질문과 취재 행동.
/* global React */
import * as L from '../../labels.js';
import { app, useStore, go, openPanel } from '../store.js';
import { useQuery, useAction } from '../api.js';
import { St, Id, Pins, Btn, Warnings, QueryState, Empty, Tabs, Chips, ActionState, useMe, canWrite, cx, labelOr } from '../ui.jsx';
import { when, whenShort, short, won } from '../time.js';

const { useState } = React;
const uniq = (a) => [...new Set(a)];

// ---------------------------------------------------------------- shared bits
export function claimMap(board) {
  const out = {};
  if (board) [...board.what_we_know, ...board.history].forEach((c) => { out[c.claim_id] = c; });
  return out;
}

// The server keeps a decrease positive and an increase negative.
export const rising = (c) => String(c.exact_percent).startsWith('-');
export function pctText(c) {
  const up = rising(c);
  return `${up ? String(c.exact_percent).slice(1) : c.exact_percent}% ${up ? '증가' : '감소'} (표시값 ${String(c.display_percent).replace(/^-/, '')}%)`;
}

export function Calc({ c }) {
  const n = (x) => x.toLocaleString('ko-KR');
  const up = rising(c);
  const mag = (v) => String(v).replace(/^-/, '');
  return (
    <div className="calc">
      <p className="calc-h">계산 근거 <span className="muted">서버가 원 단위 정수로 계산한 값입니다</span></p>
      <dl>
        <dt>{c.previous_period}년 같은 범위</dt><dd className="num">{won(c.previous_amount)}</dd>
        <dt>{c.current_period}년 같은 범위</dt><dd className="num">{won(c.current_amount)}</dd>
        <dt>{up ? '증가율' : '감소율'}</dt>
        <dd className="num">
          {up
            ? <>({n(c.current_amount)} − {n(c.previous_amount)}) ÷ {n(c.previous_amount)} × 100</>
            : <>({n(c.previous_amount)} − {n(c.current_amount)}) ÷ {n(c.previous_amount)} × 100</>}
          {' = '}<b>{mag(c.exact_percent)}%</b> <span className="muted">표시값 {mag(c.display_percent)}%</span>
        </dd>
        {c.excluded_furniture_amount ? (
          <>
            <dt>비교에서 뺀 것</dt>
            <dd>범위가 다른 금액 {won(c.excluded_furniture_amount)}. 이를 더한 합산 {won(c.previous_total)}은 비교 기준으로 쓰지 않습니다.</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

export function Subchecks({ list }) {
  if (!list || !list.length) return null;
  return (
    <table className="sub">
      <caption className="sr">주장을 나눠 본 세부 판정</caption>
      <tbody>
        {list.map((sc) => (
          <tr key={sc.kind}>
            <th scope="row">{labelOr(L.KIND, sc.kind)}</th>
            <td><St kind="review" code={sc.status} small /></td>
            <td>
              {sc.expected_percent !== null ? <span>초안 {sc.expected_percent}%{sc.observed_percent !== null ? `, 근거 ${sc.observed_percent}%` : ', 비교할 같은 범위 근거 없음'}</span> : null}
              {sc.needed_evidence.length ? <span>{sc.expected_percent !== null ? ' · ' : ''}필요한 근거: {sc.needed_evidence.join(', ')}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClaimLines({ ids, tone, label, claims, onOpen }) {
  return ids.map((id) => {
    const c = claims[id];
    return (
      <li key={`${label}:${id}`} className={`cl tone-${tone}`}>
        <span className="cl-l">{label}</span>
        <span className="cl-t">{c ? c.text : `근거 진술 ${short(id)}`}{c && c.superseded ? <span className="muted"> (정정 이전 기록)</span> : null}</span>
        <button type="button" className="link" onClick={() => onOpen(id)}>원문<span className="sr"> 보기: {c ? c.text : id}</span></button>
      </li>
    );
  });
}

export function QuestionTree({ questions, assessments, claims, onOpen }) {
  if (!questions.length) return <Empty />;
  const byId = Object.fromEntries(assessments.map((a) => [a.question_id, a]));
  const row = (q, depth) => {
    const a = byId[q.id];
    const kids = questions.filter((x) => x.parent_id === q.id);
    return (
      <li key={q.id} className={cx('q', depth > 0 && 'q-child')}>
        <div className="q-h">
          <span className="q-k mono">{q.question_key}</span>
          <span className="q-t">{q.question}</span>
          {a ? <St kind="question" code={a.status} /> : <span className="muted">평가 없음</span>}
        </div>
        {a && a.resolution_claim_ids.length ? (
          <ul className="cls">
            <ClaimLines ids={a.resolution_claim_ids} tone="ok" label="확인한 근거" claims={claims} onOpen={(id) => onOpen(q, a, id)} />
          </ul>
        ) : null}
        {a && a.calculation ? <Calc c={a.calculation} /> : null}
        {a && a.needed_evidence.length ? <p className="q-need"><span className="lbl">남은 자료</span>{a.needed_evidence.join(', ')}</p> : null}
        {kids.length ? <ul className="qs">{kids.map((k) => row(k, depth + 1))}</ul> : null}
      </li>
    );
  };
  return <ul className="qs">{questions.filter((q) => !q.parent_id).map((q) => row(q, 0))}</ul>;
}

// ---------------------------------------------------------------- view picker
function ViewPicker({ c, view }) {
  const led = useStore(app, (s) => s.ledger[c.id]);
  const jobs = useStore(app, (s) => s.jobs);
  const opts = [];
  if (led) {
    led.review.forEach((id) => opts.push({ kind: 'review', id, d: jobs[id] && jobs[id].data }));
    led.brief.forEach((id) => opts.push({ kind: 'brief', id, d: jobs[id] && jobs[id].data }));
  }
  if (view && !opts.some((o) => o.id === view.id)) opts.push({ kind: view.kind, id: view.id, d: null });
  const t = (o, k) => (o.d && o.d[k]) || '';
  opts.sort((a, b) => t(a, 'as_of').localeCompare(t(b, 'as_of')) || t(a, 'created_at').localeCompare(t(b, 'created_at')));
  const head = c.head || {};
  const text = (o) => {
    const active = o.kind === 'review' ? head.review_id === o.id : !head.review_id && o.d && head.pack_id === o.d.reality_pack_id;
    const branch = o.d && o.d.warnings && o.d.warnings.some((w) => w.code === 'BRANCH_ONLY');
    return `${o.kind === 'review' ? '초안 검토' : 'Brief'} · 기준 ${o.d ? whenShort(o.d.as_of) : '확인 중'} · ${o.d ? labelOr(L.JOB_STATUS, o.d.status) : ''} · ${short(o.id)}${active ? ' · 활성' : ''}${branch ? ' · 별도 가지' : ''}`;
  };
  return (
    <div className="viewpick">
      <label htmlFor="viewpick">보는 버전</label>
      <select id="viewpick" value={view ? `${view.kind}:${view.id}` : ''}
        onChange={(e) => { const [kind, id] = e.target.value.split(':'); go({ view: id ? { kind, id } : null, sub: kind === 'review' ? 'sheet' : 'brief' }); }}>
        {opts.length === 0 ? <option value="">결과 없음</option> : null}
        {opts.map((o) => <option key={o.id} value={`${o.kind}:${o.id}`}>{text(o)}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- 근거 판
function Board({ board, caseId, onPick }) {
  const claims = claimMap(board);
  const open = (title, sup, con, focus) => openPanel({
    caseId, packId: board.pack.id, title, focus,
    groups: [{ label: '뒷받침하는 근거', tone: 'ok', claimIds: sup }, { label: '반박하는 근거', tone: 'bad', claimIds: con }],
  });
  const srcTitle = (key) => { const s = board.sources.find((x) => x.key === key); return s ? s.title : key; };
  return (
    <div className="board">
      <section>
        <h3>지금 말할 수 있는 것 <span className="count">{board.what_we_know.length}</span></h3>
        {board.what_we_know.length === 0 ? <Empty /> : (
          <div className="scroll-x">
            <table className="grid">
              <thead><tr><th scope="col">근거 진술</th><th scope="col">출처</th><th scope="col">근거 상태</th><th scope="col">독립 출처</th><th scope="col"><span className="sr">원문</span></th></tr></thead>
              <tbody>
                {board.what_we_know.map((k) => (
                  <tr key={k.claim_id}>
                    <td>{k.text}</td>
                    <td>{srcTitle(k.source_key)}</td>
                    <td>{labelOr(L.EPISTEMIC, k.epistemic_status)}</td>
                    <td className="num">{k.independent_source_groups}묶음</td>
                    <td><button type="button" className="link" onClick={() => open(k.text, [k.claim_id], [], k.claim_id)}>원문<span className="sr"> 보기: {k.text}</span></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="foot">저장된 진술이라고 해서 사실로 확정된 것은 아닙니다. 기관이 그렇게 말했다는 기록과 실제로 그러한지는 따로 봅니다.</p>
      </section>

      <section>
        <h3>서로 다른 것 <span className="count">{board.what_is_disputed.length}</span></h3>
        {board.what_is_disputed.length === 0 ? <Empty /> : board.what_is_disputed.map((x) => (
          <div key={x.conflict_id} className="dispute">
            <p className="dispute-q"><span className="mono">{x.key}</span> {x.question} <St kind="question" code="CONFLICTED" small /></p>
            <p>{x.reason_unresolved}</p>
            <ul className="cls">
              <ClaimLines ids={x.supporting_claim_ids} tone="ok" label="한쪽" claims={claims} onOpen={(id) => open(x.question, x.supporting_claim_ids, x.contradicting_claim_ids, id)} />
              <ClaimLines ids={x.contradicting_claim_ids} tone="bad" label="다른 쪽" claims={claims} onOpen={(id) => open(x.question, x.supporting_claim_ids, x.contradicting_claim_ids, id)} />
            </ul>
          </div>
        ))}
        {board.resolved_conflicts.length ? (
          <p className="foot">정정으로 정리된 상충 {board.resolved_conflicts.length}건: {board.resolved_conflicts.map((x) => x.question).join(', ')}. 이전 버전에서는 여전히 상충으로 남아 있습니다.</p>
        ) : null}
      </section>

      <section>
        <h3>아직 모르는 것 <span className="count">{board.what_remains_unknown.length}</span></h3>
        {board.what_remains_unknown.length === 0 ? <Empty /> : board.what_remains_unknown.map((u) => (
          <div key={u.unknown_id} className="unknown">
            <p className="dispute-q"><span className="mono">{u.key}</span> {u.question}</p>
            <dl className="kv">
              <dt>왜 중요한가</dt><dd>{u.why_important}</dd>
              <dt>필요한 자료</dt><dd>{u.needed_evidence}</dd>
              <dt>확인 방법</dt><dd>{u.public_search_possible ? '공개 자료 검색 가능' : '공개 자료 검색 어려움'} · {u.human_reporting_needed ? '사람의 취재 필요' : '사람의 취재 불필요'}</dd>
            </dl>
            <p className="foot">연결된 근거 진술이 없어 원문 보기는 없습니다. 필요한 자료를 과제로 넘기거나 공개 자료를 다시 찾을 수 있습니다.</p>
            {onPick ? <p><Btn onClick={() => onPick(u)}>이 공백을 과제에 담기</Btn></p> : null}
          </div>
        ))}
      </section>

      {board.history.length ? (
        <section>
          <h3>이전 기록 <span className="count">{board.history.length}</span></h3>
          <ul className="cls">
            <ClaimLines ids={board.history.map((h) => h.claim_id)} tone="mute" label="정정 전" claims={claims} onOpen={(id) => open('정정 이전 기록', [id], [], id)} />
          </ul>
          <p className="foot">출처가 정정한 뒤에도 과거 기록은 지우지 않습니다. 지금 판정의 뒷받침에서만 뺍니다.</p>
        </section>
      ) : null}

      <section>
        <h3>출처 <span className="count">{board.sources.length}</span></h3>
        <div className="scroll-x">
          <table className="grid grid-wide">
            <thead><tr><th scope="col">출처</th><th scope="col">계열</th><th scope="col">권리</th><th scope="col">발행</th><th scope="col">받은 시각</th><th scope="col">근거 반영</th></tr></thead>
            <tbody>
              {board.sources.map((s) => (
                <tr key={s.key} className={s.included ? '' : 'row-off'}>
                  <td><span className="mono">{s.key}</span> {s.title}<br /><span className="url">{s.url}</span></td>
                  <td>{labelOr(L.FAMILY, s.family)}</td>
                  <td>{labelOr(L.RIGHTS, s.rights_class)}</td>
                  <td>{when(s.published_at, { zone: false })}</td>
                  <td>{when(s.available_at, { zone: false })}</td>
                  <td>{s.included ? '반영' : <span className="off">{L.EXCLUDED[s.excluded_reason] || s.excluded_reason} <code>{s.excluded_reason}</code></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="families">
          {board.families.map((f) => (
            <li key={f.family}>{labelOr(L.FAMILY, f.family)}: {f.source_keys.map(srcTitle).join(', ')} → 독립 확인 {f.independent_groups}건으로 셉니다</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Brief
function BriefSections({ brief, caseId, claims }) {
  const open = (it) => openPanel({
    caseId, packId: brief.reality_pack_id, title: it.text, focus: it.claim_ids[0],
    groups: [{ label: it.kind === 'COUNTER_FRAME' ? '반론이 겨냥한 근거' : '연결된 근거', tone: 'mute', claimIds: it.claim_ids }],
  });
  return (
    <div className="brief">
      <p className="foot">순위와 점수는 항목을 늘어놓는 순서일 뿐이며 사실일 확률이나 등급이 아닙니다.</p>
      {brief.sections.map((sec) => (
        <section key={sec.section} className="bsec">
          <h3>{L.SECTION[sec.section]} <code>{sec.section}</code> <span className="count">{sec.items.length}</span></h3>
          {sec.section === 'STRONG_COUNTER_FRAMES' ? (
            <p className="syn-note">알려진 진술 앞 세 건에 일반적인 재검토 문장을 붙인 기본 반론 틀입니다. 사실이 아니며 독자나 시청자의 반응을 예측한 것도 아닙니다.</p>
          ) : null}
          {sec.items.length === 0 ? <Empty /> : (
            <ol className="bitems">
              {sec.items.map((it) => (
                <li key={it.id} className={cx(it.labels.includes('NOT_FACT') && 'syn')}>
                  <p className="b-text">{it.text}</p>
                  <p className="b-meta">
                    <Chips items={it.labels} />
                    <span className="muted">근거 상태 {labelOr(L.EPISTEMIC, it.epistemic_status)} · 순위 {it.rank} · 정렬 점수 {it.score}</span>
                    {it.claim_ids.length ? <button type="button" className="link" onClick={() => open(it)}>원문<span className="sr"> 보기: {it.text}</span></button> : null}
                  </p>
                  {it.needed_evidence.length ? <p className="q-need"><span className="lbl">필요한 자료</span>{it.needed_evidence.join(', ')}</p> : null}
                  <details className="why">
                    <summary>이 항목을 고른 기준</summary>
                    <p>{it.reason} · {it.why_this.summary}</p>
                    <p className="mono">{it.why_this.reason_codes.join(', ')} · {Object.entries(it.why_this.ranking_factors).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

function ActionOverlay({ items, questions }) {
  if (!items.length) return <Empty />;
  const qk = Object.fromEntries(questions.map((q) => [q.id, q]));
  return (
    <ul className="actions">
      {items.map((a, i) => (
        <li key={i}>
          <p className="b-text">{a.action}</p>
          <dl className="kv">
            <dt>물을 곳</dt><dd>{a.ask_role}</dd>
            <dt>제안 이유</dt><dd>{a.provenance}</dd>
            <dt>연결된 질문</dt><dd>{qk[a.question_id] ? `${qk[a.question_id].question_key} ${qk[a.question_id].question}` : short(a.question_id)}</dd>
          </dl>
          <p className="b-meta"><Chips items={a.labels} /><span className="muted">역할만 제안합니다. 사람 이름이나 연락처는 만들지 않습니다.</span></p>
        </li>
      ))}
    </ul>
  );
}

function MakeBrief({ c, stateId, packId, contentId, partial, hasOne }) {
  const me = useMe();
  const a = useAction();
  const [ack, setAck] = useState(false);
  if (!canWrite(me)) return <p className="muted">열람 권한으로는 Brief를 만들 수 없습니다.</p>;
  return (
    <div className="makebrief">
      {partial ? (
        <label className="check"><input type="checkbox" id="brief-partial" checked={ack} onChange={(e) => setAck(e.target.checked)} /> 일부 자료가 빠진 부분 결과로 만든다는 점을 확인했습니다</label>
      ) : null}
      <Btn kind={hasOne ? 'second' : 'primary'} busy={a.busy} disabled={partial && !ack}
        onClick={() => a.run('createEditorialBrief', { params: { case_id: c.id }, body: { state_version_id: stateId, reality_pack_id: packId, content_version_id: contentId || null, allow_partial: partial ? ack : false }, onOk: () => go({ sub: 'brief' }) })}>
        {hasOne ? '같은 근거로 Brief 다시 만들기' : '이 근거 묶음으로 Brief 만들기'}
      </Btn>
      <ActionState a={a} />
    </div>
  );
}

// ---------------------------------------------------------------- 초안 검토
function segments(body, items) {
  if (!body) return items.map((item, i) => ({ item, n: i + 1 }));
  const cps = Array.from(body);
  const out = [];
  let pos = 0;
  items.forEach((item, i) => {
    if (item.start > pos) { const gap = cps.slice(pos, item.start).join(''); if (gap.trim()) out.push({ gap, at: pos }); }
    out.push({ item, n: i + 1 });
    pos = Math.max(pos, item.end);
  });
  if (pos < cps.length) { const gap = cps.slice(pos).join(''); if (gap.trim()) out.push({ gap, at: pos }); }
  return out;
}

function Sheet({ c, r, body, claims, write }) {
  const draft = useStore(app, (s) => s.taskDraft);
  const picked = draft.origin && draft.origin.id === r.id ? draft.assertion_ids : [];
  const qs = Object.fromEntries(r.questions.map((q) => [q.id, q]));
  const qa = Object.fromEntries(r.question_assessments.map((a) => [a.question_id, a]));
  const toggle = (it) => {
    const has = picked.includes(it.assertion_id);
    const ids = has ? picked.filter((x) => x !== it.assertion_id) : [...picked, it.assertion_id];
    const keep = r.items.filter((x) => ids.includes(x.assertion_id));
    app.set({ taskDraft: { origin: { kind: 'review', id: r.id }, assertion_ids: ids, conflict_ids: uniq(keep.flatMap((x) => x.conflict_ids)), unknown_ids: uniq(keep.flatMap((x) => x.unknown_ids)) } });
  };
  const open = (it, n, focus) => {
    const rel = it.claim_ids.filter((id) => !it.supporting_claim_ids.includes(id) && !it.contradicting_claim_ids.includes(id));
    openPanel({
      caseId: c.id, packId: r.reality_pack_id, title: `A${n} ${it.text}`, focus,
      groups: [
        { label: '뒷받침하는 근거', tone: 'ok', claimIds: it.supporting_claim_ids },
        { label: '반박하는 근거', tone: 'bad', claimIds: it.contradicting_claim_ids },
        { label: '함께 본 근거', tone: 'mute', claimIds: rel },
      ],
    });
  };
  return (
    <table className="sheet">
      <caption className="sr">초안 문장과 문장별 판정</caption>
      <thead><tr><th scope="col" className="sheet-ms">초안 문장</th><th scope="col">판정과 근거</th></tr></thead>
      <tbody>
        {segments(body, r.items).map((seg) => {
          if (!seg.item) {
            return (
              <tr key={`gap-${seg.at}`} className="gap">
                <td className="ms"><p className="ms-t">{seg.gap}</p></td>
                <td className="muted">판정 대상으로 뽑히지 않은 부분입니다.</td>
              </tr>
            );
          }
          const it = seg.item;
          const rel = it.claim_ids.filter((id) => !it.supporting_claim_ids.includes(id) && !it.contradicting_claim_ids.includes(id));
          const linked = [...it.conflict_ids, ...it.unknown_ids].filter((id) => qs[id]);
          const on = picked.includes(it.assertion_id);
          return (
            <tr key={it.assertion_id} className={`row-${it.status.toLowerCase()}`}>
              <td className="ms">
                <p className="ms-n"><b>A{seg.n}</b><span className="mono">자 {it.start}–{it.end}</span><span>{labelOr(L.KIND, it.kind)} 문장</span></p>
                <p className="ms-t">{it.text}</p>
              </td>
              <td className="verdict">
                <p className="v-top">
                  <St kind="review" code={it.status} />
                  <span className="v-why">{it.reason_codes.map((x) => L.REASON[x] || x).join(' · ')}</span>
                  {r.status === 'PARTIAL' ? <span className="chip chip-warn">부분 결과 기준</span> : null}
                </p>
                <p className="v-rec"><span className="lbl">권고</span>{it.recommendation}</p>
                <Subchecks list={it.subchecks} />
                {it.subchecks.filter((sc) => sc.calculation).map((sc) => <Calc key={sc.kind} c={sc.calculation} />)}
                {it.claim_ids.length ? (
                  <ul className="cls">
                    <ClaimLines ids={it.supporting_claim_ids} tone="ok" label="뒷받침" claims={claims} onOpen={(id) => open(it, seg.n, id)} />
                    <ClaimLines ids={it.contradicting_claim_ids} tone="bad" label="반박" claims={claims} onOpen={(id) => open(it, seg.n, id)} />
                    <ClaimLines ids={rel} tone="mute" label="함께 봄" claims={claims} onOpen={(id) => open(it, seg.n, id)} />
                  </ul>
                ) : <p className="muted">연결된 근거 진술이 없습니다.</p>}
                {it.needed_evidence.length ? <p className="q-need"><span className="lbl">필요한 근거</span>{it.needed_evidence.join(', ')}</p> : null}
                {linked.length ? (
                  <p className="v-q"><span className="lbl">연결된 질문</span>
                    {linked.map((id) => <span key={id} className="v-qi"><span className="mono">{qs[id].question_key}</span> {qs[id].question} {qa[id] ? <St kind="question" code={qa[id].status} small plain /> : null}</span>)}
                  </p>
                ) : null}
                {write ? (
                  <p className="v-act">
                    <button type="button" className={cx('pick', on && 'on')} aria-pressed={on} onClick={() => toggle(it)}>{on ? '과제에 담음' : '과제에 담기'}</button>
                  </p>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ViewHead({ title, status, active, branch, pins, warnings, children }) {
  return (
    <header className="viewhead">
      <div className="viewhead-t">
        <h2>{title}</h2>
        <St kind="job" code={status} />
        {active ? <span className="chip chip-on">활성 결과</span> : <span className="chip chip-warn">활성 결과 아님</span>}
        {branch ? <span className="chip chip-warn">별도 가지로 보존</span> : null}
      </div>
      <Pins items={pins} />
      <Warnings items={warnings} />
      {children}
    </header>
  );
}

function Excluded({ board }) {
  if (!board) return null;
  const off = board.sources.filter((s) => !s.included);
  if (!off.length) return null;
  return (
    <p className="excluded"><span className="lbl">근거에서 뺀 자료</span>
      {off.map((s) => <span key={s.key} className="v-qi">{s.title}: {L.EXCLUDED[s.excluded_reason] || s.excluded_reason}</span>)}
    </p>
  );
}

function DraftReviewView({ c, versions, reviewId }) {
  const me = useMe();
  const route = useStore(app, (s) => s.route);
  const led = useStore(app, (s) => s.ledger[c.id]);
  const draft = useStore(app, (s) => s.taskDraft);
  const p = { case_id: c.id };
  const q = useQuery('getDraftReview', { ...p, review_id: reviewId });
  const r = q.data;
  const board = useQuery('getRealityBoard', { ...p, pack_id: r ? r.reality_pack_id : '' }, !!r && !!r.reality_pack_id);
  const briefId = r && led ? led.briefByPack[r.reality_pack_id] : null;
  const brief = useQuery('getEditorialBrief', { ...p, brief_id: briefId || '' }, !!briefId);
  if (!r) return <QueryState q={q} what="초안 검토" />;
  const content = versions.contents.find((v) => v.id === r.content_version_id);
  const claims = claimMap(board.data);
  const done = r.status === 'COMPLETED' || r.status === 'PARTIAL';
  const active = !!c.head && c.head.review_id === r.id;
  const branch = r.warnings.some((w) => w.code === 'BRANCH_ONLY');
  const stale = !!c.head && c.head.content_version_id !== r.content_version_id;
  const write = canWrite(me);
  const sub = ['sheet', 'board', 'brief', 'questions'].includes(route.sub) ? route.sub : 'sheet';
  const picks = draft.origin && draft.origin.id === r.id ? draft : { assertion_ids: [], conflict_ids: [], unknown_ids: [] };
  const pickCount = picks.assertion_ids.length + picks.conflict_ids.length + picks.unknown_ids.length;
  const pins = [
    { label: '기준 시각', text: when(r.as_of) },
    { label: '초안 버전', id: r.content_version_id, extra: content ? `v${content.version_number}` : '' },
    { label: '질문 상태 버전', id: r.state_version_id },
    { label: '근거 묶음', id: r.reality_pack_id },
    { label: '검토', id: r.id },
    r.completed_at ? { label: '끝난 시각', text: when(r.completed_at) } : null,
  ];
  const openQ = (qq, a, focus) => openPanel({
    caseId: c.id, packId: r.reality_pack_id, title: `${qq.question_key} ${qq.question}`, focus,
    groups: [{ label: '질문을 푸는 데 쓴 근거', tone: 'ok', claimIds: a.resolution_claim_ids }],
  });
  const pickUnknown = (u) => {
    app.set({ taskDraft: { origin: { kind: 'review', id: r.id }, assertion_ids: picks.assertion_ids, conflict_ids: picks.conflict_ids, unknown_ids: uniq([...picks.unknown_ids, u.unknown_id]) } });
  };
  return (
    <div>
      <ViewHead title="초안 검토" status={r.status} active={active} branch={branch} pins={pins} warnings={r.warnings}>
        {q.net ? <QueryState q={q} /> : null}
        {stale ? <p className="note tone-info">이 결과는 이전 초안 버전을 기준으로 합니다. 초안을 고친 뒤에는 새 버전으로 검토를 다시 시작해야 하며, 이 결과가 새 초안의 판정으로 바뀌지는 않습니다.</p> : null}
        {r.status === 'PARTIAL' ? <Excluded board={board.data} /> : null}
      </ViewHead>

      {!done && r.status !== 'FAILED' ? (
        <p className="note tone-info" role="status">검토가 진행 중입니다. 끝나면 이 화면에 판정이 나타납니다. <button type="button" className="link" onClick={() => go({ tab: 'status' })}>실행 상태 보기</button></p>
      ) : null}
      {r.status === 'FAILED' ? (
        <div className="note tone-bad" role="alert">
          <p className="note-h">이 검토는 실패했습니다 <code>{r.error_code}</code></p>
          <p>모델이 낸 결과가 서버 검증을 통과하지 못해 판정을 하나도 저장하지 않았습니다. 이전에 끝난 검토는 그대로 있으며 '보는 버전'에서 따로 열 수 있습니다. 실패한 결과와 섞어 보여주지 않습니다.</p>
        </div>
      ) : null}

      {done ? (
        <>
          <Tabs label="검토 내용" small prefix="sub" value={sub} onChange={(id) => go({ sub: id })} items={[
            { id: 'sheet', label: '초안 주장', badge: r.items.length },
            { id: 'board', label: '근거 판' },
            { id: 'brief', label: 'Brief' },
            { id: 'questions', label: '질문과 취재 행동', badge: r.questions.length },
          ]} />
          <div role="tabpanel" aria-labelledby={`sub-${sub}`} className="tabpanel">
            {sub === 'sheet' ? (
              <>
                {r.items.length === 0 ? <Empty>판정할 문장이 없습니다.</Empty> : <Sheet c={c} r={r} body={content ? content.body : null} claims={claims} write={write} />}
                <p className="foot">판정은 이 초안과 이 근거 묶음에 한정됩니다. 근거 있음이 게재 승인이나 일반적 사실 확정을 뜻하지는 않습니다. 문장 위치는 유니코드 글자 기준이며 끝 위치는 포함하지 않습니다.</p>
              </>
            ) : null}
            {sub === 'board' ? (board.data ? <Board board={board.data} caseId={c.id} onPick={write ? pickUnknown : null} /> : <QueryState q={board} what="근거 판" />) : null}
            {sub === 'brief' ? (
              <>
                {briefId && brief.data ? <BriefSections brief={brief.data} caseId={c.id} claims={claims} /> : null}
                {briefId && !brief.data ? <QueryState q={brief} what="Brief" /> : null}
                {!briefId ? <p className="empty">이 근거 묶음으로 만든 Brief가 아직 없습니다. 초안 검토와 따로, 같은 근거 묶음으로 만듭니다.</p> : null}
                {!briefId ? <MakeBrief c={c} stateId={r.state_version_id} packId={r.reality_pack_id} contentId={r.content_version_id} partial={r.status === 'PARTIAL'} hasOne={false} /> : null}
              </>
            ) : null}
            {sub === 'questions' ? (
              <>
                <h3>질문 평가</h3>
                <QuestionTree questions={r.questions} assessments={r.question_assessments} claims={claims} onOpen={openQ} />
                <p className="foot">과제를 끝냈다는 기록, 검색 결과 0건, 합성한 답변은 질문이 풀렸다는 근거가 아닙니다. 답이 없는 질문도 목록에서 지우지 않습니다.</p>
                <h3>취재 행동 제안</h3>
                {brief.data ? <ActionOverlay items={brief.data.action_overlay} questions={brief.data.questions} /> : <p className="empty">취재 행동 제안은 Brief에 담깁니다. Brief 탭에서 먼저 만드세요.</p>}
              </>
            ) : null}
          </div>

          <div className="actbar">
            <div className="actbar-l">
              {pickCount ? <span>과제에 담은 항목: 문장 {picks.assertion_ids.length} · 상충 {picks.conflict_ids.length} · 공백 {picks.unknown_ids.length}</span> : <span className="muted">문장 행의 '과제에 담기'로 취재할 항목을 고를 수 있습니다.</span>}
            </div>
            <div className="actbar-r">
              {write ? <Btn kind="primary" onClick={() => go({ tab: 'tasks', creatingTask: true, taskOrigin: { kind: 'review', id: r.id } })}>취재 과제 만들기</Btn> : <span className="muted">열람 권한에서는 저장과 실행을 할 수 없습니다.</span>}
              <Btn onClick={() => go({ tab: 'changes' })}>공개 자료 다시 찾기</Btn>
              <Btn onClick={() => go({ tab: 'export', exportInput: { kind: 'DRAFT_REVIEW', id: r.id } })}>보고서 만들기</Btn>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- 초안 없는 검토
function BriefView({ c, briefId }) {
  const me = useMe();
  const route = useStore(app, (s) => s.route);
  const p = { case_id: c.id };
  const q = useQuery('getEditorialBrief', { ...p, brief_id: briefId });
  const b = q.data;
  const board = useQuery('getRealityBoard', { ...p, pack_id: b ? b.reality_pack_id : '' }, !!b);
  if (!b) return <QueryState q={q} what="Brief" />;
  const claims = claimMap(board.data);
  const write = canWrite(me);
  const sub = ['brief', 'board', 'questions'].includes(route.sub) ? route.sub : 'brief';
  const active = !!c.head && !c.head.review_id && c.head.pack_id === b.reality_pack_id;
  const pins = [
    { label: '기준 시각', text: when(b.as_of) },
    { label: '초안 버전', text: b.content_version_id ? undefined : '없음', id: b.content_version_id || undefined },
    { label: '질문 상태 버전', id: b.state_version_id },
    { label: '근거 묶음', id: b.reality_pack_id },
    { label: 'Brief', id: b.id },
    { label: '만든 시각', text: when(b.created_at) },
  ];
  const openQ = (qq, a, focus) => openPanel({
    caseId: c.id, packId: b.reality_pack_id, title: `${qq.question_key} ${qq.question}`, focus,
    groups: [{ label: '질문을 푸는 데 쓴 근거', tone: 'ok', claimIds: a.resolution_claim_ids }],
  });
  const pickUnknown = (u) => app.set((s) => {
    const d = s.taskDraft.origin && s.taskDraft.origin.id === b.id ? s.taskDraft : { conflict_ids: [], unknown_ids: [] };
    return { taskDraft: { origin: { kind: 'brief', id: b.id }, assertion_ids: [], conflict_ids: d.conflict_ids, unknown_ids: uniq([...d.unknown_ids, u.unknown_id]) } };
  });
  return (
    <div>
      <ViewHead title="Brief" status={b.status} active={active} pins={pins} warnings={b.warnings}>
        {q.net ? <QueryState q={q} /> : null}
        {!b.content_version_id ? <p className="note tone-info">초안 없이 질문과 자료로만 본 검토입니다. 문장별 판정 표는 만들지 않습니다.</p> : null}
        {b.status === 'PARTIAL' ? <Excluded board={board.data} /> : null}
      </ViewHead>
      <Tabs label="검토 내용" small prefix="sub" value={sub} onChange={(id) => go({ sub: id })} items={[
        { id: 'brief', label: 'Brief' },
        { id: 'board', label: '근거 판' },
        { id: 'questions', label: '질문과 취재 행동', badge: b.questions.length },
      ]} />
      <div role="tabpanel" aria-labelledby={`sub-${sub}`} className="tabpanel">
        {sub === 'brief' ? <BriefSections brief={b} caseId={c.id} claims={claims} /> : null}
        {sub === 'board' ? (board.data ? <Board board={board.data} caseId={c.id} onPick={write ? pickUnknown : null} /> : <QueryState q={board} what="근거 판" />) : null}
        {sub === 'questions' ? (
          <>
            <h3>질문 평가</h3>
            <QuestionTree questions={b.questions} assessments={b.question_assessments} claims={claims} onOpen={openQ} />
            <p className="foot">과제를 끝냈다는 기록, 검색 결과 0건, 합성한 답변은 질문이 풀렸다는 근거가 아닙니다.</p>
            <h3>취재 행동 제안</h3>
            <ActionOverlay items={b.action_overlay} questions={b.questions} />
          </>
        ) : null}
      </div>
      <div className="actbar">
        <div className="actbar-l"><span className="muted">과제는 이 Brief를 원본으로 삼아 상충과 공백을 가리킵니다.</span></div>
        <div className="actbar-r">
          {write ? <Btn kind="primary" onClick={() => go({ tab: 'tasks', creatingTask: true, taskOrigin: { kind: 'brief', id: b.id } })}>취재 과제 만들기</Btn> : <span className="muted">열람 권한에서는 저장과 실행을 할 수 없습니다.</span>}
          <Btn onClick={() => go({ tab: 'changes' })}>공개 자료 다시 찾기</Btn>
          <Btn onClick={() => go({ tab: 'export', exportInput: { kind: 'BRIEF', id: b.id } })}>보고서 만들기</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- screen
export function defaultView(c, led) {
  const head = c.head;
  if (!head) return null;
  if (head.review_id) return { kind: 'review', id: head.review_id };
  if (head.pack_id && led && led.briefByPack[head.pack_id]) return { kind: 'brief', id: led.briefByPack[head.pack_id] };
  return null;
}

export function ReviewScreen({ c, versions }) {
  const route = useStore(app, (s) => s.route);
  const led = useStore(app, (s) => s.ledger[c.id]);
  const view = route.view || defaultView(c, led);
  const head = c.head;
  const explicit = !!route.view;
  const fallback = defaultView(c, led);
  return (
    <div className="screen">
      <div className="screen-top">
        <h2>기획 검토</h2>
        <ViewPicker c={c} view={view} />
        {explicit && fallback && fallback.id !== route.view.id ? <Btn kind="ghost" onClick={() => go({ view: null, sub: fallback.kind === 'review' ? 'sheet' : 'brief' })}>활성 결과로 돌아가기</Btn> : null}
      </div>
      <p className="lede">{view && view.kind === 'brief'
        ? '질문과 자료로 정리한 근거입니다. 원문을 열어 확인하고, 더 취재할 것은 과제로 넘깁니다.'
        : '초안 문장마다 근거와 대조한 결과입니다. 원문을 열어 확인하고, 더 취재할 것은 과제로 넘깁니다.'}</p>
      {!view ? (
        <div className="note tone-info">
          <p className="note-h">아직 볼 검토 결과가 없습니다</p>
          {!head ? <p>활성 입력이 지정되지 않았습니다. 기획 입력에서 질문과 초안 또는 자료를 저장하면 시작됩니다.</p> : null}
          {head && !head.pack_id ? <p>입력은 저장됐고 근거 묶음은 아직 없습니다. 실행 상태에서 진행을 확인하세요.</p> : null}
          {head && head.pack_id && head.content_version_id ? <p>근거 묶음은 준비됐고 초안 검토는 아직 없습니다. 실행 상태에서 이 근거 묶음으로 초안 검토를 시작할 수 있습니다.</p> : null}
          {head && head.pack_id && !head.content_version_id ? <p>근거 묶음은 준비됐고 Brief는 아직 없습니다. 실행 상태에서 이 근거 묶음으로 Brief를 만들 수 있습니다.</p> : null}
          <p><Btn onClick={() => go({ tab: head ? 'status' : 'intake' })}>{head ? '실행 상태로' : '기획 입력으로'}</Btn></p>
        </div>
      ) : null}
      {view && view.kind === 'review' ? <DraftReviewView key={view.id} c={c} versions={versions} reviewId={view.id} /> : null}
      {view && view.kind === 'brief' ? <BriefView key={view.id} c={c} briefId={view.id} /> : null}
    </div>
  );
}
