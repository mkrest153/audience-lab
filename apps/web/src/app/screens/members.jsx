// 구성원 관리(관리자): 계정 발급, 권한과 사용 여부, 임시 비밀번호, 오늘 사용량.
/* global React */
import { openPage } from '../store.js';
import { auth, NetError } from '../http.js';
import { Btn, Field, Empty, useMe } from '../ui.jsx';
import { whenShort } from '../time.js';

const { useState, useEffect, useCallback } = React;
const ROLES = [['VIEWER', '열람'], ['EDITOR', '편집'], ['ADMIN', '관리']];

function Secret({ label, value, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch (e) { setCopied(false); }
  };
  return (
    <div className="note tone-ok" role="status">
      <p className="note-h">{label}</p>
      <p>임시 비밀번호 <code className="secret">{value}</code> <Btn kind="ghost" onClick={copy}>{copied ? '복사함' : '복사'}</Btn></p>
      <p className="foot">이 비밀번호는 지금 한 번만 보입니다. 직접 전달하고, 처음 로그인하면 바꾸도록 안내하세요.</p>
      <p><Btn kind="ghost" onClick={onClose}>닫기</Btn></p>
    </div>
  );
}

// One real model call, and optionally a public-record search and a page fetch, from this server.
function LlmCheck() {
  const [st, setSt] = useState(null);
  const run = async (search) => {
    setSt({ busy: search ? 'search' : 'model' });
    try {
      const r = await auth(`/api/health/llm${search ? '?search=1' : ''}`, { method: 'GET' });
      setSt(r.ok ? { data: r.data } : { error: r.error ? r.error.message : '확인하지 못했습니다.' });
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setSt({ error: '서버에 닿지 않았습니다.' });
    }
  };
  const busy = !!(st && st.busy);
  const d = st && st.data;
  return (
    <section>
      <h3>모델·검색 연결 확인</h3>
      <p className="foot">이 서버에서 실제 모델을 한 번 부르고, 원하면 공개 자료 검색과 원문 받기까지 해 봅니다. 확인에 쓴 호출도 OpenAI 사용량에 들어갑니다.</p>
      <div className="form-foot">
        <Btn busy={st && st.busy === 'model'} disabled={busy} onClick={() => run(false)}>모델 호출 확인</Btn>
        <Btn busy={st && st.busy === 'search'} disabled={busy} onClick={() => run(true)}>검색과 원문 받기까지 확인</Btn>
      </div>
      {st && st.error ? <p className="note tone-bad" role="alert">{st.error}</p> : null}
      {d ? (
        <dl className="kv" role="status">
          <dt>모델</dt><dd>{d.model} · {d.ok ? `정상 (${d.latency_ms}ms)` : `실패: ${d.error}`}</dd>
          {d.search ? <><dt>공개 자료 검색</dt><dd>{d.search.ok ? `정상, 결과 ${d.search.results}건 (${d.search.latency_ms}ms)` : `실패: ${d.search.error}`}</dd></> : null}
          {d.fetch ? <><dt>원문 받기</dt><dd>{d.fetch.ok ? `정상, 본문 ${d.fetch.chars.toLocaleString('ko-KR')}자 (${d.fetch.latency_ms}ms)` : `실패: ${d.fetch.error}`}{d.fetch.url ? <><br /><span className="url">{d.fetch.url}</span></> : null}</dd></> : null}
        </dl>
      ) : null}
    </section>
  );
}

export function MembersScreen() {
  const me = useMe();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'EDITOR' });
  const [busy, setBusy] = useState(null);
  const [secret, setSecret] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await auth('/api/admin/users', { method: 'GET' });
      if (r.ok) { setData(r.data); setError(null); } else setError(r.error.message);
    } catch (e) { if (e instanceof NetError) setError('서버에 닿지 않았습니다.'); else throw e; }
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (what, path, opts) => {
    setBusy(what); setError(null);
    try {
      const r = await auth(path, opts);
      if (!r.ok) { setError(r.error.message); return null; }
      await load();
      return r.data;
    } catch (e) {
      if (e instanceof NetError) { setError('서버에 닿지 않았습니다.'); return null; }
      throw e;
    } finally { setBusy(null); }
  };
  const invite = async () => {
    const d = await run('invite', '/api/admin/users', { body: form });
    if (d) { setSecret({ label: `${d.user.name}(${d.user.email}) 계정을 만들었습니다`, value: d.temporary_password }); setForm({ email: '', name: '', role: 'EDITOR' }); }
  };
  const reset = async (u) => {
    const d = await run(`reset:${u.id}`, `/api/admin/users/${u.id}/reset-password`, {});
    if (d) setSecret({ label: `${u.name}의 비밀번호를 새로 발급했습니다. 기존 로그인은 모두 끊었습니다`, value: d.temporary_password });
  };
  const usage = data ? data.usage : null;
  return (
    <div className="screen screen-solo">
      <div className="screen-top"><h2>구성원 관리</h2><Btn kind="ghost" onClick={() => openPage(null)}>기획 목록으로</Btn></div>
      <p className="lede">편집국 공간의 계정을 발급하고 권한을 정합니다. 열람은 읽기만, 편집은 검토와 과제를, 관리는 계정 관리까지 할 수 있습니다.</p>
      {error ? <p className="note tone-bad" role="alert">{error}</p> : null}
      {secret ? <Secret {...secret} onClose={() => setSecret(null)} /> : null}
      <form className="form" onSubmit={(e) => { e.preventDefault(); invite(); }} noValidate>
        <div className="form-head"><h3>계정 발급</h3></div>
        <div className="form-grid form-grid-3">
          <Field id="m-email" label="이메일" required><input id="m-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field id="m-name" label="이름" required><input id="m-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field id="m-role" label="권한">
            <select id="m-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l} ({v})</option>)}
            </select>
          </Field>
        </div>
        <div className="form-foot"><Btn kind="primary" type="submit" busy={busy === 'invite'}>계정 만들기</Btn></div>
      </form>
      <section>
        <h3>구성원 <span className="count">{data ? data.items.length : 0}</span></h3>
        {!data ? <p className="loading" role="status">구성원을 불러오는 중입니다.</p> : null}
        {data && !data.items.length ? <Empty /> : null}
        {data && data.items.length ? (
          <div className="scroll-x">
            <table className="grid grid-wide">
              <thead><tr><th scope="col">이름</th><th scope="col">이메일</th><th scope="col">권한</th><th scope="col">사용</th><th scope="col">만든 시각</th><th scope="col"><span className="sr">비밀번호</span></th></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'row-off'}>
                    <td>{u.name}{u.id === (me && me.actor_id) ? <> <span className="chip">나</span></> : null}{u.must_change_password ? <> <span className="chip chip-warn">임시 비밀번호</span></> : null}</td>
                    <td className="mono">{u.email}</td>
                    <td>
                      <label className="sr" htmlFor={`role-${u.id}`}>{u.name} 권한</label>
                      <select id={`role-${u.id}`} value={u.role} disabled={busy !== null || u.id === (me && me.actor_id)}
                        onChange={(e) => run(`role:${u.id}`, `/api/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } })}>
                        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td>
                      <label className="check"><input type="checkbox" checked={u.active} disabled={busy !== null || u.id === (me && me.actor_id)}
                        onChange={(e) => run(`active:${u.id}`, `/api/admin/users/${u.id}`, { method: 'PATCH', body: { active: e.target.checked } })} /> {u.active ? '사용 중' : '중지됨'}</label>
                    </td>
                    <td>{whenShort(u.created_at)}</td>
                    <td>{u.id !== (me && me.actor_id) ? <Btn kind="ghost" busy={busy === `reset:${u.id}`} onClick={() => reset(u)}>임시 비밀번호 발급</Btn> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="foot">계정을 중지하면 그 계정의 로그인은 바로 끊깁니다. 만든 기획과 기록은 지우지 않습니다.</p>
      </section>
      {usage ? (
        <section>
          <h3>오늘 모델 사용량 <span className="muted">{usage.day} (UTC)</span></h3>
          <dl className="kv">
            <dt>판정·정리 호출</dt><dd className="num">{usage.model_calls || 0} / {data.limits.model_calls || '제한 없음'}</dd>
            <dt>공개 자료 검색 호출</dt><dd className="num">{usage.search_calls || 0} / {data.limits.search_calls || '제한 없음'}</dd>
          </dl>
          <p className="foot">한도는 서버 환경변수 DAILY_MODEL_CALL_LIMIT, DAILY_SEARCH_CALL_LIMIT로 정합니다. 비용은 연결한 OpenAI 계정에 청구됩니다.</p>
        </section>
      ) : null}
      <LlmCheck />
    </div>
  );
}
