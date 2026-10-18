// 3단계 초안 검토 (초안이 없으면 기획 요약): 문장별 판정 카드, 기획 요약, 질문과 취재 행동.
import { useState } from 'react';
import { ListChecks, FileText, CircleHelp, Quote, Check, ListPlus, ClipboardList, Search, FileDown, Undo2 } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, go, openPanel } from '../app/store.js';
import { useQuery, useAction } from '../app/api.js';
import { Status } from '../ui/status.jsx';
import { Section, Card, Btn, LinkBtn, Notice, More, KV, IdLine, Code, Tag, Labels, Empty, PillTabs, Select, QueryState, ActionState, Check2, Warnings, cx, labelOr } from '../ui/kit.jsx';
import { when, whenShort } from '../app/time.js';
import { useCase, defaultView, isDone } from './facts.js';
import { claimMap, EvidenceColumns, Calc, Subchecks, QuestionTree, uniq } from './shared.jsx';
import { JobProgress, JobFailed } from './jobs.jsx';

// ---------------------------------------------------------------- which result
function ViewPicker({ f, view }) {
  const opts = [...f.reviews.map((d) => ({ kind: 'review', d })), ...f.briefs.map((d) => ({ kind: 'brief', d }))]
    .sort((a, b) => a.d.as_of.localeCompare(b.d.as_of) || a.d.created_at.localeCompare(b.d.created_at));
  if (opts.length < 2) return null;
  const head = f.head;
  const text = (o) => {
    const active = o.kind === 'review' ? head.review_id === o.d.id : !head.review_id && head.pack_id === o.d.reality_pack_id;
    return `${o.kind === 'review' ? '초안 검토' : '기획 요약'} · 기준 ${whenShort(o.d.as_of)} · ${labelOr(L.JOB_STATUS, o.d.status)}${active ? ' · 활성' : ''}`;
  };
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="viewpick" className="text-xs text-g500">보는 결과</label>
      <Select small id="viewpick" value={view ? `${view.kind}:${view.id}` : ''} className="w-[240px] max-w-full"
        onChange={(e) => { const [kind, id] = e.target.value.split(':'); go({ view: { kind, id }, sub: kind === 'review' ? 'sheet' : 'brief' }); }}>
        {opts.map((o) => <option key={o.d.id} value={`${o.kind}:${o.d.id}`}>{text(o)}</option>)}
      </Select>
    </div>
  );
}

function ResultHead({ status, active, branch, asOf, extra, ids }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Status kind="job" code={status} />
      {active ? <Tag tone="brand">활성 결과</Tag> : <Tag tone="warn">활성 결과 아님</Tag>}
      {branch ? <Tag tone="warn">별도 가지로 보존</Tag> : null}
      <span className="text-xs text-g500">기준 {when(asOf)}{extra ? ` · ${extra}` : ''}</span>
      <More className="ml-auto">{ids}</More>
    </div>
  );
}

function Excluded({ board }) {
  if (!board) return null;
  const off = board.sources.filter((s) => !s.included);
  if (!off.length) return null;
  return (
    <Notice tone="warn" title="근거에서 뺀 자료">
      <ul className="list-disc pl-4">{off.map((s) => <li key={s.key}>{s.title}: {L.EXCLUDED[s.excluded_reason] || s.excluded_reason}</li>)}</ul>
    </Notice>
  );
}

// warnings the evidence section has not already shown for the same pack
function ownWarnings(list, board) {
  const shown = board && board.pack && board.pack.warnings ? board.pack.warnings : [];
  return (list || []).filter((w) => w.code !== 'BRANCH_ONLY' && !shown.some((p) => p.code === w.code && p.message === w.message));
}

// ---------------------------------------------------------------- 문장별 판정
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

function SentenceCard({ c, r, it, n, claims, write, on, onToggle }) {
  const qs = Object.fromEntries(r.questions.map((q) => [q.id, q]));
  const qa = Object.fromEntries(r.question_assessments.map((a) => [a.question_id, a]));
  const rel = it.claim_ids.filter((id) => !it.supporting_claim_ids.includes(id) && !it.contradicting_claim_ids.includes(id));
  const linked = [...it.conflict_ids, ...it.unknown_ids].filter((id) => qs[id]);
  const open = (focus) => openPanel({
    caseId: c.id, packId: r.reality_pack_id, title: `A${n} ${it.text}`, focus,
    groups: [
      { label: '뒷받침하는 근거', tone: 'ok', claimIds: it.supporting_claim_ids },
      { label: '반박하는 근거', tone: 'bad', claimIds: it.contradicting_claim_ids },
      { label: '함께 본 근거', tone: 'mute', claimIds: rel },
    ],
  });
  return (
    <article className="rounded-2xl border border-g200 bg-white p-5 shadow-sm" aria-labelledby={`a-${it.assertion_id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="num mt-0.5 rounded-md bg-g900 px-1.5 py-0.5 text-xs font-bold text-white">A{n}</span>
        <p id={`a-${it.assertion_id}`} className="min-w-0 flex-1 text-[15px] leading-relaxed text-g900">{it.text}</p>
        <Status kind="review" code={it.status} size="lg" />
      </div>
      <p className="mt-2 text-xs text-g500">
        {labelOr(L.KIND, it.kind)} 문장 · {it.reason_codes.map((x) => L.REASON[x] || x).join(' · ')}
        {r.status === 'PARTIAL' ? <span className="ml-1 font-semibold text-warning-ink">· 부분 결과 기준</span> : null}
      </p>
      <div className="mt-3 rounded-xl bg-g50 px-4 py-3 text-sm leading-relaxed text-g800"><b className="text-g900">권고</b> · {it.recommendation}</div>
      {it.subchecks.length ? <div className="mt-3"><Subchecks list={it.subchecks} /></div> : null}
      {it.subchecks.filter((sc) => sc.calculation).map((sc) => <div key={sc.kind} className="mt-3"><Calc c={sc.calculation} /></div>)}
      <div className="mt-4">
        <EvidenceColumns sup={it.supporting_claim_ids} con={it.contradicting_claim_ids} rel={rel} claims={claims} onOpen={open} />
      </div>
      {it.needed_evidence.length ? <p className="mt-3 text-sm text-g600"><b className="font-semibold text-g700">필요한 근거</b> · {it.needed_evidence.join(', ')}</p> : null}
      {linked.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-g700">연결된 질문</span>
          {linked.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-lg border border-g200 px-2 py-1 text-xs text-g700">
              <span className="num font-bold">{qs[id].question_key}</span>{qs[id].question}{qa[id] ? <Status kind="question" code={qa[id].status} /> : null}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-g100 pt-3">
        {write ? <Btn size="sm" kind={on ? 'soft' : 'second'} icon={on ? Check : ListPlus} aria-pressed={on} onClick={onToggle}>{on ? '과제에 담음' : '과제에 담기'}</Btn> : null}
        <More className="ml-auto">
          <KV rows={[['판정 코드', <Code key="s">{it.status}</Code>], ['이유 코드', <Code key="r">{it.reason_codes.join(', ')}</Code>], ['문장 위치', `글자 ${it.start}–${it.end} (끝 제외)`], ['문장 ID', <IdLine key="i" v={it.assertion_id} />]]} />
        </More>
      </div>
    </article>
  );
}

function Sheet({ c, r, body, claims, write }) {
  const draft = useStore(app, (s) => s.taskDraft);
  const picked = draft.origin && draft.origin.id === r.id ? draft.assertion_ids : [];
  const toggle = (it) => {
    const has = picked.includes(it.assertion_id);
    const ids = has ? picked.filter((x) => x !== it.assertion_id) : [...picked, it.assertion_id];
    const keep = r.items.filter((x) => ids.includes(x.assertion_id));
    const d = draft.origin && draft.origin.id === r.id ? draft : { unknown_ids: [] };
    app.set({ taskDraft: { origin: { kind: 'review', id: r.id }, assertion_ids: ids, conflict_ids: uniq(keep.flatMap((x) => x.conflict_ids)), unknown_ids: uniq([...keep.flatMap((x) => x.unknown_ids), ...d.unknown_ids.filter((u) => !r.items.some((x) => x.unknown_ids.includes(u)))]) } });
  };
  return (
    <div className="space-y-3">
      {segments(body, r.items).map((seg) => (seg.item ? (
        <SentenceCard key={seg.item.assertion_id} c={c} r={r} it={seg.item} n={seg.n} claims={claims} write={write} on={picked.includes(seg.item.assertion_id)} onToggle={() => toggle(seg.item)} />
      ) : (
        <div key={`gap-${seg.at}`} className="rounded-xl border border-dashed border-g200 px-4 py-3">
          <p className="text-xs font-semibold text-g400">판정 대상으로 뽑히지 않은 부분</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-g500">{seg.gap}</p>
        </div>
      )))}
    </div>
  );
}

// ---------------------------------------------------------------- 기획 요약
function BriefSections({ brief, caseId }) {
  const open = (it) => openPanel({
    caseId, packId: brief.reality_pack_id, title: it.text, focus: it.claim_ids[0],
    groups: [{ label: it.kind === 'COUNTER_FRAME' ? '반론이 겨냥한 근거' : '연결된 근거', tone: 'mute', claimIds: it.claim_ids }],
  });
  return (
    <div className="space-y-4">
      <p className="text-xs text-g500">순위와 점수는 항목을 늘어놓는 순서일 뿐이며 사실일 확률이나 등급이 아닙니다.</p>
      {brief.sections.map((sec) => (
        <Card key={sec.section} title={<>{L.SECTION[sec.section]}<span className="num ml-1 text-sm font-semibold text-g400">{sec.items.length}</span></>}>
          {sec.section === 'STRONG_COUNTER_FRAMES' ? (
            <Notice tone="demo" className="mb-3">알려진 진술 앞 세 건에 일반적인 재검토 문장을 붙인 기본 반론 틀입니다. 합성 해석이며 사실이 아니고, 독자나 시청자의 반응을 예측한 것도 아닙니다.</Notice>
          ) : null}
          {sec.items.length === 0 ? <Empty /> : (
            <ol className="space-y-2">
              {sec.items.map((it) => {
                const syn = it.labels.includes('NOT_FACT') || it.labels.includes('SYNTHETIC_INTERPRETATION');
                return (
                  <li key={it.id} className={cx('rounded-xl border p-3.5', syn ? 'border-example-border bg-example-bg/40' : 'border-g100')}>
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="num mt-0.5 rounded-md bg-g100 px-1.5 py-0.5 text-xs font-bold text-g600">{it.rank}</span>
                      <p className="min-w-0 flex-1 text-sm leading-relaxed text-g900">{it.text}</p>
                      {it.claim_ids.length ? <Btn size="sm" kind="soft" icon={Quote} onClick={() => open(it)}>원문<span className="sr-only"> 보기: {it.text}</span></Btn> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2"><Labels items={it.labels} /><span className="text-xs text-g500">근거 상태 {labelOr(L.EPISTEMIC, it.epistemic_status)}</span></div>
                    {it.needed_evidence.length ? <p className="mt-2 text-sm text-g600"><b className="font-semibold text-g700">필요한 자료</b> · {it.needed_evidence.join(', ')}</p> : null}
                    <More className="mt-2" label="이 항목을 고른 기준">
                      <p>{it.reason} · {it.why_this.summary}</p>
                      <p className="num mt-1">{it.why_this.reason_codes.join(', ')} · 정렬 점수 {it.score} · {Object.entries(it.why_this.ranking_factors).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
                    </More>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      ))}
    </div>
  );
}

function ActionOverlay({ items, questions }) {
  const qk = Object.fromEntries(questions.map((q) => [q.id, q]));
  return (
    <Card title="취재 행동 제안" icon={ClipboardList} sub="물어볼 곳의 역할만 제안합니다. 사람 이름이나 연락처는 만들지 않습니다.">
      {!items.length ? <Empty /> : (
        <ul className="space-y-2">
          {items.map((a, i) => (
            <li key={i} className="rounded-xl border border-g100 p-3.5">
              <p className="text-sm font-semibold text-g900">{a.action}</p>
              <KV className="mt-2 text-sm" rows={[
                ['물을 곳', a.ask_role], ['제안 이유', a.provenance],
                ['연결된 질문', qk[a.question_id] ? `${qk[a.question_id].question_key} ${qk[a.question_id].question}` : '없음'],
              ]} />
              <div className="mt-2"><Labels items={a.labels} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MakeBrief({ c, stateId, packId, contentId, partial }) {
  const f = useCase();
  const a = useAction();
  const [ack, setAck] = useState(false);
  if (!f.write) return <Notice tone="mute">이 근거로 만든 기획 요약이 아직 없습니다. 열람 권한으로는 만들 수 없습니다.</Notice>;
  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5">
      <p className="text-[15px] font-bold text-g900">이 근거로 만든 기획 요약이 아직 없습니다</p>
      <p className="mt-1 text-sm text-g600">초안 검토와 따로, 같은 근거 묶음으로 먼저 볼 것·말할 수 있는 것·서로 다른 것·아직 모르는 것·받을 수 있는 반론을 묶습니다.</p>
      {partial ? <div className="mt-3"><Check2 id="brief-partial" checked={ack} onChange={(e) => setAck(e.target.checked)}>일부 자료가 빠진 부분 결과로 만든다는 점을 확인했습니다</Check2></div> : null}
      <Btn kind="primary" size="block" icon={FileText} className="mt-4" busy={a.busy} disabled={partial && !ack}
        onClick={() => a.run('createEditorialBrief', { params: { case_id: c.id }, body: { state_version_id: stateId, reality_pack_id: packId, content_version_id: contentId || null, allow_partial: partial ? ack : false }, onOk: () => go({ sub: 'brief' }) })}>
        이 근거로 기획 요약 만들기
      </Btn>
      <div className="mt-3 empty:hidden"><ActionState a={a} /></div>
    </div>
  );
}

function Questions({ c, view, claims }) {
  const openQ = (qq, a, focus) => openPanel({
    caseId: c.id, packId: view.reality_pack_id, title: `${qq.question_key} ${qq.question}`, focus,
    groups: [{ label: '질문을 푸는 데 쓴 근거', tone: 'ok', claimIds: a.resolution_claim_ids }],
  });
  return (
    <>
      <QuestionTree questions={view.questions} assessments={view.question_assessments} claims={claims} onOpen={openQ} />
      <p className="text-xs text-g500">과제를 끝냈다는 기록, 검색 결과 0건, 합성한 답변은 질문이 풀렸다는 근거가 아닙니다. 답이 없는 질문도 목록에서 지우지 않습니다.</p>
    </>
  );
}

// the actions after reading a result
function ActionBar({ f, origin, exportInput, picks }) {
  const n = picks ? picks.assertion_ids.length + picks.conflict_ids.length + picks.unknown_ids.length : 0;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-g200 bg-white px-5 py-4 shadow-sm">
      <p className="min-w-0 flex-1 text-sm text-g600">
        {n ? <>과제에 담은 항목 <b className="text-g900">문장 {picks.assertion_ids.length} · 상충 {picks.conflict_ids.length} · 공백 {picks.unknown_ids.length}</b></>
          : origin.kind === 'review' ? "문장 카드의 '과제에 담기'로 더 취재할 항목을 고를 수 있습니다." : '과제는 이 기획 요약을 원본으로 삼아 상충과 공백을 가리킵니다.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {f.write ? <Btn kind="primary" icon={ClipboardList} onClick={() => go({ to: 'sec-tasks', creatingTask: true, taskOrigin: origin })}>취재 과제 만들기</Btn> : null}
        {f.write ? <Btn icon={Search} onClick={() => go({ to: 'sec-search' })}>공개 자료 다시 찾기</Btn> : null}
        <Btn icon={FileDown} onClick={() => go({ to: 'sec-report', exportInput })}>보고서 만들기</Btn>
      </div>
    </div>
  );
}

function DraftReviewView({ f, reviewId }) {
  const route = useStore(app, (s) => s.route);
  const draft = useStore(app, (s) => s.taskDraft);
  const { c } = f;
  const p = { case_id: c.id };
  const q = useQuery('getDraftReview', { ...p, review_id: reviewId });
  const r = q.data;
  const board = useQuery('getRealityBoard', { ...p, pack_id: r ? r.reality_pack_id : '' }, !!r && !!r.reality_pack_id);
  const briefId = r && f.led ? f.led.briefByPack[r.reality_pack_id] : null;
  const brief = useQuery('getEditorialBrief', { ...p, brief_id: briefId || '' }, !!briefId);
  if (!r) return <QueryState q={q} what="초안 검토" />;
  const content = f.versions.contents.find((v) => v.id === r.content_version_id);
  const claims = claimMap(board.data);
  const done = isDone(r);
  const active = !!c.head && c.head.review_id === r.id;
  const branch = r.warnings.some((w) => w.code === 'BRANCH_ONLY');
  const stale = !!c.head && c.head.content_version_id !== r.content_version_id;
  const sub = ['sheet', 'brief', 'questions'].includes(route.sub) ? route.sub : 'sheet';
  const picks = draft.origin && draft.origin.id === r.id ? draft : null;
  const corr = f.led ? f.led.corr[r.id] : null;
  return (
    <div className="space-y-4">
      <ResultHead status={r.status} active={active} branch={branch} asOf={r.as_of} extra={content ? `초안 v${content.version_number}` : ''}
        ids={<KV rows={[['초안 검토', <IdLine key="r" v={r.id} />], ['초안 버전', <IdLine key="c" v={r.content_version_id} />], ['질문 상태 버전', <IdLine key="s" v={r.state_version_id} />], ['근거 묶음', <IdLine key="p" v={r.reality_pack_id} />], ['추적 번호', <IdLine key="x" v={corr} />], r.completed_at ? ['끝난 시각', when(r.completed_at)] : null]} />} />
      {q.net ? <QueryState q={q} /> : null}
      {stale ? <Notice tone="info">이 결과는 이전 초안 버전을 기준으로 합니다. 초안을 고친 뒤에는 새 버전으로 검토를 다시 시작해야 하며, 이 결과가 새 초안의 판정으로 바뀌지는 않습니다.</Notice> : null}
      {r.status === 'PARTIAL' ? <Excluded board={board.data} /> : null}
      {r.status === 'QUEUED' || r.status === 'RUNNING' ? <JobProgress kind="review" d={r} title="초안 문장을 근거와 대조하는 중입니다" corr={corr} /> : null}
      {r.status === 'FAILED' || r.status === 'BLOCKED' ? (
        <JobFailed kind="review" d={r} corr={corr}>
          <p>모델이 낸 결과가 서버 검증을 통과하지 못해 판정을 하나도 저장하지 않았습니다. 이전에 끝난 검토는 그대로 있으며 '보는 결과'에서 따로 열 수 있습니다. 실패한 결과와 섞어 보여 주지 않습니다.</p>
        </JobFailed>
      ) : null}
      {done ? (
        <>
          <PillTabs label="검토 내용" prefix="rv" value={sub} onChange={(id) => go({ sub: id })} items={[
            { id: 'sheet', label: '문장별 판정', icon: ListChecks, badge: r.items.length },
            { id: 'brief', label: '기획 요약', icon: FileText },
            { id: 'questions', label: '질문과 취재 행동', icon: CircleHelp, badge: r.questions.length },
          ]} />
          <div role="tabpanel" id="rv-panel" aria-labelledby={`rv-${sub}`} className="space-y-3">
            {sub === 'sheet' ? (
              <>
                {r.items.length === 0 ? <Empty>판정할 문장이 없습니다.</Empty> : <Sheet c={c} r={r} body={content ? content.body : null} claims={claims} write={f.write} />}
                <p className="text-xs text-g500">판정은 이 초안과 이 근거 묶음에 한정됩니다. 근거 있음이 게재 승인이나 일반적 사실 확정을 뜻하지는 않습니다.</p>
              </>
            ) : null}
            {sub === 'brief' ? (
              <>
                {briefId && brief.data ? <BriefSections brief={brief.data} caseId={c.id} /> : null}
                {briefId && !brief.data ? <QueryState q={brief} what="기획 요약" /> : null}
                {!briefId ? <MakeBrief c={c} stateId={r.state_version_id} packId={r.reality_pack_id} contentId={r.content_version_id} partial={r.status === 'PARTIAL'} /> : null}
              </>
            ) : null}
            {sub === 'questions' ? (
              <>
                <Questions c={c} view={r} claims={claims} />
                {brief.data ? <ActionOverlay items={brief.data.action_overlay} questions={brief.data.questions} /> : <Notice tone="mute">취재 행동 제안은 기획 요약에 담깁니다. 기획 요약 탭에서 먼저 만드세요.</Notice>}
              </>
            ) : null}
          </div>
          <ActionBar f={f} origin={{ kind: 'review', id: r.id }} exportInput={{ kind: 'DRAFT_REVIEW', id: r.id }} picks={picks} />
        </>
      ) : null}
      <Warnings items={ownWarnings(r.warnings, board.data)} />
    </div>
  );
}

function BriefView({ f, briefId }) {
  const route = useStore(app, (s) => s.route);
  const { c } = f;
  const p = { case_id: c.id };
  const q = useQuery('getEditorialBrief', { ...p, brief_id: briefId });
  const b = q.data;
  const board = useQuery('getRealityBoard', { ...p, pack_id: b ? b.reality_pack_id : '' }, !!b);
  if (!b) return <QueryState q={q} what="기획 요약" />;
  const claims = claimMap(board.data);
  const sub = ['brief', 'questions'].includes(route.sub) ? route.sub : 'brief';
  const active = !!c.head && !c.head.review_id && c.head.pack_id === b.reality_pack_id;
  return (
    <div className="space-y-4">
      <ResultHead status={b.status} active={active} asOf={b.as_of} extra={b.content_version_id ? '' : '초안 없음'}
        ids={<KV rows={[['기획 요약', <IdLine key="b" v={b.id} />], ['질문 상태 버전', <IdLine key="s" v={b.state_version_id} />], ['근거 묶음', <IdLine key="p" v={b.reality_pack_id} />], ['만든 시각', when(b.created_at)]]} />} />
      {q.net ? <QueryState q={q} /> : null}
      {!b.content_version_id ? <Notice tone="mute">초안 없이 질문과 자료로만 본 검토입니다. 문장별 판정은 만들지 않습니다.</Notice> : null}
      {b.status === 'PARTIAL' ? <Excluded board={board.data} /> : null}
      <PillTabs label="검토 내용" prefix="rv" value={sub} onChange={(id) => go({ sub: id })} items={[
        { id: 'brief', label: '기획 요약', icon: FileText },
        { id: 'questions', label: '질문과 취재 행동', icon: CircleHelp, badge: b.questions.length },
      ]} />
      <div role="tabpanel" id="rv-panel" aria-labelledby={`rv-${sub}`} className="space-y-3">
        {sub === 'brief' ? <BriefSections brief={b} caseId={c.id} /> : null}
        {sub === 'questions' ? (
          <>
            <Questions c={c} view={b} claims={claims} />
            <ActionOverlay items={b.action_overlay} questions={b.questions} />
          </>
        ) : null}
      </div>
      <ActionBar f={f} origin={{ kind: 'brief', id: b.id }} exportInput={{ kind: 'BRIEF', id: b.id }} picks={null} />
      <Warnings items={ownWarnings(b.warnings, board.data)} />
    </div>
  );
}

export function ReviewSection() {
  const f = useCase();
  const route = useStore(app, (s) => s.route);
  const { c, head } = f;
  const fallback = defaultView(c, f.led);
  // the newest review this page started, while it runs and before it becomes active
  const newest = f.reviews.filter((r) => !isDone(r) && r.status !== 'FAILED').pop();
  const view = route.view || (newest ? { kind: 'review', id: newest.id } : null) || fallback;
  const explicit = !!route.view && fallback && fallback.id !== route.view.id;
  const locked = !head.pack_id && !f.anyResult ? '근거 수집이 끝나면 초안 문장을 근거와 하나씩 대조합니다.' : null;
  return (
    <Section id="sec-review" n={3} title={f.draftless ? '기획 요약' : '초안 검토'} locked={locked}
      desc={f.draftless ? '질문과 자료로 정리한 근거입니다. 원문을 열어 확인하고, 더 취재할 것은 과제로 넘깁니다.' : '초안 문장마다 근거와 대조한 결과입니다. [C1] 같은 표시를 누르면 원문 구간이 열립니다.'}
      right={<>
        <ViewPicker f={f} view={view} />
        {explicit ? <LinkBtn tone="gray" onClick={() => go({ view: null, sub: fallback.kind === 'review' ? 'sheet' : 'brief' })}><Undo2 className="size-3.5" aria-hidden="true" />활성 결과로</LinkBtn> : null}
      </>}>
      {!view ? (
        <Empty>
          {head.pack_id && head.content_version_id ? '근거 묶음은 준비됐고 초안 검토는 아직 없습니다. 위의 근거 수집에서 검토를 시작하세요.' : null}
          {head.pack_id && !head.content_version_id ? '근거 묶음은 준비됐고 기획 요약은 아직 없습니다. 위의 근거 수집에서 만드세요.' : null}
          {!head.pack_id ? '근거 수집이 끝나면 여기에 결과가 나옵니다.' : null}
        </Empty>
      ) : null}
      {view && view.kind === 'review' ? <DraftReviewView key={view.id} f={f} reviewId={view.id} /> : null}
      {view && view.kind === 'brief' ? <BriefView key={view.id} f={f} briefId={view.id} /> : null}
    </Section>
  );
}
