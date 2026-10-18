// One small external store for the whole page. React reads it through
// useSyncExternalStore; selectors must return an existing reference or a
// primitive so an unchanged store never causes a render.
import { useSyncExternalStore, useMemo } from 'react';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (!next) return;
      state = { ...state, ...next };
      subs.forEach((f) => f());
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

export function useStore(store, selector) {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

export const FAST = typeof window !== 'undefined' && !!window.__AL_FAST__;

// One case is one page read top to bottom. The route names the case, which
// result each section shows, and `to`, a section to bring into view.
export const EMPTY_ROUTE = {
  caseId: null,         // null: list of cases, 'new': a new case, or a case id
  view: null,           // { kind: 'review' | 'brief', id } shown in the review section
  sub: 'sheet',         // tab inside the review section
  taskId: null,         // task open in the task and reassessment sections
  creatingTask: false,
  taskOrigin: null,     // { kind, id } the new task points at
  taskJustMade: null,
  deltaId: null,        // comparison shown in the reassessment section
  searchId: null,       // public search shown in its card
  exportInput: null,    // { kind, id } preselected in the report section
  intakeOpen: false,    // the input form of an existing case is open
  reveal: null,         // one result to bring into view after a step
  to: null,             // { id, seq }: section to scroll to
};
const emptyDraft = () => ({ assertion_ids: [], conflict_ids: [], unknown_ids: [] });

const TOKEN_KEY = 'audience-lab.token';
function readToken() {
  try { return window.localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
}
// A new sign-in starts clean: nothing followed or announced for the previous
// account carries over. After an expired sign-in the person may keep the case
// they were reading.
export function saveToken(token, { keepRoute = false } = {}) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* private window: the session lasts for this tab */ }
  app.set((s) => ({
    token, ws: null, ledger: {}, jobs: {}, toasts: [], panel: null, modal: null, boot: s.boot + 1,
    autoOpen: true, taskDraft: emptyDraft(),
    ...(keepRoute ? {} : { page: null, route: { ...EMPTY_ROUTE } }),
  }));
}

const emptyLedger = () => ({
  execution: [], review: [], brief: [], reassessment: [], delta: [], search: [], export: [], result: [], submission: [], pack: [],
  modes: {},      // state_version_id -> intake mode
  corr: {},       // resource id -> correlation id of the request that created it
  briefByPack: {},
  demo: false,
});

export const app = createStore({
  boot: 0,                      // bump to start over (login, logout)
  token: typeof window !== 'undefined' ? readToken() : null,
  ws: null,                     // workspace of the signed-in account
  authLost: 0,                  // counts 401 answers so the shell can ask to sign in again
  page: null,                   // 'cases' | 'members' | null
  modal: null,                  // 'account' | null
  autoOpen: true,               // open the newest case once after signing in
  route: { ...EMPTY_ROUTE },
  panel: null,                  // source panel context
  ledger: {},                   // case id -> ledger
  jobs: {},                     // resource id -> { kind, caseId, data, checkedAt, failed }
  watch: { interval: FAST ? 150 : 2500, lastAt: null, failing: 0, paused: false },
  rev: 0,                       // bump to make every screen read again
  toasts: [],
  taskDraft: emptyDraft(),
  clockOffset: 0,               // server time minus this browser's time, from the Date header
  clockTick: 0,
});

export const ledgerOf = (state, caseId) => state.ledger[caseId] || emptyLedger();

export function learn(caseId, patch) {
  if (!caseId) return;
  app.set((s) => {
    const cur = ledgerOf(s, caseId);
    let changed = false;
    const next = { ...cur };
    for (const [kind, value] of Object.entries(patch)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(cur[kind])) {
        const ids = (Array.isArray(value) ? value : [value]).filter((id) => id && !cur[kind].includes(id));
        if (ids.length) { next[kind] = [...(next[kind] || cur[kind]), ...ids]; changed = true; }
      } else if (typeof cur[kind] === 'object' && cur[kind] !== null) {
        const add = Object.entries(value).filter(([k, v]) => v !== undefined && cur[kind][k] !== v);
        if (add.length) { next[kind] = { ...cur[kind], ...Object.fromEntries(add) }; changed = true; }
      } else if (cur[kind] !== value) {
        next[kind] = value; changed = true;
      }
    }
    return changed || !s.ledger[caseId] ? { ledger: { ...s.ledger, [caseId]: next } } : null;
  });
}

export const bump = () => app.set((s) => ({ rev: s.rev + 1 }));

let toastSeq = 0;
export function toast(text, action, tone = 'info') {
  const id = ++toastSeq;
  app.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action, tone }] }));
  setTimeout(() => app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), FAST ? 1500 : 9000);
}
export const dismissToast = (id) => app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

// ---------------------------------------------------------------- moving around
// route.reveal names what the destination should bring into view: { kind, id }
// for one result, with soft: true when the person stays where they are and only
// needs to see the new row. It lasts for one step; any later step drops it.
let jumpSeq = 0;
export function go(patch) {
  const { to, ...rest } = patch;
  app.set((s) => ({ route: { ...s.route, reveal: null, ...rest, ...(to ? { to: { id: to, seq: ++jumpSeq } } : {}) } }));
}
export function openCase(caseId, to) {
  app.set({
    page: null, panel: null, taskDraft: emptyDraft(), autoOpen: false,
    route: { ...EMPTY_ROUTE, caseId, ...(to ? { to: { id: to, seq: ++jumpSeq } } : {}) },
  });
  if (!to && typeof window !== 'undefined') window.scrollTo(0, 0);
}
export function openPage(page) {
  app.set((s) => ({ page, panel: null, autoOpen: false, route: { ...s.route, caseId: null } }));
  if (typeof window !== 'undefined') window.scrollTo(0, 0);
}
export const openModal = (modal) => app.set({ modal });

// Follow a link to a result (a finished job's toast), switching the open case
// when needed.
export function navigate(patch) {
  const { caseId, ...rest } = patch;
  const s = app.get();
  if (caseId && (caseId !== s.route.caseId || s.page)) openCase(caseId);
  go(rest);
}

// The source panel remembers which control opened it so focus can go back.
let opener = null;
let panelSeq = 0;
export function openPanel(ctx) {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el || !el.closest || !el.closest('[data-panel]')) opener = el;   // the control outside the panel that asked for it
  panelSeq += 1;
  app.set({ panel: { ...ctx, token: panelSeq } });
}
export function closePanel() {
  if (!app.get().panel) return;
  app.set({ panel: null });
  const el = opener;
  opener = null;
  if (el && el.focus) setTimeout(() => { if (document.contains(el)) el.focus({ preventScroll: true }); }, 0);
}

// ---------------------------------------------------------------- time
// "Now" follows the server's clock so a time picked here is never ahead of
// what the server will stamp on the material it receives.
export function syncClock(dateHeader) {
  if (!dateHeader) return;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return;
  const offset = server - Date.now();
  // the header has whole seconds; only move for a real difference
  if (Math.abs(offset - app.get().clockOffset) > 1500) app.set({ clockOffset: offset });
}
export const serverNow = () => Date.now() + app.get().clockOffset;
const isoNow = () => new Date(Math.floor((Date.now() + app.get().clockOffset) / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
if (typeof window !== 'undefined') setInterval(() => app.set((s) => ({ clockTick: s.clockTick + 1 })), 15000);
export const useNow = () => {
  const tick = useStore(app, (s) => s.clockTick);
  const offset = useStore(app, (s) => s.clockOffset);
  return useMemo(() => isoNow(), [tick, offset]);
};
export const nowIso = () => isoNow();
