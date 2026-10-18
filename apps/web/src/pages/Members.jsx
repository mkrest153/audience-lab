// 구성원 관리 (관리자): 계정 발급, 권한과 사용 여부, 임시 비밀번호, 오늘 사용량, 모델·검색 연결 확인.
import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, UserPlus, Users, Gauge, Activity, KeyRound } from 'lucide-react';
import { auth, NetError } from '../app/http.js';
import { PageHead, Card, Btn, Field, Select, Notice, CopyBtn, Avatar, Tag, Loading, Empty, inputCls, useMe, cx } from '../ui/kit.jsx';
import { whenShort } from '../app/time.js';

const ROLES = [['VIEWER', '열람', '읽기만'], ['EDITOR', '편집', '검토·과제·결과·보고서'], ['ADMIN', '관리', '계정 관리까지']];

function Secret({ label, value, onClose }) {
  return (
    <Notice tone="ok" role="status" title={label} action={<><CopyBtn value={value} /><Btn size="sm" kind="ghost" onClick={onClose}>닫기</Btn></>}>
      <p>임시 비밀번호 <code className="num rounded-md bg-white px-2 py-0.5 text-sm font-semibold text-g900">{value}</code></p>
      <p className="text-g600">이 비밀번호는 지금 한 번만 보입니다. 직접 전달하고, 처음 로그인하면 바꾸도록 안내하세요.</p>
    </Notice>
  );
}

function Meter({ label, used, limit }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = !limit ? 'bg-g300' : pct >= 90 ? 'bg-negative' : pct >= 60 ? 'bg-warning' : 'bg-positive';
  return (
    <div className="rounded-2xl border border-g200 bg-white p-4">
      <p className="text-sm text-g600">{label}</p>
      <p className="num mt-1 text-2xl font-bold text-g900">{used}<span className="text-base font-semibold text-g400"> / {limit || '제한 없음'}</span></p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-g100"><div className={cx('h-full rounded-full', tone)} style={{ width: `${limit ? pct : 0}%` }} /></div>
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
  const Row = ({ label, ok, text, extra }) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-g100 px-4 py-3">
      <span className="w-28 shrink-0 text-sm font-semibold text-g800">{label}</span>
      <Tag tone={ok ? 'pos' : 'neg'}>{ok ? '정상' : '실패'}</Tag>
      <span className="min-w-0 flex-1 text-sm text-g600">{text}</span>
      {extra ? <span className="w-full break-all text-xs text-g500">{extra}</span> : null}
    </div>
  );
  return (
    <Card title="모델·검색 연결 확인" icon={Activity} sub="이 서버에서 실제 모델을 한 번 부르고, 원하면 공개 자료 검색과 정부 사이트 원문 받기까지 해 봅니다. 확인에 쓴 호출도 OpenAI 사용량에 들어갑니다.">
      <div className="flex flex-wrap gap-2">
        <Btn busy={st && st.busy === 'model'} disabled={busy} onClick={() => run(false)}>모델 호출 확인</Btn>
        <Btn kind="primary" busy={st && st.busy === 'search'} disabled={busy} onClick={() => run(true)}>검색과 원문 받기까지 확인</Btn>
      </div>
      {st && st.error ? <Notice tone="bad" role="alert" className="mt-4">{st.error}</Notice> : null}
      {d ? (
        <div className="mt-4 space-y-2" role="status">
          <Row label="모델" ok={d.ok} text={d.ok ? `${d.model} · ${d.latency_ms}ms` : `${d.model} · ${d.error}`} />
          {d.search ? <Row label="공개 자료 검색" ok={d.search.ok} text={d.search.ok ? `결과 ${d.search.results}건 · ${d.search.latency_ms}ms` : d.search.error} /> : null}
          {d.fetch ? <Row label="원문 받기" ok={d.fetch.ok} text={d.fetch.ok ? `본문 ${d.fetch.chars.toLocaleString('ko-KR')}자 · ${d.fetch.latency_ms}ms` : d.fetch.error} extra={d.fetch.url} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function Members() {
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
  const self = (u) => u.id === (me && me.actor_id);
  return (
    <>
      <PageHead pill="관리자" icon={ShieldCheck} title="구성원 관리" desc="편집국 공간의 계정을 발급하고 권한을 정합니다. 열람은 읽기만, 편집은 검토와 과제를, 관리는 계정 관리까지 할 수 있습니다." />
      <div className="space-y-4">
        {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}
        {secret ? <Secret {...secret} onClose={() => setSecret(null)} /> : null}
        <Card title="계정 발급" icon={UserPlus}>
          <form className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); invite(); }} noValidate>
            <Field id="m-email" label="이메일" required><input id="m-email" type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field id="m-name" label="이름" required><input id="m-name" type="text" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field id="m-role" label="권한">
              <Select id="m-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map(([v, l, d]) => <option key={v} value={v}>{l} · {d}</option>)}
              </Select>
            </Field>
            <Btn kind="primary" type="submit" size="lg" busy={busy === 'invite'}>계정 만들기</Btn>
          </form>
        </Card>
        <Card title={`구성원 ${data ? data.items.length : ''}`} icon={Users} sub="계정을 중지하면 그 계정의 로그인은 바로 끊깁니다. 만든 기획과 기록은 지우지 않습니다.">
          {!data && !error ? <Loading what="구성원" /> : null}
          {data && !data.items.length ? <Empty /> : null}
          {data && data.items.length ? (
            <ul className="space-y-2">
              {data.items.map((u) => (
                <li key={u.id} className={cx('flex flex-wrap items-center gap-3 rounded-xl border border-g100 px-4 py-3', !u.active && 'bg-g50 opacity-70')}>
                  <Avatar name={u.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-g900">{u.name}
                      {self(u) ? <Tag tone="brand">나</Tag> : null}
                      {u.must_change_password ? <Tag tone="warn">임시 비밀번호</Tag> : null}
                      {!u.active ? <Tag>중지됨</Tag> : null}
                    </p>
                    <p className="truncate text-xs text-g500">{u.email} · 만든 시각 {whenShort(u.created_at)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select small id={`role-${u.id}`} label={`${u.name} 권한`} value={u.role} disabled={busy !== null || self(u)} className="w-[96px]"
                      onChange={(e) => run(`role:${u.id}`, `/api/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } })}>
                      {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <label className={cx('inline-flex items-center gap-1.5 rounded-lg border border-g200 px-2.5 py-1.5 text-xs font-medium text-g700', (busy !== null || self(u)) && 'opacity-50')}>
                      <input type="checkbox" className="size-3.5 accent-brand" checked={u.active} disabled={busy !== null || self(u)}
                        onChange={(e) => run(`active:${u.id}`, `/api/admin/users/${u.id}`, { method: 'PATCH', body: { active: e.target.checked } })} />
                      {u.active ? '사용 중' : '중지됨'}<span className="sr-only"> {u.name}</span>
                    </label>
                    {!self(u) ? <Btn size="sm" icon={KeyRound} busy={busy === `reset:${u.id}`} onClick={() => reset(u)}>임시 비밀번호<span className="sr-only"> {u.name}</span></Btn> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        {usage ? (
          <Card title="오늘 모델 사용량" icon={Gauge} sub={`${usage.day} (UTC) 기준. 한도는 서버 환경변수 DAILY_MODEL_CALL_LIMIT, DAILY_SEARCH_CALL_LIMIT로 정하며, 비용은 연결한 OpenAI 계정에 청구됩니다.`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Meter label="판정·정리 호출" used={usage.model_calls || 0} limit={data.limits.model_calls} />
              <Meter label="공개 자료 검색 호출" used={usage.search_calls || 0} limit={data.limits.search_calls} />
            </div>
          </Card>
        ) : null}
        <LlmCheck />
      </div>
    </>
  );
}
