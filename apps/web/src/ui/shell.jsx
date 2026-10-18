// The sticky top bar (logo, case picker, activity, actions, account) and,
// on a case page, the stepper that walks the review from input to report.
import { Newspaper, Plus, History, ShieldCheck, LogOut, Check, ChevronRight, LoaderCircle } from 'lucide-react';
import { app, useStore, go, navigate, openCase, openPage, openModal } from '../app/store.js';
import { useQuery, ACTIVE, resultRoute } from '../app/api.js';
import { logout } from '../app/session.js';
import { Notice, Select, canWrite, cx, ROLE, Dot } from './kit.jsx';

function IconBtn({ icon: Icon, label, onClick, active }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} title={label}
      className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition', active ? 'bg-g100 text-g900' : 'text-g600 hover:bg-g100 hover:text-g800')}>
      <Icon className="size-4" aria-hidden="true" /><span className="hidden lg:inline">{label}</span><span className="sr-only lg:hidden">{label}</span>
    </button>
  );
}

// what is running anywhere, and whether the server answers
function Activity({ caseId }) {
  const jobs = useStore(app, (s) => s.jobs);
  const failing = useStore(app, (s) => s.watch.failing);
  const live = Object.values(jobs).filter((j) => j.data && ACTIVE.has(j.data.status));
  if (failing) {
    return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-ink" role="status"><Dot className="bg-warning" /><span className="hidden sm:inline">서버 응답 확인 중</span></span>;
  }
  if (live.length) {
    const first = live.find((j) => j.caseId === caseId) || live[0];
    return (
      <button type="button" onClick={() => navigate(resultRoute(first.kind, first.caseId, first.data))} title="진행 중인 작업으로 이동"
        className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-brand hover:bg-brand-bg" role="status">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /><span className="hidden sm:inline">작업 {live.length}건 진행 중</span><span className="sr-only sm:hidden">작업 {live.length}건 진행 중</span>
      </button>
    );
  }
  return <span className="hidden items-center gap-1.5 text-xs font-medium text-positive-ink sm:inline-flex"><Dot className="bg-positive" />연결됨</span>;
}

function CasePicker({ caseId, me }) {
  const q = useQuery('listCases', {}, !!me);
  const items = q.data ? q.data.items : [];
  if (!items.length) return null;
  const known = items.some((c) => c.id === caseId);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="hidden text-g300 md:inline" aria-hidden="true">·</span>
      <Select small label="기획 고르기" value={known ? caseId : ''} onChange={(e) => (e.target.value ? openCase(e.target.value) : openPage('cases'))} className="w-[150px] sm:w-[220px]">
        {!known ? <option value="">기획 고르기</option> : null}
        {items.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </Select>
    </div>
  );
}

export function Stepper({ steps }) {
  const cur = steps.findIndex((s) => s.enabled && !s.done);
  return (
    <nav aria-label="검토 단계" className="border-t border-g100">
      <ol className="relative mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-3 py-2 sm:px-5">
        {steps.map((s, i) => (
          <li key={s.id} className="flex shrink-0 items-center">
            <button type="button" disabled={!s.enabled} onClick={() => go({ to: s.id })} aria-current={i === cur ? 'step' : undefined}
              className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm transition',
                !s.enabled ? 'cursor-not-allowed text-g300' : i === cur ? 'bg-brand-bg font-semibold text-brand' : 'text-g700 hover:bg-g100')}>
              <span className={cx('grid size-4 place-items-center rounded-full border text-[9px]',
                s.done ? 'border-positive bg-positive text-white' : s.enabled ? 'border-brand text-brand' : 'border-g200 text-g300')}>
                {s.done ? <Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" /> : <span className="num">{i + 1}</span>}
              </span>
              <span className={cx(s.done && i !== cur && 'text-g600')}>{s.label}</span>
              <span className="sr-only">{s.done ? ' 완료' : !s.enabled ? ' 아직 열리지 않음' : i === cur ? ' 지금 할 단계' : ''}</span>
            </button>
            {i < steps.length - 1 ? <ChevronRight className="size-3.5 text-g300" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function TopBar({ me, steps }) {
  const page = useStore(app, (s) => s.page);
  const caseId = useStore(app, (s) => s.route.caseId);
  const admin = !!me && me.role === 'ADMIN' && !me.demo_only;
  return (
    <header className="sticky z-30 border-b border-g200 bg-white/95 backdrop-blur" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <button type="button" onClick={() => openPage('cases')} className="flex shrink-0 items-center gap-2 rounded-lg" aria-label="Audience Lab 기획 목록">
          <span className="grid size-7 place-items-center rounded-lg bg-brand text-white"><Newspaper className="size-4" aria-hidden="true" /></span>
          <span className="hidden text-[15px] font-bold tracking-tight text-g900 sm:inline">Audience Lab</span>
        </button>
        {me ? <CasePicker caseId={caseId} me={me} /> : null}
        {me ? <Activity caseId={caseId} /> : null}
        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          {canWrite(me) ? (
            <button type="button" onClick={() => openCase('new')}
              className="mr-1 inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-press sm:px-3">
              <Plus className="size-4" aria-hidden="true" /><span className="hidden sm:inline">새 기획</span><span className="sr-only sm:hidden">새 기획</span>
            </button>
          ) : null}
          <IconBtn icon={History} label="기획 목록" onClick={() => openPage('cases')} active={page === 'cases'} />
          {admin ? <IconBtn icon={ShieldCheck} label="구성원 관리" onClick={() => openPage('members')} active={page === 'members'} /> : null}
          <span className="mx-1 hidden h-5 w-px bg-g200 sm:block" aria-hidden="true" />
          {me ? (
            <button type="button" onClick={() => openModal('account')} className="rounded-lg px-2 py-1.5 text-sm text-g600 hover:bg-g100" title="내 계정">
              <span className="max-w-[88px] truncate align-middle sm:max-w-none">{me.name}</span>
              <span className="ml-1 hidden text-xs text-g400 md:inline">{ROLE[me.role] || me.role}</span>
            </button>
          ) : null}
          <button type="button" onClick={logout} className="rounded-lg p-1.5 text-g500 hover:bg-g100 hover:text-g700" title="로그아웃" aria-label="로그아웃">
            <LogOut className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      {steps ? <Stepper steps={steps} /> : null}
    </header>
  );
}

// Facts about this server and space that change how the page should be read.
export function Banners({ me, demoCase }) {
  if (!me) return null;
  return (
    <div className="mb-6 space-y-2 empty:hidden">
      {me.demo_only ? (
        <Notice tone="demo" title="시연 공간">
          가상의 청람시 자료로 입력부터 보고서까지 모든 단계를 써 볼 수 있습니다. 실제 검색과 모델 판정은 쓰지 않으며, 서버가 다시 시작되면 처음 상태로 돌아갑니다.
        </Notice>
      ) : null}
      {!me.demo_only && demoCase ? (
        <Notice tone="demo" title="시연 기획">청람시와 이 기획의 문서·금액은 인수 시험용 가상 자료이며, 실제 검색과 모델 대신 미리 정해 둔 결과로 답합니다.</Notice>
      ) : null}
      {!me.demo_only && !me.live_model ? (
        <Notice tone="warn" title="실제 검색과 판정이 꺼져 있습니다">서버에 OpenAI 키가 설정되지 않았습니다. 제목이 '청람시 도서관 계약 검토'인 시연 기획으로 흐름만 확인할 수 있습니다.</Notice>
      ) : null}
      {!me.demo_only && me.ephemeral ? (
        <Notice tone="mute">무료 서버라 다시 시작되면(15분 동안 접속이 없을 때 포함) 기획·초대 계정·보고서가 지워집니다. 남길 결과는 보고서 파일로 받아 두세요.</Notice>
      ) : null}
    </div>
  );
}
