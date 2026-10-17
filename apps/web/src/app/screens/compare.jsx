// UI-07 검토 비교: 같은 초안의 이전 검토와 새 검토, 또는 초안 없는 두 Brief.
/* global React */
import * as L from '../../labels.js';
import { app, useStore, go, openPanel } from '../store.js';
import { useQuery } from '../api.js';
import { St, Id, Pins, Btn, Warnings, QueryState, Empty, cx, labelOr } from '../ui.jsx';
import { when, whenShort, short } from '../time.js';
import { claimMap, Calc, pctText } from './review.jsx';

const { useState } = React;

function StatusMove({ kind, before, after }) {
  if (before === after) return <span className="move"><St kind={kind} code={after} small /><span className="muted"> 그대로</span></span>;
  return (
    <span className="move">
      {before ? <St kind={kind} code={before} small /> : <span className="muted">없음</span>}
      <span className="arrow" aria-hidden="true">→</span><span className="sr">에서</span>
      {after ? <St kind={kind} code={after} small /> : <span className="muted">없음</span>}
    </span>
  );
}

function SubMoves({ before, after }) {
  const kinds = [...new Set([...before.map((s) => s.kind), ...after.map((s) => s.kind)])];
  if (!kinds.length) return null;
  const desc = (sc) => {
    if (!sc) return '';
    const parts = [];
    if (sc.expected_percent !== null) parts.push(`초안 ${sc.expected_percent}%${sc.observed_percent !== null ? `, 근거 ${sc.observed_percent}%` : ', 비교할 근거 없음'}`);
    if (sc.needed_evidence.length) parts.push(`필요한 근거: ${sc.needed_evidence.join(', ')}`);
    return parts.join(' · ');
  };
  return (
    <div className="scroll-x">
    <table className="sub sub-wide">
      <caption className="sr">세부 판정의 이전과 이후</caption>
      <thead><tr><th scope="col">나눠 본 것</th><th scope="col">이전</th><th scope="col">이후</th><th scope="col">이후의 내용</th></tr></thead>
      <tbody>
        {kinds.map((k) => {
          const b = before.find((s) => s.kind === k);
          const a = after.find((s) => s.kind === k);
          return (
            <tr key={k}>
              <th scope="row">{labelOr(L.KIND, k)}</th>
              <td>{b ? <St kind="review" code={b.status} small /> : '없음'}</td>
              <td>{a ? <St kind="review" code={a.status} small /> : '없음'}</td>
              <td>{desc(a)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function ClaimSide({ label, ids, claims, onOpen }) {
  return (
    <div className="side">
      <p className="side-h">{label}</p>
      {ids.length === 0 ? <p className="muted">연결된 근거 없음</p> : (
        <ul className="cls">
          {ids.map((id) => (
            <li key={id} className="cl cl-2 tone-mute">
              <span className="cl-t">{claims[id] ? claims[id].text : `근거 진술 ${short(id)}`}</span>
              <button type="button" className="link" onClick={() => onOpen(id)}>원문<span className="sr"> 보기</span></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeltaView({ c, deltaId }) {
  const p = { case_id: c.id };
  const dq = useQuery('getReviewDelta', { ...p, delta_id: deltaId });
  const d = dq.data;
  const before = useQuery('getDraftReview', { ...p, review_id: d ? d.before_review_id : '' }, !!d);
  const after = useQuery('getDraftReview', { ...p, review_id: d ? d.after_review_id : '' }, !!d);
  const boardB = useQuery('getRealityBoard', { ...p, pack_id: before.data ? before.data.reality_pack_id : '' }, !!before.data);
  const boardA = useQuery('getRealityBoard', { ...p, pack_id: after.data ? after.data.reality_pack_id : '' }, !!after.data);
  if (!d) return <QueryState q={dq} what="검토 비교" />;
  const B = before.data;
  const A = after.data;
  if (!B || !A) return <><QueryState q={before} what="이전 검토" /><QueryState q={after} what="새 검토" /></>;
  const claims = { ...claimMap(boardB.data), ...claimMap(boardA.data) };
  const find = (key) => {
    const i = A.items.findIndex((x) => x.assertion_key === key);
    if (i >= 0) return { n: i + 1, it: A.items[i], other: B.items.find((x) => x.assertion_key === key) || null };
    const j = B.items.findIndex((x) => x.assertion_key === key);
    return j >= 0 ? { n: j + 1, it: B.items[j], other: null } : { n: null, it: null, other: null };
  };
  const open = (packId, title, ids, focus) => openPanel({ caseId: c.id, packId, title, focus, groups: [{ label: '이 검토가 쓴 근거', tone: 'mute', claimIds: ids }] });
  const qs = Object.fromEntries(A.questions.map((q) => [q.id, q]));
  const qaB = Object.fromEntries(B.question_assessments.map((x) => [x.question_id, x]));
  const active = !!c.head && c.head.review_id === A.id;
  const branch = A.warnings.filter((w) => w.code === 'BRANCH_ONLY');
  return (
    <div>
      <header className="viewhead">
        <div className="viewhead-t">
          <h3>이전 검토와 새 검토</h3>
          <span className={cx('chip', d.comparison_status === 'COMPARABLE' ? 'chip-on' : 'chip-warn')}>{labelOr(L.COMPARISON, d.comparison_status)} <code>{d.comparison_status}</code></span>
          {active ? <span className="chip chip-on">새 검토가 활성 결과</span> : <span className="chip chip-warn">새 검토는 활성 결과 아님</span>}
        </div>
        <div className="pair">
          <Pins items={[{ label: '이전 검토', id: B.id }, { label: '기준 시각', text: when(B.as_of) }, { label: '근거 묶음', id: B.reality_pack_id }, { label: '초안 버전', id: B.content_version_id }]} />
          <Pins items={[{ label: '새 검토', id: A.id }, { label: '기준 시각', text: when(A.as_of) }, { label: '근거 묶음', id: A.reality_pack_id }, { label: '초안 버전', id: A.content_version_id }]} />
        </div>
        <Warnings items={branch} />
        {!active ? <p className="note tone-warn">새 검토는 지금 활성 결과가 아닙니다. 별도 가지로 남아 있으며 최신 결과와 자동으로 합치지 않습니다.</p> : null}
        {d.source_change_ids.length ? <p className="foot">출처 변경 {d.source_change_ids.length}건이 이 비교를 만들었습니다. 변경 내역은 변경과 검색 화면에 있습니다.</p> : null}
        {dq.net ? <QueryState q={dq} /> : null}
      </header>

      {d.comparison_status !== 'COMPARABLE' ? (
        <p className="note tone-warn">초안 본문 버전이 달라 문장을 자동으로 짝짓지 않았습니다. 이전에만 있는 문장과 새로 생긴 문장으로 따로 보여줍니다.</p>
      ) : null}

      <h3>문장별 변화 <span className="count">{d.items.length}</span></h3>
      {d.items.length === 0 ? <Empty /> : (
        <div className="cmp">
          {d.items.map((it) => {
            const f = find(it.assertion_key);
            const changed = !it.change_types.includes('UNCHANGED');
            const recB = f.other ? f.other.recommendation : (f.it && !it.after_status ? f.it.recommendation : null);
            const recA = it.after_status && f.it ? f.it.recommendation : null;
            return (
              <article key={it.assertion_key} className={cx('cmp-row', changed && 'cmp-changed')}>
                <div className="cmp-h">
                  <p className="ms-t">{f.n ? <b>A{f.n} </b> : null}{f.it ? f.it.text : `문장 ${short(it.assertion_key)}`}</p>
                  <p className="cmp-st">
                    <StatusMove kind="review" before={it.before_status} after={it.after_status} />
                    <span className="chips">{it.change_types.map((x) => <span key={x} className={cx('chip', x !== 'UNCHANGED' && 'chip-on')}>{labelOr(L.CHANGE, x)}</span>)}</span>
                  </p>
                  <p className="cmp-why">{changed ? <span className="lbl">달라진 이유</span> : null}<span className={changed ? '' : 'muted'}>{it.reason}</span></p>
                </div>
                <SubMoves before={it.before_subchecks} after={it.after_subchecks} />
                {it.after_subchecks.filter((sc) => sc.calculation).map((sc) => <Calc key={sc.kind} c={sc.calculation} />)}
                {changed ? (
                  <>
                    <div className="pair">
                      <ClaimSide label="이전 검토가 쓴 근거" ids={it.before_claim_ids} claims={claims} onOpen={(id) => open(B.reality_pack_id, f.it ? f.it.text : '', it.before_claim_ids, id)} />
                      <ClaimSide label="새 검토가 쓴 근거" ids={it.after_claim_ids} claims={claims} onOpen={(id) => open(A.reality_pack_id, f.it ? f.it.text : '', it.after_claim_ids, id)} />
                    </div>
                    {recB !== recA ? (
                      <div className="pair">
                        <div className="side"><p className="side-h">이전 권고</p><p>{recB || '없음'}</p></div>
                        <div className="side"><p className="side-h">새 권고</p><p>{recA || '없음'}</p></div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <h3>질문 평가의 변화</h3>
      {A.question_assessments.length === 0 ? <Empty /> : (
        <div className="scroll-x">
          <table className="grid">
            <thead><tr><th scope="col">질문</th><th scope="col">이전에서 이후</th><th scope="col">확인된 것과 남은 것</th></tr></thead>
            <tbody>
              {A.question_assessments.map((a) => {
                const q = qs[a.question_id] || {};
                const b = qaB[a.question_id];
                return (
                  <tr key={a.question_id} className={cx(b && b.status !== a.status && 'row-on')}>
                    <td className={cx(q.parent_id && 'td-child')}><span className="mono">{q.question_key}</span> {q.question}</td>
                    <td><StatusMove kind="question" before={b ? b.status : null} after={a.status} /></td>
                    <td>
                      {a.resolution_claim_ids.length ? (
                        <p>{a.resolution_claim_ids.map((id) => (claims[id] ? claims[id].text : short(id))).join(' / ')}{' '}
                          <button type="button" className="link" onClick={() => open(A.reality_pack_id, `${q.question_key} ${q.question}`, a.resolution_claim_ids, a.resolution_claim_ids[0])}>원문<span className="sr"> 보기</span></button></p>
                      ) : null}
                      {a.calculation ? <p>같은 범위 기준 {pctText(a.calculation)}</p> : null}
                      {a.needed_evidence.length ? <p><span className="lbl">남은 자료</span>{a.needed_evidence.join(', ')}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="foot">새 결과가 더 늦게 만들어졌다는 이유만으로 더 정확하다고 보지 않습니다. 이전 검토는 지워지지 않고 그때의 판정 그대로 열 수 있습니다. 초안 문장은 사람이 새 버전으로 고쳐 저장합니다.</p>
      <div className="actbar">
        <div className="actbar-l"></div>
        <div className="actbar-r">
          <Btn onClick={() => go({ tab: 'review', view: { kind: 'review', id: B.id }, sub: 'sheet' })}>이전 검토 열기</Btn>
          <Btn onClick={() => go({ tab: 'review', view: { kind: 'review', id: A.id }, sub: 'sheet' })}>새 검토 열기</Btn>
          <Btn kind="primary" onClick={() => go({ tab: 'intake' })}>초안 고쳐 새 버전 저장</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 초안 없는 비교
function BriefCompare({ c, briefs }) {
  const sorted = [...briefs].sort((a, b) => a.as_of.localeCompare(b.as_of) || a.created_at.localeCompare(b.created_at));
  const [bId, setB] = useState(sorted[sorted.length - 2].id);
  const [aId, setA] = useState(sorted[sorted.length - 1].id);
  const tasks = useQuery('listReportingTasks', { case_id: c.id });
  const B = sorted.find((x) => x.id === bId) || sorted[0];
  const A = sorted.find((x) => x.id === aId) || sorted[sorted.length - 1];
  const boardA = useQuery('getRealityBoard', { case_id: c.id, pack_id: A.reality_pack_id });
  const claims = claimMap(boardA.data);
  const known = (b) => b.sections.find((s) => s.section === 'WHAT_WE_KNOW').items;
  const kB = known(B).map((x) => x.claim_ids[0]);
  const kA = known(A).map((x) => x.claim_ids[0]);
  const added = known(A).filter((x) => !kB.includes(x.claim_ids[0]));
  const removed = known(B).filter((x) => !kA.includes(x.claim_ids[0]));
  const qaB = Object.fromEntries(B.question_assessments.map((x) => [x.question_id, x]));
  const qs = Object.fromEntries(A.questions.map((q) => [q.id, q]));
  const related = tasks.data ? tasks.data.items.filter((t) => t.brief_id === B.id || t.brief_id === A.id) : [];
  const opt = (b) => <option key={b.id} value={b.id}>Brief · 기준 {whenShort(b.as_of)} · {short(b.id)}</option>;
  const open = (title, ids) => openPanel({ caseId: c.id, packId: A.reality_pack_id, title, focus: ids[0], groups: [{ label: '새 근거', tone: 'mute', claimIds: ids }] });
  return (
    <div>
      <header className="viewhead">
        <div className="viewhead-t"><h3>이전 Brief와 새 Brief</h3></div>
        <div className="form-grid">
          <div className="viewpick"><label htmlFor="cmp-b">이전</label><select id="cmp-b" value={B.id} onChange={(e) => setB(e.target.value)}>{sorted.map(opt)}</select></div>
          <div className="viewpick"><label htmlFor="cmp-a">이후</label><select id="cmp-a" value={A.id} onChange={(e) => setA(e.target.value)}>{sorted.map(opt)}</select></div>
        </div>
        <div className="pair">
          <Pins items={[{ label: '이전 Brief', id: B.id }, { label: '기준 시각', text: when(B.as_of) }, { label: '근거 묶음', id: B.reality_pack_id }]} />
          <Pins items={[{ label: '새 Brief', id: A.id }, { label: '기준 시각', text: when(A.as_of) }, { label: '근거 묶음', id: A.reality_pack_id }]} />
        </div>
        <p className="note tone-info">초안이 없어 문장별 비교는 없습니다. 근거 묶음, 질문 평가, 원문, 과제 이력으로 달라진 부분을 봅니다.</p>
      </header>
      <h3>질문 평가의 변화</h3>
      <div className="scroll-x">
        <table className="grid">
          <thead><tr><th scope="col">질문</th><th scope="col">이전에서 이후</th><th scope="col">확인된 것과 남은 것</th></tr></thead>
          <tbody>
            {A.question_assessments.map((a) => {
              const q = qs[a.question_id] || {};
              const b = qaB[a.question_id];
              return (
                <tr key={a.question_id} className={cx(b && b.status !== a.status && 'row-on')}>
                  <td className={cx(q.parent_id && 'td-child')}><span className="mono">{q.question_key}</span> {q.question}</td>
                  <td><StatusMove kind="question" before={b ? b.status : null} after={a.status} /></td>
                  <td>
                    {a.calculation ? <p>같은 범위 기준 {pctText(a.calculation)}</p> : null}
                    {a.needed_evidence.length ? <p><span className="lbl">남은 자료</span>{a.needed_evidence.join(', ')}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>지금 말할 수 있는 것의 변화</h3>
      {added.length === 0 && removed.length === 0 ? <Empty>달라진 진술 없음</Empty> : (
        <ul className="cls">
          {added.map((x) => (
            <li key={x.id} className="cl tone-ok"><span className="cl-l">새로 생김</span><span className="cl-t">{x.text}</span>
              <button type="button" className="link" onClick={() => open(x.text, x.claim_ids)}>원문<span className="sr"> 보기</span></button></li>
          ))}
          {removed.map((x) => <li key={x.id} className="cl tone-mute"><span className="cl-l">빠짐</span><span className="cl-t">{x.text}{claims[x.claim_ids[0]] ? '' : ' (이전 기록으로 이동)'}</span></li>)}
        </ul>
      )}
      <h3>과제 이력 <span className="count">{related.length}</span></h3>
      {related.length === 0 ? <Empty /> : (
        <ul className="plain">
          {related.map((t) => <li key={t.id}>{t.title} <St kind="task" code={t.status} small /> <span className="muted">{t.brief_id === B.id ? '이전 Brief에서 만든 과제' : '새 Brief에서 만든 과제'} · 고친 시각 {whenShort(t.updated_at)}</span></li>)}
        </ul>
      )}
      <p className="foot">이전 근거 묶음과 Brief, 과제는 그대로 보존됩니다. 초안 검토를 대신 만들어 내지 않습니다.</p>
    </div>
  );
}

// ---------------------------------------------------------------- screen
export function CompareScreen({ c }) {
  const route = useStore(app, (s) => s.route);
  const led = useStore(app, (s) => s.ledger[c.id]);
  const jobs = useStore(app, (s) => s.jobs);
  const deltas = led ? led.delta : [];
  const briefs = led ? led.brief.map((id) => jobs[id] && jobs[id].data).filter(Boolean) : [];
  const deltaId = route.deltaId && deltas.includes(route.deltaId) ? route.deltaId : deltas[deltas.length - 1];
  const draftless = !c.head || !c.head.content_version_id;
  const label = (id) => {
    const d = jobs[id] && jobs[id].data;
    return d ? `검토 ${short(d.before_review_id)} → ${short(d.after_review_id)} · 만든 시각 ${whenShort(d.created_at)}` : `비교 ${short(id)}`;
  };
  return (
    <div className="screen">
      <div className="screen-top">
        <h2>검토 비교</h2>
        {deltas.length ? (
          <div className="viewpick">
            <label htmlFor="cmp-pick">비교</label>
            <select id="cmp-pick" value={deltaId} onChange={(e) => go({ deltaId: e.target.value })}>
              {deltas.map((id) => <option key={id} value={id}>{label(id)}</option>)}
            </select>
          </div>
        ) : null}
      </div>
      <p className="lede">이전 결과와 새 결과에서 무엇이 왜 달라졌는지 봅니다. 이전 결과는 지워지지 않습니다.</p>
      {deltaId ? <DeltaView key={deltaId} c={c} deltaId={deltaId} /> : null}
      {!deltaId && draftless && briefs.length >= 2 ? <BriefCompare c={c} briefs={briefs} /> : null}
      {!deltaId && !(draftless && briefs.length >= 2) ? (
        <div className="note tone-info">
          <p className="note-h">아직 비교할 두 결과가 없습니다</p>
          <p>{draftless ? '초안 없는 검토는 Brief가 둘 이상 있을 때 비교합니다. 취재 결과를 넣어 근거를 다시 실행하고 새 Brief를 만들면 여기에 나타납니다.' : '취재 결과를 넣어 재검토하거나 출처가 정정되어 다시 검토되면, 이전 검토와 새 검토의 차이가 여기에 나타납니다.'}</p>
          <p><Btn onClick={() => go({ tab: 'results' })}>취재 결과로</Btn></p>
        </div>
      ) : null}
    </div>
  );
}
