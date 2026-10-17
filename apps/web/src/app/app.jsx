// Product shell: who is signed in, the list of plans, one plan with its nine screens.
/* global React */
import * as L from '../labels.js';
import { app, useStore, go, openCase, openPage } from './store.js';
import { useQuery, useLedger, ACTIVE } from './api.js';
import { SourcePanel } from './panel.jsx';
import { isDemoTitle } from './demo.js';
import { LoginScreen } from './screens/login.jsx';
import { AccountScreen, logout } from './screens/account.jsx';
import { MembersScreen } from './screens/members.jsx';
import { Id, Pins, Btn, Tabs, Toasts, QueryState, MeContext, useMe, canWrite, cx } from './ui.jsx';
import { when, whenShort, short } from './time.js';
import { IntakeScreen } from './screens/intake.jsx';
import { StatusScreen } from './screens/status.jsx';
import { ReviewScreen } from './screens/review.jsx';
import { TasksScreen } from './screens/tasks.jsx';
import { ResultsScreen } from './screens/results.jsx';
import { CompareScreen } from './screens/compare.jsx';
import { ChangesScreen } from './screens/changes.jsx';
import { ExportScreen } from './screens/exports.jsx';

const { useEffect, useRef } = React;
const ROLE = { VIEWER: '열람', EDITOR: '편집', ADMIN: '관리' };
const NO_VERSIONS = { contents: [], states: [] };

// A step to another screen made from inside a screen (a button, a finished
// job's link) lands at the top of the new screen with focus on its heading.
// Moving along the tab list keeps focus on the tabs, and a link that names one
// result leaves the placing to that result's own screen.
function useScreenArrival(tab, reveal) {
  const seen = useRef({ tab, reveal });
  useEffect(() => {
    const was = seen.current;
    seen.current = { tab, reveal };
    const moved = was.tab !== tab || (!!reveal && reveal !== was.reveal);
    if (!moved || (reveal && reveal.kind !== 'screen')) return;
    const list = document.getElementById('case-tabs');
    const body = document.getElementById('case-screen');
    const at = document.activeElement;
    if (!list || !body || list.contains(at) || (at && at.closest && at.closest('.tool'))) return;
    if (list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: 'start' });
    const h = body.querySelector('h2') || body;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }, [tab, reveal]);
}

function CaseList() {
  const me = useMe();
  const q = useQuery('listCases', {});
  const items = q.data ? q.data.items : [];
  return (
    <div className="screen screen-solo">
      <div className="screen-top">
        <h2>기획 목록 <span className="count">{items.length}</span></h2>
        {canWrite(me) ? <Btn kind="primary" onClick={() => go({ caseId: 'new' })}>새 기획</Btn> : <span className="muted">열람 권한에서는 기획을 만들 수 없습니다.</span>}
      </div>
      <QueryState q={q} what="기획 목록" />
      {q.data && items.length === 0 ? <p className="empty">아직 기획이 없습니다. 질문과 초안 또는 공개 자료를 넣어 첫 검토를 시작하세요.</p> : null}
      {items.length ? (
        <div className="scroll-x">
          <table className="grid">
            <thead><tr><th scope="col">기획</th><th scope="col">최초 기준 시각</th><th scope="col">만든 시각</th><th scope="col">활성 입력</th><th scope="col">활성 결과</th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><button type="button" className="link strong" onClick={() => openCase(c.id, 'review')}>{c.title}</button> <span className="mono">{short(c.id)}</span></td>
                  <td>{when(c.as_of)}</td>
                  <td>{whenShort(c.created_at)}</td>
                  <td>{c.head ? (c.head.content_version_id ? '초안 있음' : '초안 없음') : '지정되지 않음'}</td>
                  <td>{c.head && c.head.review_id ? <>초안 검토 <span className="mono">{short(c.head.review_id)}</span></> : c.head && c.head.pack_id ? <>근거 묶음 <span className="mono">{short(c.head.pack_id)}</span></> : '없음'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function CaseWorkspace({ caseId }) {
  const route = useStore(app, (s) => s.route);
  const panel = useStore(app, (s) => s.panel);
  const jobs = useStore(app, (s) => s.jobs);
  const led = useStore(app, (s) => s.ledger[caseId]);
  const p = { case_id: caseId };
  const cq = useQuery('getCase', p);
  const contents = useQuery('listContentVersions', p);
  const states = useQuery('listStateVersions', p);
  const notes = useQuery('listNotifications', p);
  const tasks = useQuery('listReportingTasks', p);
  useLedger(caseId);                    // every result the server holds for this case, made here or elsewhere
  useScreenArrival(route.tab, route.reveal || null);
  if (!cq.data) {
    return (
      <div className="screen screen-solo">
        <QueryState q={cq} what="기획" />
        {cq.error ? <p><Btn onClick={() => openCase(null)}>기획 목록으로</Btn></p> : null}
      </div>
    );
  }
  const c = cq.data;
  const head = c.head || {};
  const versions = { contents: contents.data ? contents.data.items : [], states: states.data ? states.data.items : [] };
  const state = versions.states.find((s) => s.id === head.state_version_id);
  const draft = versions.contents.find((v) => v.id === head.content_version_id);
  const live = led ? ['execution', 'review', 'reassessment', 'search', 'export'].reduce((n, k) => n + led[k].filter((id) => jobs[id] && jobs[id].data && ACTIVE.has(jobs[id].data.status)).length, 0) : 0;
  const openTasks = tasks.data ? tasks.data.items.filter((t) => t.status === 'OPEN').length : 0;
  const unread = notes.data ? notes.data.items.filter((n) => !n.read_at).length : 0;
  const tab = route.tab;
  const items = [
    { id: 'intake', label: '기획 입력' },
    { id: 'status', label: '실행 상태', badge: live || null },
    { id: 'review', label: '기획 검토' },
    { id: 'tasks', label: '취재 과제', badge: openTasks || null },
    { id: 'results', label: '취재 결과' },
    { id: 'compare', label: '검토 비교', badge: led && led.delta.length ? led.delta.length : null },
    { id: 'changes', label: '변경과 검색', badge: unread || null },
    { id: 'export', label: '보고서 출력' },
  ];
  return (
    <div className={cx('case', panel && 'with-panel')}>
      <div className="case-main">
        <header className="casehead">
          <p className="crumb"><button type="button" className="link" onClick={() => openCase(null)}>기획 목록</button> <span aria-hidden="true">›</span> 기획 <span className="mono">{short(c.id)}</span></p>
          <h1>{c.title}</h1>
          {state ? <p className="casehead-q">{state.state.primary_editorial_question}</p> : null}
          {(led && led.demo) || isDemoTitle(c.title)
            ? <p className="fiction">시연 기획입니다. 청람시와 이 기획의 문서·금액은 인수 시험용으로 만든 가상 자료이며, 실제 검색과 모델 대신 미리 정해 둔 결과로 답합니다.</p>
            : <p className="casenote">공개 자료와 대조한 AI 보조 검토입니다. 판정은 기준 시각까지 확인한 자료 범위 안에서만 유효하며, 게재 판단은 사람이 합니다.</p>}
          <Pins items={[
            { label: '최초 기준 시각', text: when(c.as_of) },
            { label: '활성 초안', text: head.content_version_id ? undefined : '없음', id: head.content_version_id || undefined, extra: draft ? `v${draft.version_number}` : '' },
            { label: '질문 상태', text: head.state_version_id ? undefined : '없음', id: head.state_version_id || undefined, extra: state ? `v${state.version_number}` : '' },
            { label: '활성 근거 묶음', text: head.pack_id ? undefined : '없음', id: head.pack_id || undefined },
            { label: '활성 검토', text: head.review_id ? undefined : '없음', id: head.review_id || undefined },
          ]} />
          {cq.net ? <QueryState q={cq} /> : null}
        </header>
        <Tabs id="case-tabs" label="기획 화면" value={tab} onChange={(id) => go({ tab: id })} items={items} />
        <div role="tabpanel" id="case-screen" aria-labelledby={`tab-${tab}`}>
          {tab === 'intake' && contents.data && states.data ? <IntakeScreen key={c.id} c={c} versions={versions} /> : null}
          {tab === 'intake' && !(contents.data && states.data) ? <div className="screen"><QueryState q={contents.data ? states : contents} what="저장된 버전" /></div> : null}
          {tab === 'status' ? <StatusScreen c={c} /> : null}
          {tab === 'review' ? <ReviewScreen c={c} versions={versions} /> : null}
          {tab === 'tasks' ? <TasksScreen c={c} /> : null}
          {tab === 'results' ? <ResultsScreen c={c} /> : null}
          {tab === 'compare' ? <CompareScreen c={c} /> : null}
          {tab === 'changes' ? <ChangesScreen c={c} /> : null}
          {tab === 'export' ? <ExportScreen c={c} /> : null}
        </div>
      </div>
      <SourcePanel />
    </div>
  );
}

function Banner({ me }) {
  if (!me) return null;
  if (me.demo_only) {
    return <p className="fiction">시연 공간입니다. 가상의 청람시 자료로 모든 화면을 써 볼 수 있습니다. 편집국 공간과 분리되어 있어 실제 기획은 보이지 않으며, 실제 검색과 모델 판정은 쓰지 않습니다.</p>;
  }
  if (!me.live_model) {
    return <p className="note tone-warn">서버에 OpenAI 키가 설정되지 않아 실제 공개 자료 검색과 판정이 꺼져 있습니다. 제목이 '청람시 도서관 계약 검토'인 시연 기획으로 흐름만 확인할 수 있습니다.</p>;
  }
  return null;
}

export function App() {
  const boot = useStore(app, (s) => s.boot);
  const token = useStore(app, (s) => s.token);
  const caseId = useStore(app, (s) => s.route.caseId);
  const page = useStore(app, (s) => s.page);
  const authLost = useStore(app, (s) => s.authLost);
  const me = useQuery('whoami', { authLost }, !!token);
  const expired = !!token && me.status === 401;
  if (!token || expired) return <LoginScreen key={boot} expired={expired} />;
  const m = me.data;
  return (
    <div className="wrap">
      <header className="apphead">
        <button type="button" className="brand link-plain" onClick={() => openPage(null)}><span className="brand-n">Audience Lab</span><span className="brand-s">기획 검토</span></button>
        <div className="who">
          {m ? (
            <>
              <span>{m.demo_only ? '시연 공간' : '편집국'}</span>
              <span>{m.name}</span>
              <span className="chip">{ROLE[m.role] || m.role} 권한 <code>{m.role}</code></span>
              {m.role === 'ADMIN' && !m.demo_only ? <button type="button" className="link" onClick={() => openPage('members')}>구성원 관리</button> : null}
              <button type="button" className="link" onClick={() => openPage('account')}>내 계정</button>
              <button type="button" className="link quiet" onClick={logout}>로그아웃</button>
            </>
          ) : <span>사용자 확인 중</span>}
        </div>
      </header>
      <Banner me={m} />
      <main>
        <MeContext.Provider value={m}>
          {!m ? <div className="screen screen-solo"><QueryState q={me} what="사용자 정보" /></div> : null}
          {m && page === 'members' ? <MembersScreen /> : null}
          {m && page === 'account' ? <AccountScreen /> : null}
          {m && !page && caseId === 'new' ? (
            <>
              <p className="crumb crumb-solo"><button type="button" className="link" onClick={() => openCase(null)}>기획 목록</button> <span aria-hidden="true">›</span> 새 기획</p>
              <div className="solo"><IntakeScreen key={`new:${boot}`} c={null} versions={NO_VERSIONS} /></div>
            </>
          ) : null}
          {m && !page && caseId && caseId !== 'new' ? <CaseWorkspace key={`${boot}:${caseId}`} caseId={caseId} /> : null}
          {m && !page && !caseId ? <CaseList /> : null}
        </MeContext.Provider>
      </main>
      <Toasts />
    </div>
  );
}
