// Everything the case page knows about one case, read once and shared by
// every section: the case and its versions, the results the server holds for
// it, what is running, and which step of the review comes next.
import { createContext, useContext } from 'react';
import { app, useStore } from '../app/store.js';
import { useQuery, useLedger, ACTIVE } from '../app/api.js';
import { useMe, canWrite, useDemo } from '../ui/kit.jsx';

export const CaseCtx = createContext(null);
export const useCase = () => useContext(CaseCtx);

const byCreated = (a, b) => (a.created_at || '').localeCompare(b.created_at || '');
const byAsOf = (a, b) => (a.as_of || '').localeCompare(b.as_of || '') || byCreated(a, b);
export const isDone = (d) => !!d && (d.status === 'COMPLETED' || d.status === 'PARTIAL');

// the result the review section opens when nothing else was asked for
export function defaultView(c, led) {
  const head = c && c.head;
  if (!head) return null;
  if (head.review_id) return { kind: 'review', id: head.review_id };
  if (head.pack_id && led && led.briefByPack[head.pack_id]) return { kind: 'brief', id: led.briefByPack[head.pack_id] };
  return null;
}

export function useCaseFacts(caseId) {
  const me = useMe();
  const p = { case_id: caseId };
  const cq = useQuery('getCase', p);
  const contents = useQuery('listContentVersions', p);
  const states = useQuery('listStateVersions', p);
  const tasksQ = useQuery('listReportingTasks', p);
  const notesQ = useQuery('listNotifications', p);
  useLedger(caseId);              // every result the server holds for this case, made here or elsewhere
  const led = useStore(app, (s) => s.ledger[caseId]) || null;
  const jobs = useStore(app, (s) => s.jobs);
  const c = cq.data;
  const demo = useDemo(c);
  if (!c) return { me, cq, c: null };
  const head = c.head || {};
  const versions = { contents: contents.data ? contents.data.items : [], states: states.data ? states.data.items : [] };
  const state = versions.states.find((s) => s.id === head.state_version_id) || null;
  const draft = versions.contents.find((v) => v.id === head.content_version_id) || null;
  const of = (kind, sort = byCreated) => (led ? led[kind] : []).map((id) => jobs[id] && jobs[id].data).filter(Boolean).sort(sort);
  const executions = of('execution');
  const reviews = of('review', byAsOf);
  const briefs = of('brief', byAsOf);
  const reassessments = of('reassessment');
  const searches = of('search');
  const exportsList = of('export');
  const deltas = of('delta');
  const tasks = tasksQ.data ? tasksQ.data.items : [];
  const notes = notesQ.data ? notesQ.data.items : [];
  const hasInput = !!c.head;
  const draftless = hasInput && !head.content_version_id;
  const headReview = head.review_id && jobs[head.review_id] ? jobs[head.review_id].data : null;
  const headBriefId = led && head.pack_id ? led.briefByPack[head.pack_id] || null : null;
  const headBrief = headBriefId && jobs[headBriefId] ? jobs[headBriefId].data : null;
  const reviewed = draftless ? !!headBriefId : !!head.review_id;
  const anyResult = reviewed || reviews.some(isDone) || briefs.length > 0;
  const running = [
    ...executions.map((d) => ({ kind: 'execution', d })), ...reviews.map((d) => ({ kind: 'review', d })),
    ...reassessments.map((d) => ({ kind: 'reassessment', d })), ...searches.map((d) => ({ kind: 'search', d })),
    ...exportsList.map((d) => ({ kind: 'export', d })),
  ].filter((x) => ACTIVE.has(x.d.status));
  const steps = [
    { id: 'sec-input', label: '기획 입력', done: hasInput, enabled: true },
    { id: 'sec-evidence', label: '근거 수집', done: !!head.pack_id, enabled: hasInput },
    { id: 'sec-review', label: draftless ? '기획 요약' : '초안 검토', done: reviewed, enabled: !!head.pack_id || anyResult },
    { id: 'sec-tasks', label: '취재 과제', done: tasks.length > 0, enabled: anyResult },
    { id: 'sec-reassess', label: '재검토', done: deltas.length > 0 || (draftless && briefs.length >= 2) || reassessments.some(isDone), enabled: tasks.length > 0 },
    { id: 'sec-report', label: '보고서', done: exportsList.some((x) => x.status === 'COMPLETED'), enabled: anyResult },
  ];
  return {
    me, write: canWrite(me), demo, cq, c, head, versions, versionsLoaded: !!(contents.data && states.data), state, draft, led, jobs,
    executions, reviews, briefs, reassessments, searches, exports: exportsList, deltas, tasks, tasksQ, notes,
    unread: notes.filter((n) => !n.read_at).length,
    hasInput, draftless, headReview, headBriefId, headBrief, reviewed, anyResult, running, steps,
  };
}
