// UI-09 보고서 출력: 고정된 검토 또는 Brief를 실제 파일로.
/* global React */
import * as L from '../../labels.js';
import { app, useStore, go, bump } from '../store.js';
import { api, useQuery, useAction, refreshJob, NetError, ACTIVE } from '../api.js';
import { reportModel } from '../../report.js';
import { sha256hex } from '../../sha256.js';
import { St, Btn, Pins, Warnings, QueryState, ActionState, ApiError, NetNote, useMe, canWrite, cx, labelOr, useReveal } from '../ui.jsx';
import { when, whenShort, short, bytes } from '../time.js';

const { useState } = React;
const FORMATS = [
  { id: 'PDF', label: 'PDF', note: '그대로 읽고 돌려 보는 문서' },
  { id: 'DOCX', label: 'DOCX', note: '워드에서 고쳐 쓰는 문서' },
  { id: 'JSON', label: 'JSON', note: '다른 시스템에 넘기는 고정 자료' },
];

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

function cellLines(cell) {
  return (Array.isArray(cell) ? cell : [cell]).map((l, i) => {
    const o = typeof l === 'string' ? { text: l } : l;
    return <span key={i} className={cx('rp-line', o.bold && 'strong', o.small && 'rp-small')}>{o.text}</span>;
  });
}
function ReportPreview({ model }) {
  return (
    <div className="report">
      {model.blocks.map((b, i) => {
        if (b.t === 'title') return <p key={i} className="rp-title">{b.text}</p>;
        if (b.t === 'subtitle') return <p key={i} className="rp-sub">{b.text}</p>;
        if (b.t === 'note') return <p key={i} className="rp-note">{b.text}</p>;
        if (b.t === 'h') return <p key={i} className="rp-h">{b.text}</p>;
        if (b.t === 'p') return <p key={i} className={b.muted ? 'muted' : ''}>{b.text}</p>;
        if (b.t === 'list') return <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>;
        const head = b.t === 'kv' ? ['항목', '내용'] : b.head;
        return (
          <div key={i} className="scroll-x">
            <table className="grid">
              <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>{b.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}>{cellLines(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function SnapshotPreview({ c, exportId }) {
  const q = useQuery('getExportSnapshot', { case_id: c.id, export_id: exportId });
  if (!q.data) {
    if (q.error && q.error.code === 'EXPORT_NOT_READY') return <p className="note tone-bad">지금 권리로는 이 파일의 내용을 보여줄 수 없거나, 파일이 아직 완성되지 않았습니다.</p>;
    return <QueryState q={q} what="보고서 내용" />;
  }
  const snap = q.data;
  return (
    <>
      <p className="foot">이 파일을 만든 고정 자료를 화면에 그대로 그린 것입니다. 실제 파일은 위의 받기 단추로 받습니다. 고정 자료 SHA-256 <span className="hash">{snap.snapshot_sha256.slice(0, 16)}…</span></p>
      <ReportPreview model={reportModel(snap.snapshot, { snapshot_sha256: snap.snapshot_sha256 })} />
    </>
  );
}

function ExportRow({ c, x, selected, onPreview }) {
  const [st, setSt] = useState(null);
  const [rowRef, shown] = useReveal('export', x.id, 'center', 72);
  const done = x.status === 'COMPLETED';
  const receive = async () => {
    setSt({ busy: true });
    try {
      const res = await api('downloadEditorialExport', { params: { case_id: c.id, export_id: x.id } });
      if (!res.ok) {
        setSt({ error: res.error, status: res.status });
        await refreshJob('export', c.id, x.id);
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
    <>
      <tr ref={rowRef} tabIndex={-1} className={cx(selected && 'row-on', shown && 'row-here')}>
        <td>
          <b>{x.format}</b>{shown ? <> <span className="chip chip-on">{shown.soft ? '방금 요청' : '방금 연 결과'}</span></> : null}<br />
          <span className="muted">{x.input_kind === 'BRIEF' ? 'Brief' : '초안 검토'} <span className="mono">{short(x.input_id)}</span></span>
        </td>
        <td><St kind="job" code={x.status} small />{x.error_code ? <><br /><code>{x.error_code}</code></> : null}</td>
        <td>{x.filename ? <span className="filename">{x.filename}</span> : <span className="muted">끝나면 정해집니다</span>}{x.media_type ? <><br /><span className="muted">{x.media_type}</span></> : null}</td>
        <td className="num">{bytes(x.size_bytes)}</td>
        <td>{x.sha256 ? <span className="hash">{x.sha256.slice(0, 16)}…</span> : <span className="muted">없음</span>}<br /><span className="muted">고정 자료 {x.snapshot_sha256 ? `${x.snapshot_sha256.slice(0, 12)}…` : ''}</span></td>
        <td>{whenShort(x.created_at)}{x.completed_at ? <><br /><span className="muted">끝 {whenShort(x.completed_at)}</span></> : null}</td>
        <td>
          <div className="cell-act">
            {done ? <Btn kind="primary" busy={st && st.busy} onClick={receive}>파일 받기</Btn> : null}
            {done ? <button type="button" className="demofill-b" aria-expanded={selected} onClick={() => onPreview(selected ? null : x.id)}>{selected ? '미리보기 닫기' : '내용 미리보기'}</button> : null}
            {ACTIVE.has(x.status) ? <span className="muted">만드는 중</span> : null}
          </div>
        </td>
      </tr>
      {st && !st.busy ? (
        <tr className="row-note">
          <td colSpan={7}>
            {/* stays within the visible part of the table when the table itself scrolls sideways */}
            <div className="stay">
              {st.net ? <NetNote onRetry={receive} /> : null}
              {st.error ? (
                <>
                  <ApiError error={st.error} status={st.status} title="파일을 받지 못했습니다" />
                  {st.error.code === 'EXPORT_RIGHTS_BLOCKED' ? <p className="foot">이 파일은 다시 내주지 않습니다. 허용된 자료로 새 검토를 만든 뒤 그 검토로 새 보고서를 요청하세요.</p> : null}
                </>
              ) : null}
              {st.got ? (
                <p className={cx('note', st.verified ? 'tone-ok' : 'tone-bad')} role="status">
                  받은 바이트 {st.got.toLocaleString('ko-KR')}개. 기록된 크기와 SHA-256 {st.verified ? '일치' : '불일치'}. {st.note}
                </p>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function ExportScreen({ c }) {
  const me = useMe();
  const route = useStore(app, (s) => s.route);
  const led = useStore(app, (s) => s.ledger[c.id]);
  const jobs = useStore(app, (s) => s.jobs);
  const a = useAction();
  const [pick, setPick] = useState(null);
  const [format, setFormat] = useState('PDF');
  const [ack, setAck] = useState(false);
  const [preview, setPreview] = useState(null);
  const head = c.head || {};
  const ok = (d) => d && (d.status === 'COMPLETED' || d.status === 'PARTIAL');
  const inputs = [];
  if (led) {
    led.review.forEach((id) => { const d = jobs[id] && jobs[id].data; if (ok(d)) inputs.push({ kind: 'DRAFT_REVIEW', id, d }); });
    led.brief.forEach((id) => { const d = jobs[id] && jobs[id].data; if (ok(d)) inputs.push({ kind: 'BRIEF', id, d }); });
  }
  inputs.sort((x, y) => x.d.as_of.localeCompare(y.d.as_of) || x.d.created_at.localeCompare(y.d.created_at));
  const fallback = inputs.find((i) => i.id === head.review_id) || inputs[inputs.length - 1] || null;
  const wanted = pick || (route.exportInput ? route.exportInput.id : null);
  const input = inputs.find((i) => i.id === wanted) || fallback;
  const board = useQuery('getRealityBoard', { case_id: c.id, pack_id: input ? input.d.reality_pack_id : '' }, !!input);
  // newest first; requests made at the same moment keep the order they were made in, latest on top
  const order = led ? led.export : [];
  const exportsList = order.map((id) => jobs[id] && jobs[id].data).filter(Boolean);
  exportsList.sort((x, y) => y.created_at.localeCompare(x.created_at) || order.indexOf(y.id) - order.indexOf(x.id));
  const write = canWrite(me);
  const partial = input && input.d.status === 'PARTIAL';
  const used = board.data ? board.data.sources.filter((s) => s.included) : [];
  const blocked = used.filter((s) => s.rights_class !== 'OPEN');
  // the new file's row appears in the list below the form; bring it into view without taking focus
  const submit = () => a.run('createEditorialExport', {
    params: { case_id: c.id }, body: { input_kind: input.kind, input_id: input.id, format },
    onOk: (res) => go({ reveal: { kind: 'export', id: res.data.export_id, soft: true } }),
  });
  return (
    <div className="screen">
      <div className="screen-top"><h2>보고서 출력</h2></div>
      <p className="lede">고정된 검토 결과를 실제 파일로 만들어 받습니다. 게재와 편성은 사람이 결정합니다.</p>
      {inputs.length === 0 ? (
        <div className="note tone-info">
          <p className="note-h">출력할 결과가 없습니다</p>
          <p>끝난 초안 검토나 Brief가 있어야 보고서를 만들 수 있습니다.</p>
          <p><Btn onClick={() => go({ tab: 'review' })}>기획 검토로</Btn></p>
        </div>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="exp-input">출력할 결과</label>
              <select id="exp-input" value={input.id} onChange={(e) => { setPick(e.target.value); setAck(false); }}>
                {inputs.map((i) => (
                  <option key={i.id} value={i.id}>{i.kind === 'BRIEF' ? 'Brief' : '초안 검토'} · 기준 {whenShort(i.d.as_of)} · {labelOr(L.JOB_STATUS, i.d.status)} · {short(i.id)}{i.id === head.review_id ? ' · 활성' : ''}</option>
                ))}
              </select>
              <div className="field-meta"><p className="field-hint">고른 결과에 고정해서 만듭니다. 나중에 자료가 바뀌어도 이 파일의 내용은 바뀌지 않습니다.</p></div>
            </div>
            <fieldset className="fieldset radios-col">
              <legend>형식</legend>
              {FORMATS.map((f) => (
                <label key={f.id} className="check">
                  <input type="radio" name="exp-format" id={`exp-format-${f.id}`} checked={format === f.id} onChange={() => setFormat(f.id)} />
                  <span><b>{f.label}</b> <span className="muted">{f.note}</span></span>
                </label>
              ))}
            </fieldset>
          </div>
          <Pins items={[
            { label: '출력 대상', text: input.kind === 'BRIEF' ? 'Brief' : '초안 검토', extra: short(input.id) },
            { label: '기준 시각', text: when(input.d.as_of) },
            { label: '초안 버전', text: input.d.content_version_id ? undefined : '없음', id: input.d.content_version_id || undefined },
            { label: '질문 상태 버전', id: input.d.state_version_id },
            { label: '근거 묶음', id: input.d.reality_pack_id },
          ]} />
          <div className="form-grid">
            <div>
              <h4>파일에 들어가는 것</h4>
              <ul className="plain tight">
                <li>제목, 질문, 기준 시각, 입력 버전</li>
                {input.kind === 'DRAFT_REVIEW' ? <li>초안 문장별 판정, 나눠 본 세부 판정과 계산</li> : <li className="muted">초안이 없어 문장별 판정 표는 넣지 않습니다</li>}
                <li>말할 수 있는 것, 서로 다른 것, 아직 모르는 것, 받을 수 있는 반론</li>
                <li>질문 평가, 취재 행동과 과제</li>
                {input.kind === 'DRAFT_REVIEW' ? <li>이전 검토와의 차이(있을 때)</li> : null}
                <li>근거 목록: 출처, 원문 버전, 주소, 발행 시각, 권리</li>
                <li>경고와 합성 표시. 빈 항목은 '해당 항목 없음'</li>
              </ul>
            </div>
            <div>
              <h4>권리 확인</h4>
              {board.data ? (
                blocked.length === 0
                  ? <p className="muted">이 결과가 쓴 출처 {used.length}건이 모두 공개 자료입니다. 서버는 요청할 때, 끝낼 때, 받을 때마다 다시 확인합니다.</p>
                  : <p className="note tone-bad">지금 권리로는 쓸 수 없는 출처가 있습니다: {blocked.map((s) => `${s.title}(${labelOr(L.RIGHTS, s.rights_class)})`).join(', ')}. 이 결과로는 파일을 만들거나 받을 수 없습니다. 허용된 자료로 새 검토를 만들어야 합니다.</p>
              ) : <QueryState q={board} what="출처 권리" />}
              <Warnings items={input.d.warnings} />
            </div>
          </div>
          {partial ? (
            <label className="check"><input type="checkbox" id="exp-partial" checked={ack} onChange={(e) => setAck(e.target.checked)} /> 일부 자료가 빠진 부분 결과입니다. 경고가 파일 안에 그대로 남는다는 점을 확인했습니다</label>
          ) : null}
          <ActionState a={a} />
          {write ? (
            <div className="form-foot"><Btn kind="primary" type="submit" busy={a.busy} disabled={partial && !ack}>보고서 만들기</Btn></div>
          ) : <p className="muted">열람 권한에서는 보고서를 새로 만들 수 없습니다. 이미 만들어진 파일은 받을 수 있습니다.</p>}
        </form>
      )}

      <section>
        <h3>만든 보고서 <span className="count">{exportsList.length}</span></h3>
        {exportsList.length === 0 ? <p className="empty">아직 만든 보고서가 없습니다.</p> : (
          <div className="scroll-x scroll-box">
            <table className="grid grid-wide grid-act">
              <thead><tr><th scope="col">형식과 대상</th><th scope="col">상태</th><th scope="col">파일</th><th scope="col">크기</th><th scope="col">SHA-256</th><th scope="col">접수</th><th scope="col"><span className="sr">받기</span></th></tr></thead>
              <tbody>
                {exportsList.map((x) => <ExportRow key={x.id} c={c} x={x} selected={preview === x.id} onPreview={setPreview} />)}
              </tbody>
            </table>
          </div>
        )}
        <p className="foot">파일은 형식 검사와 다시 읽어 본 해시·크기 확인을 통과한 뒤에만 완료가 됩니다. 받은 파일도 브라우저에서 크기와 SHA-256을 한 번 더 맞춰 본 뒤 저장합니다. 권리가 회수되면 이미 만든 파일도 통째로 막습니다.</p>
      </section>

      {preview ? (
        <section className="preview">
          <div className="form-head"><h3>내용 미리보기</h3></div>
          <SnapshotPreview key={preview} c={c} exportId={preview} />
        </section>
      ) : null}
    </div>
  );
}
