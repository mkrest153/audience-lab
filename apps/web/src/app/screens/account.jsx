// 내 계정: 이름과 권한 확인, 비밀번호 바꾸기, 로그아웃.
/* global React */
import { saveToken, openPage } from '../store.js';
import { auth, NetError } from '../http.js';
import { Btn, Field, useMe } from '../ui.jsx';

const { useState, useEffect } = React;
const ROLE = { VIEWER: '열람', EDITOR: '편집', ADMIN: '관리' };

export async function logout() {
  try { await auth('/api/auth/logout'); } catch (e) { /* the token is dropped here either way */ }
  saveToken(null);
}

export function AccountScreen() {
  const me = useMe();
  const [acc, setAcc] = useState(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [st, setSt] = useState({});
  useEffect(() => { auth('/api/auth/me', { method: 'GET' }).then((r) => { if (r.ok) setAcc(r.data); }, () => {}); }, []);
  const change = async () => {
    if (next.length < 8) { setSt({ error: '새 비밀번호는 8자 이상이어야 합니다.' }); return; }
    if (next !== again) { setSt({ error: '새 비밀번호 두 칸이 서로 다릅니다.' }); return; }
    setSt({ busy: true });
    try {
      const r = await auth('/api/auth/change-password', { body: { current_password: cur, new_password: next } });
      if (!r.ok) { setSt({ error: r.error.message }); return; }
      setCur(''); setNext(''); setAgain('');
      setSt({ ok: true });
      setAcc((a) => (a ? { ...a, must_change_password: false } : a));
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setSt({ error: '서버에 닿지 않았습니다.' });
    }
  };
  return (
    <div className="screen screen-solo">
      <div className="screen-top"><h2>내 계정</h2><Btn kind="ghost" onClick={() => openPage(null)}>기획 목록으로</Btn></div>
      {me ? (
        <dl className="kv">
          <dt>이름</dt><dd>{me.name}</dd>
          <dt>이메일</dt><dd>{me.email}</dd>
          <dt>권한</dt><dd>{ROLE[me.role] || me.role} <code>{me.role}</code></dd>
          <dt>공간</dt><dd>{me.demo_only ? '시연 공간 (가상 자료만)' : '편집국'}</dd>
        </dl>
      ) : null}
      {acc && acc.must_change_password ? <p className="note tone-warn" role="status">관리자가 발급한 임시 비밀번호로 로그인했습니다. 지금 새 비밀번호로 바꿔 주세요.</p> : null}
      {me && me.demo_only ? <p className="note tone-info">시연 계정은 비밀번호를 바꿀 수 없습니다.</p> : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); change(); }} noValidate>
          <div className="form-head"><h3>비밀번호 바꾸기</h3></div>
          <div className="form-grid form-grid-3">
            <Field id="pw-cur" label="지금 비밀번호"><input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field id="pw-new" label="새 비밀번호" hint="8자 이상"><input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <Field id="pw-again" label="새 비밀번호 확인"><input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
          </div>
          {st.error ? <p className="note tone-bad" role="alert">{st.error}</p> : null}
          {st.ok ? <p className="note tone-ok" role="status">비밀번호를 바꿨습니다.</p> : null}
          <div className="form-foot"><Btn kind="primary" type="submit" busy={st.busy}>비밀번호 바꾸기</Btn></div>
        </form>
      )}
      <p><Btn onClick={logout}>로그아웃</Btn></p>
    </div>
  );
}
