// Product shell: who is signed in, then the case page, the list of cases,
// a new case, or the members console.
import { useEffect } from 'react';
import { app, useStore, openCase } from './app/store.js';
import { useQuery } from './app/api.js';
import { MeContext, QueryState, Toasts } from './ui/kit.jsx';
import { TopBar, Banners } from './ui/shell.jsx';
import { Login } from './pages/Login.jsx';
import { Cases } from './pages/Cases.jsx';
import { Members } from './pages/Members.jsx';
import { AccountModal } from './pages/Account.jsx';
import { CasePage } from './case/CasePage.jsx';
import { NewCase } from './case/InputSection.jsx';

// After signing in, open the newest case once, the way MarketView opens the
// current project. The list stays one click away in the top bar.
function useAutoOpen(me) {
  const autoOpen = useStore(app, (s) => s.autoOpen);
  const caseId = useStore(app, (s) => s.route.caseId);
  const page = useStore(app, (s) => s.page);
  const want = !!me && autoOpen && !caseId && !page;
  const q = useQuery('listCases', {}, want);
  useEffect(() => {
    if (!want || !q.data) return;
    const items = [...q.data.items].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (items.length) openCase(items[0].id);
    else app.set({ autoOpen: false });
  }, [want, q.data]);
  return want && !q.data && !q.error && !q.net;
}

export function App() {
  const boot = useStore(app, (s) => s.boot);
  const token = useStore(app, (s) => s.token);
  const caseId = useStore(app, (s) => s.route.caseId);
  const page = useStore(app, (s) => s.page);
  const modal = useStore(app, (s) => s.modal);
  const authLost = useStore(app, (s) => s.authLost);
  const me = useQuery('whoami', { authLost }, !!token);
  const expired = !!token && me.status === 401;
  const m = me.data;
  const waiting = useAutoOpen(!expired && token ? m : null);
  if (!token || expired) return <Login key={boot} expired={expired} />;
  const onCase = m && !page && caseId && caseId !== 'new';
  return (
    <MeContext.Provider value={m}>
      <div className="min-h-screen bg-g50">
        {onCase ? <CasePage key={`${boot}:${caseId}`} caseId={caseId} /> : (
          <>
            <TopBar me={m} />
            <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
              <Banners me={m} />
              {!m ? <QueryState q={me} what="사용자 정보" /> : null}
              {m && page === 'members' ? <Members /> : null}
              {m && !page && caseId === 'new' ? <NewCase key={`new:${boot}`} /> : null}
              {m && (page === 'cases' || (!page && !caseId)) && !waiting ? <Cases /> : null}
            </main>
          </>
        )}
        {m && modal === 'account' ? <AccountModal /> : null}
        <Toasts />
      </div>
    </MeContext.Provider>
  );
}
