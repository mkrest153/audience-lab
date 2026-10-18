// One case on one page, read top to bottom (MarketView flow): the header,
// the summary card, then the six steps from input to report.
import { useEffect } from 'react';
import { FlaskConical, ClipboardList, ArrowRight, X } from 'lucide-react';
import { app, useStore, go, openPage } from '../app/store.js';
import { TopBar, Banners } from '../ui/shell.jsx';
import { SourcePanel } from '../ui/panel.jsx';
import { QueryState, Btn, useMe } from '../ui/kit.jsx';
import { when } from '../app/time.js';
import { CaseCtx, useCaseFacts } from './facts.js';
import { Summary } from './Summary.jsx';
import { InputSection } from './InputSection.jsx';
import { EvidenceSection } from './EvidenceSection.jsx';
import { ReviewSection } from './ReviewSection.jsx';
import { TasksSection } from './TasksSection.jsx';
import { ReassessSection } from './ReassessSection.jsx';
import { ReportSection } from './ReportSection.jsx';

// Brings the section a step named into view, and puts focus on its heading so
// keyboard and screen reader users land there too. Content above may still be
// loading, so it waits for the element briefly.
function useJump(to) {
  useEffect(() => {
    if (!to) return undefined;
    let tries = 0;
    let timer = null;
    const smooth = !window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const place = () => {
      const el = document.getElementById(to.id);
      if (!el) { if (tries++ < 30) timer = setTimeout(place, 100); return; }
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      const h = el.querySelector('[data-jump-focus]') || el.querySelector('h2, h3');
      if (h) { if (!h.hasAttribute('tabindex') && h.tagName !== 'BUTTON') h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    };
    timer = setTimeout(place, 30);
    return () => clearTimeout(timer);
  }, [to && to.seq]);
}

function CaseHead({ f }) {
  const cur = f.steps.findIndex((s) => s.enabled && !s.done);
  const step = cur >= 0 ? f.steps[cur] : null;
  return (
    <div className="mb-5">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-bg px-3 py-1 text-xs font-semibold text-brand">
        <FlaskConical className="size-3.5" aria-hidden="true" />{step ? `${cur + 1}단계 · ${step.label}` : '모든 단계 완료'}
      </span>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-g900">{f.c.title}</h1>
      {f.state ? <p className="mt-1 text-sm text-g600">기획 질문 · {f.state.state.primary_editorial_question}</p> : null}
      <p className="mt-1 text-xs text-g400">최초 기준 시각 {when(f.c.as_of)}{f.draft ? ` · 초안 v${f.draft.version_number}` : f.hasInput ? ' · 초안 없음' : ''} · 공개 자료와 대조한 AI 보조 검토</p>
    </div>
  );
}

// what has been picked for a new task, wherever the person is on the page
function PickBar({ f }) {
  const draft = useStore(app, (s) => s.taskDraft);
  const creating = useStore(app, (s) => s.route.creatingTask);
  const n = draft.assertion_ids.length + draft.conflict_ids.length + draft.unknown_ids.length;
  if (!n || creating || !f.write || !draft.origin) return null;
  return (
    <div className="fixed bottom-5 right-4 z-40 flex items-center gap-2 rounded-2xl bg-g900 py-2 pl-4 pr-2 text-sm text-white shadow-xl sm:right-6" role="status">
      <ClipboardList className="size-4 text-[#8ab8ff]" aria-hidden="true" />
      <span>과제에 담은 항목 <b className="num">{n}</b></span>
      <button type="button" onClick={() => go({ to: 'sec-tasks', creatingTask: true, taskOrigin: draft.origin })} className="inline-flex items-center gap-1 rounded-xl bg-brand px-3 py-1.5 font-semibold hover:bg-brand-press">
        과제 만들기<ArrowRight className="size-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => app.set({ taskDraft: { assertion_ids: [], conflict_ids: [], unknown_ids: [] } })} className="rounded-lg p-1.5 text-g400 hover:bg-white/10 hover:text-white" aria-label="담은 항목 모두 비우기">
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function CasePage({ caseId }) {
  const me = useMe();
  const route = useStore(app, (s) => s.route);
  const f = useCaseFacts(caseId);
  useJump(route.to);
  if (!f.c) {
    return (
      <>
        <TopBar me={me} />
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <QueryState q={f.cq} what="기획" />
          {f.cq.error ? <Btn className="mt-4" onClick={() => openPage('cases')}>기획 목록으로</Btn> : null}
        </main>
      </>
    );
  }
  return (
    <CaseCtx.Provider value={f}>
      <TopBar me={me} steps={f.steps} />
      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6">
        <Banners me={me} demoCase={f.demo} />
        <CaseHead f={f} />
        {f.cq.net ? <div className="mb-4"><QueryState q={f.cq} /></div> : null}
        <Summary />
        <div className="mt-12 space-y-14">
          <InputSection />
          <EvidenceSection />
          <ReviewSection />
          <TasksSection />
          <ReassessSection />
          <ReportSection />
        </div>
      </main>
      <PickBar f={f} />
      <SourcePanel />
    </CaseCtx.Provider>
  );
}
