// Pieces several case sections draw the same way: evidence lines with their
// [C1] chips, the server's integer calculation, sub-checks and the question tree.
import { Calculator, CornerDownRight } from 'lucide-react';
import * as L from '../labels.js';
import { Status } from '../ui/status.jsx';
import { Empty, More, KV, Code, cx, labelOr } from '../ui/kit.jsx';

export function claimMap(board) {
  const out = {};
  if (board) [...board.what_we_know, ...board.history].forEach((c) => { out[c.claim_id] = c; });
  return out;
}
export const uniq = (a) => [...new Set(a)];

// one evidence statement, with the chip that opens its source text
export function EvidenceLine({ id, claims, onOpen, muted }) {
  const c = claims[id];
  return (
    <li className={cx('flex items-start gap-2 text-sm leading-relaxed', muted ? 'text-g500' : 'text-g700')}>
      <span aria-hidden="true" className="mt-[9px] size-1 shrink-0 rounded-full bg-g400" />
      <span className="min-w-0">
        {c ? c.text : '근거 진술'}{c && c.superseded ? <span className="text-g400"> (정정 이전 기록)</span> : null}{' '}
        <button type="button" onClick={() => onOpen(id)}
          className="num whitespace-nowrap rounded bg-brand-bg px-1 align-[1px] text-[11px] font-semibold text-brand transition hover:bg-brand hover:text-white">
          [{c && c.key ? c.key : '원문'}]<span className="sr-only"> 원문 보기: {c ? c.text : ''}</span>
        </button>
      </span>
    </li>
  );
}

// two columns of evidence, like the MarketView decision card (긍정 근거 / 저항 근거)
export function EvidenceColumns({ sup, con, rel, claims, onOpen, supLabel = '뒷받침하는 근거', conLabel = '반박하는 근거' }) {
  if (!sup.length && !con.length && !(rel && rel.length)) return <p className="text-sm text-g500">연결된 근거 진술이 없습니다.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sup.length ? (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-positive-ink">{supLabel}</p>
          <ul className="space-y-1">{sup.map((id) => <EvidenceLine key={id} id={id} claims={claims} onOpen={onOpen} />)}</ul>
        </div>
      ) : null}
      {con.length ? (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-negative-ink">{conLabel}</p>
          <ul className="space-y-1">{con.map((id) => <EvidenceLine key={id} id={id} claims={claims} onOpen={onOpen} />)}</ul>
        </div>
      ) : null}
      {rel && rel.length ? (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-g600">함께 본 근거</p>
          <ul className="space-y-1">{rel.map((id) => <EvidenceLine key={id} id={id} claims={claims} onOpen={onOpen} muted />)}</ul>
        </div>
      ) : null}
    </div>
  );
}

// The server keeps a decrease positive and an increase negative.
export const rising = (c) => String(c.exact_percent).startsWith('-');
export function pctText(c) {
  const up = rising(c);
  return `${up ? String(c.exact_percent).slice(1) : c.exact_percent}% ${up ? '증가' : '감소'}`;
}

export function Calc({ c }) {
  const n = (x) => x.toLocaleString('ko-KR');
  const up = rising(c);
  const mag = (v) => String(v).replace(/^-/, '');
  return (
    <div className="rounded-xl border border-g100 bg-g50 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-g800"><Calculator className="size-4 text-g500" aria-hidden="true" />같은 범위로 다시 계산한 값</p>
      <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-g500">{c.previous_period}년</dt><dd className="tabular-nums text-g800">{L.won(c.previous_amount)}</dd>
        <dt className="text-g500">{c.current_period}년</dt><dd className="tabular-nums text-g800">{L.won(c.current_amount)}</dd>
        <dt className="text-g500">{up ? '증가율' : '감소율'}</dt>
        <dd className="text-g800"><b className="text-base tabular-nums text-g900">{mag(c.display_percent)}%</b> <span className="text-g500">{up ? '늘었습니다' : '줄었습니다'}</span></dd>
        {c.excluded_furniture_amount ? (
          <><dt className="text-g500">비교에서 뺀 것</dt><dd className="text-g700">범위가 다른 금액 {L.won(c.excluded_furniture_amount)} (합산 {L.won(c.previous_total)}은 비교 기준으로 쓰지 않음)</dd></>
        ) : null}
      </dl>
      <More className="mt-2" label="계산식">
        <p className="num">
          {up ? <>({n(c.current_amount)} − {n(c.previous_amount)}) ÷ {n(c.previous_amount)} × 100</> : <>({n(c.previous_amount)} − {n(c.current_amount)}) ÷ {n(c.previous_amount)} × 100</>}
          {' = '}{mag(c.exact_percent)}% · 표시값 {mag(c.display_percent)}% · {c.rounding}
        </p>
        <p className="mt-1">서버가 원 단위 정수로 계산한 값입니다.</p>
      </More>
    </div>
  );
}

export function Subchecks({ list }) {
  if (!list || !list.length) return null;
  return (
    <div className="rounded-xl border border-g100">
      <p className="border-b border-g100 px-4 py-2 text-xs font-semibold text-g500">문장을 나눠 본 판정</p>
      <ul className="divide-y divide-g100">
        {list.map((sc) => (
          <li key={sc.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <span className="w-12 shrink-0 font-semibold text-g700">{labelOr(L.KIND, sc.kind)}</span>
            <Status kind="review" code={sc.status} />
            <span className="min-w-0 flex-1 text-g600">
              {sc.expected_percent !== null ? <>초안 {sc.expected_percent}%{sc.observed_percent !== null ? ` · 근거 ${sc.observed_percent}%` : ' · 비교할 같은 범위 근거 없음'}</> : null}
              {sc.needed_evidence.length ? <>{sc.expected_percent !== null ? ' · ' : ''}필요한 근거: {sc.needed_evidence.join(', ')}</> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuestionTree({ questions, assessments, claims, onOpen }) {
  if (!questions.length) return <Empty />;
  const byId = Object.fromEntries(assessments.map((a) => [a.question_id, a]));
  const row = (q, depth) => {
    const a = byId[q.id];
    const kids = questions.filter((x) => x.parent_id === q.id);
    return (
      <li key={q.id} className={cx(depth > 0 && 'ml-4 border-l-2 border-g100 pl-4 sm:ml-6')}>
        <div className="rounded-xl border border-g200 bg-white p-4">
          <div className="flex flex-wrap items-start gap-2">
            {depth > 0 ? <CornerDownRight className="mt-0.5 size-4 text-g300" aria-hidden="true" /> : null}
            <span className="num rounded-md bg-g100 px-1.5 py-0.5 text-xs font-bold text-g600">{q.question_key}</span>
            <p className="min-w-0 flex-1 text-sm font-semibold text-g900">{q.question}</p>
            {a ? <Status kind="question" code={a.status} /> : <span className="text-xs text-g400">평가 없음</span>}
          </div>
          {a && a.resolution_claim_ids.length ? (
            <ul className="mt-2.5 space-y-1">{a.resolution_claim_ids.map((id) => <EvidenceLine key={id} id={id} claims={claims} onOpen={(cid) => onOpen(q, a, cid)} />)}</ul>
          ) : null}
          {a && a.calculation ? <div className="mt-3"><Calc c={a.calculation} /></div> : null}
          {a && a.needed_evidence.length ? <p className="mt-2.5 text-sm text-g600"><b className="font-semibold text-g700">남은 자료</b> · {a.needed_evidence.join(', ')}</p> : null}
          {a ? <More className="mt-2"><KV rows={[['상태 코드', <Code key="s">{a.status}</Code>], ['평가 근거', a.reason]]} /></More> : null}
        </div>
        {kids.length ? <ul className="mt-2 space-y-2">{kids.map((k) => row(k, depth + 1))}</ul> : null}
      </li>
    );
  };
  return <ul className="space-y-2">{questions.filter((q) => !q.parent_id).map((q) => row(q, 0))}</ul>;
}

// review status counts in a fixed order
export const REVIEW_ORDER = ['SUPPORTED', 'CONFLICT', 'CONTRADICTED', 'INSUFFICIENT_EVIDENCE', 'NON_FACTUAL'];
export function countStatus(items) {
  const n = Object.fromEntries(REVIEW_ORDER.map((k) => [k, 0]));
  items.forEach((it) => { n[it.status] = (n[it.status] || 0) + 1; });
  return n;
}
