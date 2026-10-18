// Reading and writing through the HTTP transport: remembers every ID the
// browser has been given, keeps a status watcher on running jobs, and gives
// forms one idempotency key per intent.
import { useSyncExternalStore, useReducer, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { app, learn, bump, toast, FAST } from './store.js';
import { send, NetError, methodOf } from './http.js';

export { NetError };
export const ACTIVE = new Set(['QUEUED', 'RUNNING']);
// Resources the browser keeps a copy of by ID. The first five are jobs with a
// status to follow; Briefs and comparisons are fixed once made and read once.
export const JOB = {
  execution: { op: 'getRealityExecution', param: 'execution_id', label: '근거 수집', job: true },
  review: { op: 'getDraftReview', param: 'review_id', label: '초안 검토', job: true },
  reassessment: { op: 'getReassessment', param: 'reassessment_id', label: '재검토', job: true },
  search: { op: 'getResearchSearch', param: 'search_id', label: '공개 자료 검색', job: true },
  export: { op: 'getEditorialExport', param: 'export_id', label: '보고서 파일', job: true },
  brief: { op: 'getEditorialBrief', param: 'brief_id', label: '기획 요약', job: false },
  delta: { op: 'getReviewDelta', param: 'delta_id', label: '검토 비교', job: false },
};
const JOB_BY_OP = Object.fromEntries(Object.entries(JOB).map(([kind, j]) => [j.op, kind]));

let keySeq = 0;
export function newKey() {
  keySeq += 1;
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `key-${Date.now()}-${keySeq}-${Math.random().toString(36).slice(2)}`;
}

// Jobs started in this browser are announced when they end, however the end
// is first seen (the watcher, or a section reading the result). A fast job can
// end before the watcher's first look.
const announce = new Set();
const announced = new Set();
function finishedToast(kind, caseId, d) {
  announced.add(d.id);
  toast(label(kind, d.status), { label: '결과 보기', route: resultRoute(kind, caseId, d) }, d.status === 'FAILED' || d.status === 'BLOCKED' ? 'bad' : 'ok');
}
function noteJob(kind, caseId, d) {
  app.set((s) => ({ jobs: { ...s.jobs, [d.id]: { kind, caseId, data: d, checkedAt: Date.now() } } }));
  if (announce.has(d.id) && !ACTIVE.has(d.status)) {
    announce.delete(d.id);
    announced.add(d.id);      // the watcher's own round must not announce it again
    setTimeout(() => { bump(); finishedToast(kind, caseId, d); }, 0);
  }
}
function trackJob(kind, caseId, id) {
  app.set((s) => (s.jobs[id] ? null : { jobs: { ...s.jobs, [id]: { kind, caseId, data: null, checkedAt: null } } }));
}

// remember the IDs a response carries
function absorb(op, params, body, res) {
  const d = res.data;
  if (!d) return;
  const cid = params.case_id || d.case_id;
  const corr = res.correlation_id;
  const head = (c) => { if (c.head) learn(c.id, { pack: c.head.pack_id, review: c.head.review_id }); };
  switch (op) {
    case 'whoami': app.set({ ws: d.workspace_id }); break;
    case 'createCaseIntake': case 'appendCaseIntake':
      learn(d.case_id, { modes: { [d.state_version_id]: body.mode } }); break;
    case 'listCases': d.items.forEach(head); break;
    case 'getCase': head(d); break;
    case 'getCaseLedger': {
      const { demo, ...rest } = d;
      learn(cid, { ...rest, demo });
      ['execution', 'review', 'reassessment', 'search', 'export'].forEach((k) => d[k].forEach((id) => trackJob(k, cid, id)));
      break;
    }
    case 'createRealityExecution':
      learn(cid, { execution: d.execution_id, corr: { [d.execution_id]: corr } }); announce.add(d.execution_id); trackJob('execution', cid, d.execution_id); break;
    case 'getRealityExecution': learn(cid, { execution: d.id, pack: d.result_pack_id }); break;
    case 'createDraftReview':
      learn(cid, { review: d.review_id, corr: { [d.review_id]: corr } }); announce.add(d.review_id); trackJob('review', cid, d.review_id); break;
    case 'getDraftReview': learn(cid, { review: d.id, pack: d.reality_pack_id }); break;
    case 'createEditorialBrief':
      learn(cid, { brief: d.brief.id, pack: d.brief.reality_pack_id, briefByPack: { [d.brief.reality_pack_id]: d.brief.id }, corr: { [d.brief.id]: corr } }); break;
    case 'getEditorialBrief': {
      const known = app.get().ledger[cid];
      learn(cid, { brief: d.id, pack: d.reality_pack_id, ...(known && known.briefByPack[d.reality_pack_id] ? {} : { briefByPack: { [d.reality_pack_id]: d.id } }) });
      break;
    }
    case 'createReassessment':
      learn(cid, { reassessment: d.resource_id, corr: { [d.resource_id]: corr } }); announce.add(d.resource_id); trackJob('reassessment', cid, d.resource_id); break;
    case 'getReassessment': learn(cid, { reassessment: d.id, review: d.result_review_id, delta: d.delta_id, pack: d.result_pack_id }); break;
    case 'getReviewDelta': learn(cid, { delta: d.id, review: [d.before_review_id, d.after_review_id] }); break;
    case 'createResearchSearch':
      learn(cid, { search: d.search_id, corr: { [d.search_id]: corr } }); announce.add(d.search_id); trackJob('search', cid, d.search_id); break;
    case 'getResearchSearch': learn(cid, { submission: d.new_submission_ids }); break;
    case 'createEditorialExport':
      learn(cid, { export: d.export_id, corr: { [d.export_id]: corr } }); announce.add(d.export_id); trackJob('export', cid, d.export_id); break;
    case 'createEvidenceSubmission': learn(cid, { submission: d.submission.id }); break;
    case 'createReportingResult': learn(cid, { result: d.result.id }); break;
    case 'listReportingTasks':
      d.items.forEach((t) => learn(cid, { review: t.review_id, brief: t.brief_id, pack: t.reality_pack_id })); break;
    default:
  }
  if (JOB_BY_OP[op]) noteJob(JOB_BY_OP[op], cid, d);
}

// What the screens call. Rejects with NetError when the transport fails.
export async function api(op, opts = {}) {
  const res = await send(op, opts);
  if (res.ok) absorb(op, opts.params || {}, opts.body, res);
  return res;
}

// ---------------------------------------------------------------- reading
const cache = new Map();
export const clearCache = () => cache.clear();

// Reads one resource and reads it again whenever the page's data revision,
// the token or the parameters change. A transport failure keeps the last
// good answer and reports when it was last confirmed.
export function useQuery(op, params, enabled = true) {
  const rev = useSyncExternalStore(app.subscribe, () => app.get().rev);
  const token = useSyncExternalStore(app.subscribe, () => app.get().token);
  const boot = useSyncExternalStore(app.subscribe, () => app.get().boot);
  const pkey = JSON.stringify(params || {});
  const ckey = `${boot}|${token}|${op}|${pkey}`;
  const [, force] = useReducer((x) => x + 1, 0);
  const [manual, setManual] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const prev = cache.get(ckey) || {};
    cache.set(ckey, { ...prev, loading: true });
    force();
    api(op, { params: JSON.parse(pkey) }).then((res) => {
      cache.set(ckey, { loading: false, data: res.ok ? res.data : null, error: res.ok ? null : res.error, status: res.status, headers: res.headers, at: Date.now(), net: false, done: true });
      if (live) force();
    }, (e) => {
      if (!(e instanceof NetError)) console.error(e);
      cache.set(ckey, { ...(cache.get(ckey) || {}), loading: false, net: true, done: true });
      if (live) force();
    });
    return () => { live = false; };
  }, [ckey, enabled, rev, manual]);
  const st = (enabled && cache.get(ckey)) || {};
  return {
    data: st.data || null, error: st.error || null, status: st.status || null, headers: st.headers || {},
    at: st.at || null, net: !!st.net, loading: enabled && !st.done, busy: !!st.loading,
    refetch: () => setManual((n) => n + 1),
  };
}

// Reads several resources of one kind by ID. Returns the answers known so
// far, in the order of the IDs.
export function useMany(op, base, param, ids) {
  const rev = useSyncExternalStore(app.subscribe, () => app.get().rev);
  const token = useSyncExternalStore(app.subscribe, () => app.get().token);
  const boot = useSyncExternalStore(app.subscribe, () => app.get().boot);
  const [, force] = useReducer((x) => x + 1, 0);
  const bkey = JSON.stringify(base);
  const ck = (id) => `${boot}|${token}|${op}|${JSON.stringify({ ...JSON.parse(bkey), [param]: id })}`;
  const idsKey = ids.join(',');
  useEffect(() => {
    let live = true;
    ids.forEach((id) => {
      const key = ck(id);
      api(op, { params: { ...JSON.parse(bkey), [param]: id } }).then((res) => {
        cache.set(key, { loading: false, data: res.ok ? res.data : null, error: res.ok ? null : res.error, status: res.status, headers: res.headers, at: Date.now(), net: false, done: true });
        if (live) force();
      }, () => { if (live) force(); });
    });
    return () => { live = false; };
  }, [op, bkey, param, idsKey, rev, token, boot]);
  return ids.map((id) => { const st = cache.get(ck(id)); return st && st.data ? st.data : null; });
}

// Loads every result ID of one case the server knows (another browser, an
// earlier visit), so the screens can follow them like the ones made here.
export function useLedger(caseId) {
  const boot = useSyncExternalStore(app.subscribe, () => app.get().boot);
  useEffect(() => {
    if (!caseId) return;
    api('getCaseLedger', { params: { case_id: caseId } }).then(() => kick(), () => {});
  }, [caseId, boot]);
}

// ---------------------------------------------------------------- job watcher
let timer = null;
let running = false;
let stopped = false;
const BASE = FAST ? 150 : 2500;

function label(kind, status) {
  const word = { COMPLETED: '끝났습니다', PARTIAL: '부분 결과로 끝났습니다', FAILED: '실패했습니다', BLOCKED: '차단되었습니다' }[status] || '끝났습니다';
  return `${JOB[kind].label}: ${word}`;
}
// where a finished job's actual result lives on the case page
export function resultRoute(kind, caseId, d) {
  const done = d.status === 'COMPLETED' || d.status === 'PARTIAL';
  if (kind === 'review') return done ? { caseId, to: 'sec-review', view: { kind: 'review', id: d.id }, sub: 'sheet' } : { caseId, to: 'sec-review' };
  if (kind === 'reassessment') return d.delta_id ? { caseId, to: 'sec-compare', deltaId: d.delta_id } : { caseId, to: 'sec-reassess' };
  if (kind === 'search') return { caseId, to: 'sec-search', searchId: d.id, reveal: { kind: 'search', id: d.id } };
  if (kind === 'export') return { caseId, to: 'sec-report', reveal: { kind: 'export', id: d.id } };
  if (kind === 'brief') return { caseId, to: 'sec-review', view: { kind: 'brief', id: d.id }, sub: 'brief' };
  return { caseId, to: 'sec-evidence' };
}

export function stopWatcher() { stopped = true; clearTimeout(timer); }

export async function pollNow(manual) {
  if (running || stopped) return;
  if (!app.get().token) { timer = setTimeout(pollNow, BASE); return; }
  if (typeof document !== 'undefined' && document.hidden && !manual) {
    if (!app.get().watch.paused) app.set((s) => ({ watch: { ...s.watch, paused: true } }));
    timer = setTimeout(pollNow, BASE);
    return;
  }
  running = true;
  const s0 = app.get();
  const boot0 = s0.boot;
  const work = [];
  for (const [caseId, led] of Object.entries(s0.ledger)) {
    for (const kind of Object.keys(JOB)) {
      for (const id of led[kind]) {
        const j = s0.jobs[id];
        if (!j || !j.data || ACTIVE.has(j.data.status)) work.push({ caseId, kind, id, was: j && j.data ? j.data.status : null, gone: j && j.gone });
      }
    }
  }
  let failed = false;
  let problem = null;
  const finished = [];
  for (const w of work) {
    if (w.gone) continue;
    try {
      const res = await api(JOB[w.kind].op, { params: { case_id: w.caseId, [JOB[w.kind].param]: w.id } });
      if (res.ok) {
        if (w.was && ACTIVE.has(w.was) && !ACTIVE.has(res.data.status)) finished.push({ ...w, data: res.data });
      } else {
        problem = res.error;
        if (res.status === 404) app.set((s) => ({ jobs: { ...s.jobs, [w.id]: { kind: w.kind, caseId: w.caseId, data: null, checkedAt: Date.now(), gone: true } } }));
        else { failed = true; break; }
      }
    } catch (e) { failed = true; break; }
  }
  running = false;
  // signed out or in as someone else while this round was out: drop what it found
  if (app.get().boot !== boot0) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(pollNow, BASE);
    return;
  }
  const prev = app.get().watch;
  const touched = work.some((w) => !w.gone);
  const failing = failed ? prev.failing + 1 : 0;
  const interval = failed ? Math.min(FAST ? 600 : 15000, Math.round(BASE * 1.6 ** failing)) : BASE;
  if (touched || failing !== prev.failing || prev.paused) {
    app.set({ watch: { interval, lastAt: failed ? prev.lastAt : Date.now(), triedAt: Date.now(), failing, paused: false, problem: failed ? problem : null } });
  }
  if (finished.length) {
    bump();
    finished.filter((f) => !announced.has(f.id)).forEach((f) => finishedToast(f.kind, f.caseId, f.data));
  }
  clearTimeout(timer);
  if (!stopped) timer = setTimeout(pollNow, interval);
}

export function startWatcher() {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(timer); pollNow(); } });
  pollNow();
}
export function kick() { if (stopped) return; clearTimeout(timer); timer = setTimeout(() => pollNow(true), 0); }

export async function refreshJob(kind, caseId, id) {
  try { await api(JOB[kind].op, { params: { case_id: caseId, [JOB[kind].param]: id } }); } catch (e) { /* shown by the watcher */ }
}

// ---------------------------------------------------------------- forms
// One idempotency key per intent: the same payload retried after a lost
// response keeps its key; an answered request or a changed payload gets a new one.
export function useIdem() {
  const ref = useRef({ sig: null, key: null });
  return useMemo(() => ({
    keyFor(payload) {
      const sig = JSON.stringify(payload);
      if (ref.current.sig !== sig || !ref.current.key) ref.current = { sig, key: newKey() };
      return ref.current.key;
    },
    settle() { ref.current = { sig: null, key: null }; },
  }), []);
}

// field -> reason from an API error
export function fieldErrors(error) {
  const out = {};
  if (error && error.details) for (const d of error.details) if (!out[d.field]) out[d.field] = d.reason;
  return out;
}

// One write action of a form: busy state, API error, transport failure, and
// the idempotency key that survives a lost response.
export function useAction() {
  const idem = useIdem();
  const [st, setSt] = useState({ busy: false, error: null, status: null, net: null, reused: false, ok: false });
  const run = useCallback(async (op, { params, body, ifMatch, onOk } = {}) => {
    setSt({ busy: true, error: null, status: null, net: null, reused: false, ok: false });
    try {
      const write = methodOf(op) !== 'GET';
      const res = await api(op, { params, body, ifMatch, key: write ? idem.keyFor({ op, params, body }) : undefined });
      idem.settle();
      if (res.ok) {
        setSt({ busy: false, error: null, status: res.status, net: null, reused: !!(res.data && res.data.reused), ok: true });
        bump();
        kick();
        if (onOk) onOk(res);
      } else setSt({ busy: false, error: res.error, status: res.status, net: null, reused: false, ok: false });
      return res;
    } catch (e) {
      if (!(e instanceof NetError)) { setSt({ busy: false, error: null, status: null, net: null, reused: false, ok: false }); throw e; }
      setSt({ busy: false, error: null, status: null, net: { lost: e.lost }, reused: false, ok: false });
      return null;
    }
  }, [idem]);
  const reset = useCallback(() => setSt({ busy: false, error: null, status: null, net: null, reused: false, ok: false }), []);
  return { ...st, run, reset };
}
