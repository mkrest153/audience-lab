// 로그인: 관리자가 발급한 계정, 또는 시연 공간의 시연 계정.
/* global React */
import { saveToken, openPage } from '../store.js';
import { auth, NetError } from '../http.js';
import { Btn, Field } from '../ui.jsx';

const { useState, useEffect } = React;
const ROLE = { VIEWER: '열람', EDITOR: '편집', ADMIN: '관리' };

export function LoginScreen({ expired }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [demo, setDemo] = useState(null);
  useEffect(() => {
    auth('/api/auth/demo-accounts', { method: 'GET', token: null }).then((r) => { if (r.ok) setDemo(r.data); }, () => {});
  }, []);
  const signIn = async (e, p) => {
    setBusy(true); setError(null);
    try {
      const r = await auth('/api/auth/login', { body: { email: e, password: p }, token: null });
      if (!r.ok) { setError(r.error ? r.error.message : '로그인하지 못했습니다.'); return; }
      saveToken(r.data.token);
      openPage(r.data.user.must_change_password ? 'account' : null);
    } catch (err) {
      if (!(err instanceof NetError)) throw err;
      setError('서버에 닿지 않았습니다. 연결을 확인한 뒤 다시 시도하세요.');
    } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="login-card">
        <p className="brand"><span className="brand-n">Audience Lab</span><span className="brand-s">기획 검토</span></p>
        <h1 className="login-h">편집국 기획과 초안을 공개 자료와 대조합니다</h1>
        <p className="lede">문장마다 근거를 붙이고, 서로 다른 설명과 아직 모르는 것을 취재 과제로 넘깁니다. 게재 판단은 사람이 합니다.</p>
        {expired ? <p className="note tone-warn" role="status">로그인이 만료되었습니다. 다시 로그인하면 보던 기획으로 이어서 갈 수 있습니다.</p> : null}
        <form className="form" onSubmit={(e) => { e.preventDefault(); signIn(email, password); }} noValidate>
          <Field id="login-email" label="이메일">
            <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="login-password" label="비밀번호">
            <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error ? <p className="note tone-bad" role="alert">{error}</p> : null}
          <div className="form-foot"><Btn kind="primary" type="submit" busy={busy}>로그인</Btn></div>
          <p className="foot">계정은 편집국 관리자가 발급합니다. 공개 가입은 없습니다.</p>
        </form>
        {demo && demo.enabled ? (
          <section className="login-demo" aria-labelledby="login-demo-h">
            <h2 id="login-demo-h">시연 계정으로 둘러보기</h2>
            <p className="foot">시연 공간은 편집국 공간과 분리되어 있습니다. 가상의 청람시 자료로 입력부터 보고서까지 모든 화면을 써 볼 수 있으며, 실제 검색과 모델 판정은 쓰지 않습니다.</p>
            <div className="login-demo-b">
              {demo.accounts.map((a) => (
                <Btn key={a.email} busy={busy} onClick={() => signIn(a.email, demo.password)}>
                  {a.name} <span className="muted">{ROLE[a.role] || a.role} 권한</span>
                </Btn>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
