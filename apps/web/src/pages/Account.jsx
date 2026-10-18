// 내 계정 (MarketView password modal): 이름과 권한, 비밀번호 바꾸기, 로그아웃.
import { useState, useEffect } from 'react';
import { LogOut, KeyRound } from 'lucide-react';
import { openModal } from '../app/store.js';
import { auth, NetError } from '../app/http.js';
import { logout } from '../app/session.js';
import { Modal, Btn, Field, Notice, KV, Avatar, inputCls, useMe, ROLE } from '../ui/kit.jsx';

export function AccountModal() {
  const me = useMe();
  const [acc, setAcc] = useState(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [st, setSt] = useState({});
  useEffect(() => { auth('/api/auth/me', { method: 'GET' }).then((r) => { if (r.ok) setAcc(r.data); }, () => {}); }, []);
  const close = () => openModal(null);
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
  if (!me) return null;
  return (
    <Modal title="내 계정" onClose={close} labelledBy="account-title">
      <div className="flex items-center gap-3">
        <Avatar name={me.name} />
        <div className="min-w-0">
          <p className="font-semibold text-g900">{me.name}</p>
          <p className="truncate text-sm text-g500">{me.email}</p>
        </div>
      </div>
      <KV className="mt-4 text-sm" rows={[
        ['권한', `${ROLE[me.role] || me.role}${me.role === 'VIEWER' ? ' · 읽기만' : me.role === 'ADMIN' ? ' · 계정 관리 포함' : ' · 검토·과제·보고서'}`],
        ['공간', me.demo_only ? '시연 공간 (가상 자료만)' : '편집국'],
      ]} />
      {acc && acc.must_change_password ? <Notice tone="warn" role="status" className="mt-4">관리자가 발급한 임시 비밀번호로 로그인했습니다. 지금 새 비밀번호로 바꿔 주세요.</Notice> : null}
      {me.demo_only ? <Notice tone="mute" className="mt-4">시연 계정은 비밀번호를 바꿀 수 없습니다.</Notice> : (
        <form className="mt-5 space-y-3 border-t border-g100 pt-5" onSubmit={(e) => { e.preventDefault(); change(); }} noValidate>
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-g900"><KeyRound className="size-4 text-g500" aria-hidden="true" />비밀번호 바꾸기</h3>
          <Field id="pw-cur" label="지금 비밀번호"><input id="pw-cur" type="password" autoComplete="current-password" className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field id="pw-new" label="새 비밀번호" hint="8자 이상"><input id="pw-new" type="password" autoComplete="new-password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field id="pw-again" label="새 비밀번호 확인"><input id="pw-again" type="password" autoComplete="new-password" className={inputCls} value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
          {st.error ? <p className="rounded-xl bg-negative-bg px-4 py-3 text-sm text-negative-ink" role="alert">{st.error}</p> : null}
          {st.ok ? <Notice tone="ok" role="status">비밀번호를 바꿨습니다.</Notice> : null}
          <Btn kind="primary" size="block" type="submit" busy={st.busy}>비밀번호 바꾸기</Btn>
        </form>
      )}
      <div className="mt-5 flex items-center gap-2 border-t border-g100 pt-4">
        <Btn kind="ghost" icon={LogOut} onClick={logout}>로그아웃</Btn>
        <Btn className="ml-auto" onClick={close}>닫기</Btn>
      </div>
    </Modal>
  );
}
