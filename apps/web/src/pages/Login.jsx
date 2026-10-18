// 로그인: 관리자가 발급한 계정, 또는 시연 공간의 시연 계정.
import { useState, useEffect } from 'react';
import { Newspaper, ArrowRight, FlaskConical } from 'lucide-react';
import { saveToken, openModal } from '../app/store.js';
import { auth, NetError } from '../app/http.js';
import { Notice, Avatar, ROLE, cx } from '../ui/kit.jsx';

const big = 'block w-full rounded-2xl border border-g200 bg-white px-5 py-4 text-base text-g900 placeholder:text-g400 transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10';

export function Login({ expired }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [demo, setDemo] = useState(null);
  useEffect(() => {
    auth('/api/auth/demo-accounts', { method: 'GET', token: null }).then((r) => { if (r.ok) setDemo(r.data); }, () => {});
  }, []);
  const signIn = async (e, p, who) => {
    setBusy(who); setError(null);
    try {
      const r = await auth('/api/auth/login', { body: { email: e, password: p }, token: null });
      if (!r.ok) { setError(r.error ? r.error.message : '로그인하지 못했습니다.'); return; }
      saveToken(r.data.token, { keepRoute: !!expired });
      if (r.data.user.must_change_password) openModal('account');
    } catch (err) {
      if (!(err instanceof NetError)) throw err;
      setError('서버에 닿지 않았습니다. 연결을 확인한 뒤 다시 시도하세요. 무료 서버는 깨어나는 데 1분쯤 걸릴 수 있습니다.');
    } finally { setBusy(null); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-g50 px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-bg px-4 py-1.5 text-[15px] font-semibold text-brand">
            <Newspaper className="size-4" aria-hidden="true" />Audience Lab
          </span>
          <h1 className="mt-5 text-[32px] font-bold leading-tight tracking-tight text-g900">편집국 기획 검토</h1>
          <p className="mt-2 text-base leading-relaxed text-g500">기획과 초안을 공개 자료와 대조해<br />문장마다 근거를 붙입니다.</p>
        </div>
        {expired ? <Notice tone="warn" role="status" className="mb-4">로그인이 만료되었습니다. 다시 로그인하면 보던 기획으로 이어서 갈 수 있습니다.</Notice> : null}
        <form className="space-y-5 rounded-[28px] bg-white p-8 shadow-[0_8px_40px_rgba(14,18,24,0.06)] ring-1 ring-g100" onSubmit={(e) => { e.preventDefault(); signIn(email, password, 'form'); }} noValidate>
          <div>
            <label htmlFor="login-email" className="mb-2 block text-sm font-medium text-g600">이메일</label>
            <input id="login-email" type="email" autoComplete="username" className={big} placeholder="name@newsroom.kr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-2 block text-sm font-medium text-g600">비밀번호</label>
            <input id="login-password" type="password" autoComplete="current-password" className={big} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error ? <p className="rounded-xl bg-negative-bg px-4 py-3 text-sm text-negative-ink" role="alert">{error}</p> : null}
          <button type="submit" disabled={!!busy} className="w-full rounded-2xl bg-brand px-5 py-4 text-lg font-semibold text-white transition hover:bg-brand-press disabled:bg-g300">
            {busy === 'form' ? '로그인 중…' : '로그인'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-g500">계정은 편집국 관리자가 발급합니다. 공개 가입은 없습니다.</p>

        {demo && demo.enabled ? (
          <section className="mt-10" aria-labelledby="login-demo-h">
            <div className="flex items-center gap-2">
              <FlaskConical className="size-4 text-example" aria-hidden="true" />
              <h2 id="login-demo-h" className="text-sm font-bold text-g800">시연 계정으로 둘러보기</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-g500">편집국 공간과 분리된 시연 공간입니다. 가상의 청람시 자료로 모든 단계를 써 볼 수 있고, 실제 검색과 모델 판정은 쓰지 않습니다.</p>
            <div className="mt-3 grid gap-2">
              {demo.accounts.map((a) => (
                <button key={a.email} type="button" disabled={!!busy} onClick={() => signIn(a.email, demo.password, a.email)}
                  className={cx('flex items-center gap-3 rounded-2xl border border-g200 bg-white px-4 py-3 text-left transition hover:border-brand disabled:cursor-not-allowed', busy === a.email && 'border-brand')}>
                  <Avatar name={a.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-g900">{a.name}</span>
                    <span className="block text-xs text-g500">{ROLE[a.role] || a.role} 권한{a.role === 'VIEWER' ? ' · 읽기만' : ' · 검토·과제·보고서'}</span>
                  </span>
                  <ArrowRight className="size-4 text-g400" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
