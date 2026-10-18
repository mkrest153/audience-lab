// 6단계 보고서: 고정된 검토 결과나 기획 요약을 실제 파일(PDF·DOCX·JSON)로 만들어 받습니다.
import { useState } from 'react';
import { FileText, FileType, Braces, Download, Eye, EyeOff, FileDown, ShieldCheck } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, go, bump } from '../app/store.js';
import { api, useQuery, useAction, refreshJob, NetError, ACTIVE } from '../app/api.js';
import { reportModel } from '../report.js';
import { sha256hex } from '../sha256.js';
import { Status } from '../ui/status.jsx';
import { Section, Card, Btn, Field, Select, Choice, Check2, Notice, NetNote, ApiError, More, KV, IdLine, Code, Tag, Empty, QueryState, ActionState, Warnings, useReveal, cx, labelOr } from '../ui/kit.jsx';
import { when, whenShort, bytes } from '../app/time.js';
import { useCase, isDone } from './facts.js';
import { JobProgress } from './jobs.jsx';

const FORMATS = [
  { id: 'PDF', label: 'PDF', note: '그대로 읽고 돌려 보는 문서', icon: FileText },
  { id: 'DOCX', label: 'DOCX', note: '워드에서 고쳐 쓰는 문서', icon: FileType },
  { id: 'JSON', label: 'JSON', note: '다른 시스템에 넘기는 고정 자료', icon: Braces },
];
const ICON = { PDF: FileText, DOCX: FileType, JSON: Braces };

// hands the checked bytes to the browser's own download
function saveBytes(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------------------------------------------------------- preview (MarketView ReportView)
function cellLines(cell) {
  return (Array.isArray(cell) ? cell : [cell]).map((l, i) => {
    const o = typeof l === 'string' ? { text: l } : l;
    return <span key={i} className={cx('block', o.bold && 'font-semibold text-g900', o.small && 'num text-[11px] text-g400')}>{o.text}</span>;
  });
}
function ReportView({ model }) {
  return (
    <div className="space-y-3 text-sm text-g700">
      {model.blocks.map((b, i) => {
        if (b.t === 'title') return <p key={i} className="text-xl font-bold text-g900">{b.text}</p>;
        if (b.t === 'subtitle') return <p key={i} className="text-[15px] text-g600">{b.text}</p>;
        if (b.t === 'note') return <p key={i} className="rounded-lg bg-example-bg px-3 py-2 text-xs text-example">{b.text}</p>;
        if (b.t === 'h') return <p key={i} className="pt-3 text-[15px] font-bold text-g900">{b.text}</p>;
        if (b.t === 'p') return <p key={i} className={cx('leading-relaxed', b.muted && 'text-g500')}>{b.text}</p>;
        if (b.t === 'list') return <ul key={i} className="list-disc space-y-0.5 pl-5">{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>;
        const head = b.t === 'kv' ? ['항목', '내용'] : b.head;
        return (
          <div key={i} className="overflow-x-auto rounded-lg border border-g100">
            <table className="w-full min-w-[480px] border-collapse text-left text-xs">
              <thead className="bg-g50 text-g500"><tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-g100">{b.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k} className="px-3 py-2 align-top">{cellLines(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function SnapshotPreview({ caseId, exportId }) {
  const q = useQuery('getExportSnapshot', { case_id: caseId, export_id: exportId });
  if (!q.data) {
    if (q.error && q.error.code === 'EXPORT_NOT_READY') return <Notice tone="bad">지금 권리로는 이 파일의 내용을 보여 줄 수 없거나, 파일이 아직 완성되지 않았습니다.</Notice>;
    return <QueryState q={q} what="보고서 내용" />;
  }
  const snap = q.data;
  return (
    <>
      <p className="mb-3 text-xs text-g500">이 파일을 만든 고정 자료를 화면에 그대로 그린 것입니다. 실제 파일은 '파일 받기'로 받습니다.</p>
      <ReportView model={reportModel(snap.snapshot, { snapshot_sha256: snap.snapshot_sha256 })} />
      <More className="mt-3" label="고정 자료 해시"><Code>{snap.snapshot_sha256}</Code></More>
    </>
  );
}

// ---------------------------------------------------------------- one file
function ExportRow({ caseId, x, selected, onPreview }) {
  const [st, setSt] = useState(null);
  const [ref, shown] = useReveal('export', x.id, 'center');
  const done = x.status === 'COMPLETED';
  const Icon = ICON[x.format] || FileText;
  const receive = async () => {
    setSt({ busy: true });
    try {
      const res = await api('downloadEditorialExport', { params: { case_id: caseId, export_id: x.id } });
      if (!res.ok) {
        setSt({ error: res.error, status: res.status });
        await refreshJob('export', caseId, x.id);
        bump();
        return;
      }
      const data = res.binary;
      const verified = data.length === x.size_bytes && sha256hex(data) === x.sha256;
      if (!verified) {
        setSt({ got: data.length, verified, note: '받은 파일이 서버에 기록된 크기·해시와 달라 저장하지 않았습니다. 다시 받아 보세요.' });
        return;
      }
      saveBytes(data, x.filename, res.headers['Content-Type'] || x.media_type);
      setSt({ got: data.length, verified, note: `${x.filename} 파일을 내려받았습니다.` });
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setSt({ net: true });
    }
  };
  return (
    <li ref={ref} tabIndex={-1} className={cx('rounded-2xl border bg-white p-4 shadow-sm focus:outline-none', shown ? 'border-brand ring-2 ring-brand/15' : selected ? 'border-brand' : 'border-g200')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand"><Icon className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-g900">{x.format} · {x.input_kind === 'BRIEF' ? '기획 요약' : '초안 검토'}
            {shown ? <Tag tone="brand">{shown.soft ? '방금 요청' : '방금 연 결과'}</Tag> : null}</p>
          <p className="mt-0.5 truncate text-xs text-g500">{x.filename || '끝나면 파일 이름이 정해집니다'}{x.size_bytes ? ` · ${bytes(x.size_bytes)}` : ''} · 접수 {whenShort(x.created_at)}</p>
        </div>
        <Status kind="job" code={x.status} />
        {done ? (
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" kind="primary" icon={Download} busy={st && st.busy} onClick={receive}>파일 받기<span className="sr-only"> {x.format}</span></Btn>
            <Btn size="sm" icon={selected ? EyeOff : Eye} aria-expanded={selected} onClick={() => onPreview(selected ? null : x.id)}>{selected ? '미리보기 닫기' : '내용 미리보기'}</Btn>
          </div>
        ) : null}
      </div>
      {ACTIVE.has(x.status) ? <div className="mt-3"><JobProgress kind="export" d={x} title="보고서 파일을 만드는 중입니다" /></div> : null}
      {st && !st.busy ? (
        <div className="mt-3 space-y-2">
          {st.net ? <NetNote onRetry={receive} /> : null}
          {st.error ? (
            <>
              <ApiError error={st.error} status={st.status} title="파일을 받지 못했습니다" />
              {st.error.code === 'EXPORT_RIGHTS_BLOCKED' ? <p className="text-xs text-g500">이 파일은 다시 내주지 않습니다. 허용된 자료로 새 검토를 만든 뒤 그 검토로 새 보고서를 요청하세요.</p> : null}
            </>
          ) : null}
          {st.got ? (
            <Notice tone={st.verified ? 'ok' : 'bad'} role="status">
              {st.note} 받은 크기와 SHA-256이 서버 기록과 {st.verified ? '일치합니다' : '다릅니다'}.
            </Notice>
          ) : null}
        </div>
      ) : null}
      <Warnings items={x.status === 'BLOCKED' || x.status === 'FAILED' ? x.warnings : null} />
      <More className="mt-2">
        <KV rows={[['보고서', <IdLine key="i" v={x.id} />], ['대상', <IdLine key="t" v={x.input_id} />], ['형식', x.media_type || x.format],
          ['파일 SHA-256', <IdLine key="h" v={x.sha256} />], ['고정 자료 SHA-256', <IdLine key="s" v={x.snapshot_sha256} />],
          x.completed_at ? ['끝난 시각', when(x.completed_at)] : null, x.error_code ? ['오류 코드', <Code key="e">{x.error_code}</Code>] : null]} />
      </More>
    </li>
  );
}

export function ReportSection() {
  const f = useCase();
  const route = useStore(app, (s) => s.route);
  const a = useAction();
  const [pick, setPick] = useState(null);
  const [format, setFormat] = useState('PDF');
  const [ack, setAck] = useState(false);
  const [preview, setPreview] = useState(null);
  const { c, head } = f;
  const inputs = [
    ...f.reviews.filter(isDone).map((d) => ({ kind: 'DRAFT_REVIEW', id: d.id, d })),
    ...f.briefs.filter(isDone).map((d) => ({ kind: 'BRIEF', id: d.id, d })),
  ].sort((x, y) => x.d.as_of.localeCompare(y.d.as_of) || x.d.created_at.localeCompare(y.d.created_at));
  const fallback = inputs.find((i) => i.id === head.review_id) || inputs.find((i) => i.kind === 'BRIEF' && i.id === f.headBriefId) || inputs[inputs.length - 1] || null;
  const wanted = pick || (route.exportInput ? route.exportInput.id : null);
  const input = inputs.find((i) => i.id === wanted) || fallback;
  const board = useQuery('getRealityBoard', { case_id: c.id, pack_id: input ? input.d.reality_pack_id : '' }, !!input);
  // newest first; requests made at the same moment keep the order they were made in, latest on top
  const order = f.led ? f.led.export : [];
  const list = [...f.exports].sort((x, y) => y.created_at.localeCompare(x.created_at) || order.indexOf(y.id) - order.indexOf(x.id));
  const partial = input && input.d.status === 'PARTIAL';
  const used = board.data ? board.data.sources.filter((s) => s.included) : [];
  const blocked = used.filter((s) => s.rights_class !== 'OPEN');
  // the new file appears in the list below the form; bring it into view without taking focus
  const submit = () => a.run('createEditorialExport', {
    params: { case_id: c.id }, body: { input_kind: input.kind, input_id: input.id, format },
    onOk: (res) => go({ reveal: { kind: 'export', id: res.data.export_id, soft: true } }),
  });
  const locked = !f.anyResult ? '검토 결과가 나오면 PDF·DOCX·JSON 보고서로 만들어 받을 수 있습니다.' : null;
  const isHead = (i) => i.id === head.review_id || (i.kind === 'BRIEF' && i.id === f.headBriefId);
  return (
    <Section id="sec-report" n={6} title="보고서" locked={locked}
      desc="고정된 검토 결과를 실제 파일로 만들어 받습니다. 나중에 자료가 바뀌어도 파일의 내용은 바뀌지 않습니다. 게재와 편성은 사람이 결정합니다.">
      {inputs.length === 0 ? <Empty>끝난 초안 검토나 기획 요약이 있어야 보고서를 만들 수 있습니다.</Empty> : (
        <form className="rounded-2xl border border-g200 bg-white p-5 shadow-sm sm:p-6" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <h3 className="text-[15px] font-bold text-g900">보고서 만들기</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field id="exp-input" label="출력할 결과" hint="고른 결과에 고정해서 만듭니다.">
              <Select id="exp-input" value={input.id} onChange={(e) => { setPick(e.target.value); setAck(false); }}>
                {inputs.map((i) => (
                  <option key={i.id} value={i.id}>{i.kind === 'BRIEF' ? '기획 요약' : '초안 검토'} · 기준 {whenShort(i.d.as_of)} · {labelOr(L.JOB_STATUS, i.d.status)}{isHead(i) ? ' · 활성' : ''}</option>
                ))}
              </Select>
            </Field>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm text-g600"><ShieldCheck className="size-4 text-g400" aria-hidden="true" />권리 확인</p>
              {board.data ? (
                blocked.length === 0
                  ? <p className="rounded-xl bg-positive-bg px-4 py-3 text-sm text-g700">이 결과가 쓴 출처 {used.length}건이 모두 공개 자료입니다. 서버는 요청할 때, 끝낼 때, 받을 때마다 다시 확인합니다.</p>
                  : <Notice tone="bad">지금 권리로는 쓸 수 없는 출처가 있습니다: {blocked.map((s) => `${s.title}(${labelOr(L.RIGHTS, s.rights_class)})`).join(', ')}. 이 결과로는 파일을 만들거나 받을 수 없습니다.</Notice>
              ) : <QueryState q={board} what="출처 권리" />}
            </div>
          </div>
          <fieldset className="mt-4">
            <legend className="mb-1.5 text-sm text-g600">형식</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {FORMATS.map((x) => (
                <Choice key={x.id} type="radio" name="exp-format" id={`exp-format-${x.id}`} checked={format === x.id} onChange={() => setFormat(x.id)} title={x.label} desc={x.note} />
              ))}
            </div>
          </fieldset>
          <More className="mt-4" label="파일에 들어가는 것">
            <ul className="list-disc space-y-0.5 pl-4">
              <li>제목, 질문, 기준 시각, 입력 버전</li>
              {input.kind === 'DRAFT_REVIEW' ? <li>초안 문장별 판정, 나눠 본 세부 판정과 계산</li> : <li>초안이 없어 문장별 판정 표는 넣지 않습니다</li>}
              <li>말할 수 있는 것, 서로 다른 것, 아직 모르는 것, 받을 수 있는 반론(합성 해석 표시 유지)</li>
              <li>질문 평가, 취재 행동과 과제{input.kind === 'DRAFT_REVIEW' ? ', 이전 검토와의 차이(있을 때)' : ''}</li>
              <li>근거 목록: 출처, 원문 버전, 주소, 발행 시각, 권리 · 경고. 빈 항목은 '해당 항목 없음'</li>
            </ul>
          </More>
          {input.d.warnings && input.d.warnings.length ? <div className="mt-3"><Warnings items={input.d.warnings} /></div> : null}
          {partial ? <div className="mt-3"><Check2 id="exp-partial" checked={ack} onChange={(e) => setAck(e.target.checked)}>일부 자료가 빠진 부분 결과입니다. 경고가 파일 안에 그대로 남는다는 점을 확인했습니다</Check2></div> : null}
          <div className="mt-3 empty:hidden"><ActionState a={a} /></div>
          {f.write ? <Btn kind="primary" size="lg" type="submit" icon={FileDown} className="mt-4" busy={a.busy} disabled={(partial && !ack) || blocked.length > 0}>보고서 만들기</Btn>
            : <p className="mt-4 text-sm text-g500">열람 권한에서는 보고서를 새로 만들 수 없습니다. 이미 만들어진 파일은 받을 수 있습니다.</p>}
        </form>
      )}
      {list.length ? (
        <div>
          <h3 className="mb-2 text-sm font-bold text-g700">만든 보고서 <span className="num text-g400">{list.length}</span></h3>
          <ul className="space-y-2">{list.map((x) => <ExportRow key={x.id} caseId={c.id} x={x} selected={preview === x.id} onPreview={setPreview} />)}</ul>
          <p className="mt-2 text-xs text-g500">파일은 형식 검사와 다시 읽어 본 해시·크기 확인을 통과한 뒤에만 완료가 됩니다. 받은 파일도 브라우저에서 크기와 SHA-256을 한 번 더 맞춰 본 뒤 저장합니다. 권리가 회수되면 이미 만든 파일도 막습니다.</p>
        </div>
      ) : null}
      {preview ? (
        <Card title="내용 미리보기" icon={Eye} right={<Btn size="sm" kind="ghost" onClick={() => setPreview(null)}>닫기</Btn>}>
          <SnapshotPreview key={preview} caseId={c.id} exportId={preview} />
        </Card>
      ) : null}
    </Section>
  );
}
