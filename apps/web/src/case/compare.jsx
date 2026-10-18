// 검토 비교: 같은 초안의 이전 검토와 새 검토(문장별로 무엇이 왜 바뀌었나), 또는 초안 없는 두 기획 요약.
import { useState } from 'react';
import { ArrowRight, GitCompareArrows, PenLine } from 'lucide-react';
import * as L from '../labels.js';
import { go, openPanel } from '../app/store.js';
import { useQuery } from '../app/api.js';
import { Status } from '../ui/status.jsx';
import { Card, Btn, Notice, More, KV, IdLine, Code, Tag, Empty, Select, QueryState, Warnings, cx, labelOr } from '../ui/kit.jsx';
import { when, whenShort } from '../app/time.js';
import { claimMap, EvidenceLine, Calc, pctText } from './shared.jsx';

function StatusMove({ kind, before, after }) {
  if (before === after) return <span className="inline-flex items-center gap-1.5"><Status kind={kind} code={after} /><span className="text-xs text-g400">그대로</span></span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {before ? <Status kind={kind} code={before} /> : <span className="text-xs text-g400">없음</span>}
      <ArrowRight className="size-3.5 text-g400" aria-hidden="true" /><span className="sr-only">에서</span>
      {after ? <Status kind={kind} code={after} /> : <span className="text-xs text-g400">없음</span>}
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
    <div className="rounded-xl border border-g100">
      <p className="border-b border-g100 px-4 py-2 text-xs font-semibold text-g500">나눠 본 판정의 변화</p>
      <ul className="divide-y divide-g100">
        {kinds.map((k) => {
          const b = before.find((s) => s.kind === k);
          const a = after.find((s) => s.kind === k);
          return (
            <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="w-12 shrink-0 font-semibold text-g700">{labelOr(L.KIND, k)}</span>
              <StatusMove kind="review" before={b ? b.status : null} after={a ? a.status : null} />
              <span className="min-w-0 grow basis-40 text-xs text-g500">{desc(a)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ClaimSide({ label, ids, claims, onOpen }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-g600">{label}</p>
      {ids.length === 0 ? <p className="text-sm text-g400">연결된 근거 없음</p> : <ul className="space-y-1">{ids.map((id) => <EvidenceLine key={id} id={id} claims={claims} onOpen={onOpen} />)}</ul>}
    </div>
  );
}

function QuestionMoves({ A, qaB, qs, claims, open }) {
  if (!A.question_assessments.length) return <Empty />;
  return (
    <ul className="space-y-2">
      {A.question_assessments.map((a) => {
        const q = qs[a.question_id] || {};
        const b = qaB[a.question_id];
        const moved = b && b.status !== a.status;
        return (
          <li key={a.question_id} className={cx('rounded-xl border p-3.5', moved ? 'border-brand/40 bg-brand-bg/30' : 'border-g100', q.parent_id && 'ml-4 sm:ml-6')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="num rounded-md bg-g100 px-1.5 py-0.5 text-xs font-bold text-g600">{q.question_key}</span>
              <p className="min-w-0 grow basis-48 text-sm font-semibold text-g900">{q.question}</p>
              <StatusMove kind="question" before={b ? b.status : null} after={a.status} />
            </div>
            {a.resolution_claim_ids.length && open ? (
              <ul className="mt-2 space-y-1">{a.resolution_claim_ids.map((id) => <EvidenceLine key={id} id={id} claims={claims} onOpen={(cid) => open(`${q.question_key} ${q.question}`, a.resolution_claim_ids, cid)} />)}</ul>
            ) : null}
            {a.calculation ? <p className="mt-2 text-sm text-g700">같은 범위 기준 <b>{pctText(a.calculation)}</b></p> : null}
            {a.needed_evidence.length ? <p className="mt-1.5 text-sm text-g600"><b className="font-semibold text-g700">남은 자료</b> · {a.needed_evidence.join(', ')}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function DeltaView({ f, deltaId }) {
  const { c } = f;
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
  const changed = d.items.filter((it) => !it.change_types.includes('UNCHANGED')).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={d.comparison_status === 'COMPARABLE' ? 'brand' : 'warn'}>{labelOr(L.COMPARISON, d.comparison_status)}</Tag>
        {active ? <Tag tone="brand">새 검토가 활성 결과</Tag> : <Tag tone="warn">새 검토는 활성 결과 아님</Tag>}
        <span className="text-xs text-g500">이전 기준 {when(B.as_of)} → 새 기준 {when(A.as_of)} · 바뀐 문장 {changed}개</span>
        <More className="ml-auto">
          <KV rows={[['비교', <IdLine key="d" v={d.id} />], ['이전 검토', <IdLine key="b" v={B.id} />], ['새 검토', <IdLine key="a" v={A.id} />],
            ['이전 근거 묶음', <IdLine key="bp" v={B.reality_pack_id} />], ['새 근거 묶음', <IdLine key="ap" v={A.reality_pack_id} />], ['비교 코드', <Code key="s">{d.comparison_status}</Code>]]} />
        </More>
      </div>
      <Warnings items={branch} />
      {!active ? <Notice tone="warn">새 검토는 지금 활성 결과가 아닙니다. 별도 가지로 남아 있으며 최신 결과와 자동으로 합치지 않습니다.</Notice> : null}
      {d.comparison_status !== 'COMPARABLE' ? <Notice tone="warn">초안 본문 버전이 달라 문장을 자동으로 짝짓지 않았습니다. 이전에만 있는 문장과 새로 생긴 문장으로 따로 보여 줍니다.</Notice> : null}
      {d.source_change_ids.length ? <p className="text-xs text-g500">출처 변경 {d.source_change_ids.length}건이 이 비교를 만들었습니다. 변경 내역은 아래 '출처 변경 알림'에 있습니다.</p> : null}

      {d.items.length === 0 ? <Empty /> : (
        <div className="space-y-3">
          {d.items.map((it) => {
            const fd = find(it.assertion_key);
            const moved = !it.change_types.includes('UNCHANGED');
            const recB = fd.other ? fd.other.recommendation : (fd.it && !it.after_status ? fd.it.recommendation : null);
            const recA = it.after_status && fd.it ? fd.it.recommendation : null;
            return (
              <article key={it.assertion_key} className={cx('rounded-2xl border bg-white p-5 shadow-sm', moved ? 'border-brand/40' : 'border-g200')}>
                <div className="flex flex-wrap items-start gap-3">
                  {fd.n ? <span className="num mt-0.5 rounded-md bg-g900 px-1.5 py-0.5 text-xs font-bold text-white">A{fd.n}</span> : null}
                  <p className="min-w-0 grow basis-56 text-[15px] leading-relaxed text-g900">{fd.it ? fd.it.text : '문장'}</p>
                  <StatusMove kind="review" before={it.before_status} after={it.after_status} />
                </div>
                {/* 바뀌지 않은 문장은 판정 옆의 '그대로'로 충분하므로 변경 종류 표시를 생략합니다 */}
                {moved ? <div className="mt-2 flex flex-wrap gap-1.5">{it.change_types.map((x) => <Tag key={x} tone="brand">{labelOr(L.CHANGE, x)}</Tag>)}</div> : null}
                <p className={cx('mt-3 text-sm leading-relaxed', moved ? 'text-g800' : 'text-g500')}>{moved ? <b className="text-g900">달라진 이유 · </b> : null}{it.reason}</p>
                {it.before_subchecks.length || it.after_subchecks.length ? <div className="mt-3"><SubMoves before={it.before_subchecks} after={it.after_subchecks} /></div> : null}
                {it.after_subchecks.filter((sc) => sc.calculation).map((sc) => <div key={sc.kind} className="mt-3"><Calc c={sc.calculation} /></div>)}
                {moved && recB !== recA ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-g50 px-4 py-3 text-sm"><p className="text-xs font-semibold text-g500">이전 권고</p><p className="mt-1 text-g600">{recB || '없음'}</p></div>
                    <div className="rounded-xl bg-brand-bg px-4 py-3 text-sm"><p className="text-xs font-semibold text-brand">새 권고</p><p className="mt-1 text-g800">{recA || '없음'}</p></div>
                  </div>
                ) : null}
                {moved ? (
                  <More className="mt-3" label="이전과 새 검토가 쓴 근거">
                    <div className="grid gap-4 md:grid-cols-2">
                      <ClaimSide label="이전 검토" ids={it.before_claim_ids} claims={claims} onOpen={(id) => open(B.reality_pack_id, fd.it ? fd.it.text : '', it.before_claim_ids, id)} />
                      <ClaimSide label="새 검토" ids={it.after_claim_ids} claims={claims} onOpen={(id) => open(A.reality_pack_id, fd.it ? fd.it.text : '', it.after_claim_ids, id)} />
                    </div>
                  </More>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <Card title="질문 평가의 변화">
        <QuestionMoves A={A} qaB={qaB} qs={qs} claims={claims} open={(title, ids, focus) => open(A.reality_pack_id, title, ids, focus)} />
      </Card>
      <p className="text-xs text-g500">새 결과가 더 늦게 만들어졌다는 이유만으로 더 정확하다고 보지 않습니다. 이전 검토는 지워지지 않고 그때의 판정 그대로 열 수 있습니다. 초안 문장은 사람이 새 버전으로 고쳐 저장합니다.</p>
      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => go({ to: 'sec-review', view: { kind: 'review', id: B.id }, sub: 'sheet' })}>이전 검토 열기</Btn>
        <Btn onClick={() => go({ to: 'sec-review', view: { kind: 'review', id: A.id }, sub: 'sheet' })}>새 검토 열기</Btn>
        {f.write ? <Btn kind="primary" icon={PenLine} onClick={() => go({ to: 'sec-input', intakeOpen: true })}>초안 고쳐 새 버전 저장</Btn> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 초안 없는 비교
export function BriefCompare({ f }) {
  const sorted = f.briefs;
  const [bId, setB] = useState(sorted[sorted.length - 2].id);
  const [aId, setA] = useState(sorted[sorted.length - 1].id);
  const B = sorted.find((x) => x.id === bId) || sorted[0];
  const A = sorted.find((x) => x.id === aId) || sorted[sorted.length - 1];
  const boardA = useQuery('getRealityBoard', { case_id: f.c.id, pack_id: A.reality_pack_id });
  const claims = claimMap(boardA.data);
  const known = (b) => b.sections.find((s) => s.section === 'WHAT_WE_KNOW').items;
  const kB = known(B).map((x) => x.claim_ids[0]);
  const kA = known(A).map((x) => x.claim_ids[0]);
  const added = known(A).filter((x) => !kB.includes(x.claim_ids[0]));
  const removed = known(B).filter((x) => !kA.includes(x.claim_ids[0]));
  const qaB = Object.fromEntries(B.question_assessments.map((x) => [x.question_id, x]));
  const qs = Object.fromEntries(A.questions.map((q) => [q.id, q]));
  const related = f.tasks.filter((t) => t.brief_id === B.id || t.brief_id === A.id);
  const opt = (b) => <option key={b.id} value={b.id}>기획 요약 · 기준 {whenShort(b.as_of)}</option>;
  const open = (title, ids) => openPanel({ caseId: f.c.id, packId: A.reality_pack_id, title, focus: ids[0], groups: [{ label: '새 근거', tone: 'mute', claimIds: ids }] });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="cmp-b" className="mb-1 block text-xs text-g500">이전</label><Select small id="cmp-b" value={B.id} onChange={(e) => setB(e.target.value)}>{sorted.map(opt)}</Select></div>
        <div><label htmlFor="cmp-a" className="mb-1 block text-xs text-g500">이후</label><Select small id="cmp-a" value={A.id} onChange={(e) => setA(e.target.value)}>{sorted.map(opt)}</Select></div>
      </div>
      <Notice tone="mute">초안이 없어 문장별 비교는 없습니다. 근거, 질문 평가, 과제 이력으로 달라진 부분을 봅니다.</Notice>
      <Card title="질문 평가의 변화"><QuestionMoves A={A} qaB={qaB} qs={qs} claims={claims} open={null} /></Card>
      <Card title="지금 말할 수 있는 것의 변화">
        {added.length === 0 && removed.length === 0 ? <Empty>달라진 진술 없음</Empty> : (
          <ul className="space-y-2">
            {added.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start gap-2 text-sm"><Tag tone="pos">새로 생김</Tag><span className="min-w-0 flex-1 text-g800">{x.text}</span>
                <Btn size="sm" kind="soft" onClick={() => open(x.text, x.claim_ids)}>원문</Btn></li>
            ))}
            {removed.map((x) => <li key={x.id} className="flex flex-wrap items-start gap-2 text-sm"><Tag>빠짐</Tag><span className="min-w-0 flex-1 text-g500">{x.text}{claims[x.claim_ids[0]] ? '' : ' (이전 기록으로 이동)'}</span></li>)}
          </ul>
        )}
      </Card>
      <Card title={`과제 이력 ${related.length}`}>
        {related.length === 0 ? <Empty /> : (
          <ul className="space-y-1.5">{related.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="text-g800">{t.title}</span><Status kind="task" code={t.status} /><span className="text-xs text-g500">{t.brief_id === B.id ? '이전 요약에서 만든 과제' : '새 요약에서 만든 과제'} · 고친 시각 {whenShort(t.updated_at)}</span></li>)}</ul>
        )}
      </Card>
      <p className="text-xs text-g500">이전 근거 묶음과 기획 요약, 과제는 그대로 보존됩니다. 초안 검토를 대신 만들어 내지 않습니다.</p>
    </div>
  );
}

// the comparison block of the reassessment section
export function CompareBlock({ f, deltaId, onPick }) {
  const deltas = f.deltas;
  const id = deltaId && deltas.some((d) => d.id === deltaId) ? deltaId : (deltas[deltas.length - 1] || {}).id;
  const label = (d) => `비교 · 만든 시각 ${whenShort(d.created_at)}`;
  return (
    <div id="sec-compare" className="scroll-mt-28 rounded-2xl border-2 border-brand-bg bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-g900"><GitCompareArrows className="size-4 text-brand" aria-hidden="true" />무엇이 왜 바뀌었나</h3>
        {deltas.length > 1 ? (
          <Select small label="보는 비교" value={id} onChange={(e) => onPick(e.target.value)} className="ml-auto w-[220px]">
            {deltas.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}
          </Select>
        ) : null}
      </div>
      {id ? <DeltaView key={id} f={f} deltaId={id} /> : <BriefCompare f={f} />}
    </div>
  );
}
