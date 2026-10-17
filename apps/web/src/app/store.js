// One small external store for the whole page. React reads it through
// useSyncExternalStore; selectors must return an existing reference or a
// primitive so an unchanged store never causes a render.
/* global React */

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
  return React.useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

export const FAST = typeof window !== 'undefined' && !!window.__AL_FAST__;

const TOKEN_KEY = 'audience-lab.token';
function readToken() {
  try { return window.localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
}
export function saveToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* private window: the session lasts for this tab */ }
  // a new sign-in starts clean: nothing followed or announced for the previous account carries over
  app.set({ token, ws: null, ledger: {}, jobs: {}, toasts: [], panel: null, boot: app.get().boot + 1 });
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
  page: null,                   // 'members' | 'account' | null
  route: { caseId: null, tab: 'review', sub: 'sheet', view: null, taskId: null, deltaId: null, searchId: null, creatingTask: false },
  panel: null,                  // source panel context
  ledger: {},                   // case id -> ledger
  jobs: {},                     // resource id -> { kind, caseId, data, checkedAt, failed }
  watch: { interval: FAST ? 150 : 2500, lastAt: null, failing: 0, paused: false },
  rev: 0,                       // bump to make every screen read again
  toasts: [],
  taskDraft: { assertion_ids: [], conflict_ids: [], unknown_ids: [] },
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
export function toast(text, action) {
  const id = ++toastSeq;
  app.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action }] }));
  setTimeout(() => app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), FAST ? 1500 : 9000);
}
export const dismissToast = (id) => app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

// route.reveal names what the destination screen should bring into view:
// { kind: 'screen' } for the screen itself, { kind, id } for one result on it,
// with soft: true when the person stays where they are and only needs to see
// the new row. It lasts for one navigation; any later step drops it.
export function go(patch) {
  // leaving a screen closes the source panel that belonged to it
  app.set((s) => ({ route: { ...s.route, reveal: null, ...patch }, ...(patch.tab && patch.tab !== s.route.tab ? { panel: null } : {}) }));
}
export function openCase(caseId, tab = 'review') {
  app.set({ page: null, route: { caseId, tab, sub: 'sheet', view: null, taskId: null, deltaId: null, searchId: null, creatingTask: false }, panel: null, taskDraft: { assertion_ids: [], conflict_ids: [], unknown_ids: [] } });
}
export function openPage(page) {
  app.set((s) => ({ page, panel: null, route: { ...s.route, caseId: null } }));
}

// Follow a link to a result, switching the open case when needed. The
// destination is always brought into view: the result itself when the link
// names one, otherwise the top of its screen.
export function navigate(patch) {
  const s = app.get();
  if (patch.caseId && patch.caseId !== s.route.caseId) openCase(patch.caseId, patch.tab || 'review');
  app.set((st) => ({
    route: { ...st.route, ...patch, reveal: patch.reveal || { kind: 'screen' } },
    ...(patch.tab && patch.tab !== st.route.tab ? { panel: null } : {}),
  }));
}

// The source panel remembers which control opened it so focus can go back.
let opener = null;
let panelSeq = 0;
export function openPanel(ctx) {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el || !el.closest || !el.closest('.panel')) opener = el;   // the control outside the panel that asked for it
  panelSeq += 1;
  app.set({ panel: { ...ctx, token: panelSeq } });
}
export function closePanel() {
  if (!app.get().panel) return;
  app.set({ panel: null });
  const el = opener;
  opener = null;
  if (el && el.focus) setTimeout(() => { if (document.contains(el)) el.focus(); }, 0);
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
const isoNow = (tick) => new Date(Math.floor((Date.now() + app.get().clockOffset) / 1000) * 1000 + 0 * tick).toISOString().replace(/\.\d{3}Z$/, 'Z');
if (typeof window !== 'undefined') setInterval(() => app.set((s) => ({ clockTick: s.clockTick + 1 })), 15000);
export const useNow = () => {
  const tick = useStore(app, (s) => s.clockTick);
  const offset = useStore(app, (s) => s.clockOffset);
  return React.useMemo(() => isoNow(tick), [tick, offset]);
};
export const nowIso = () => isoNow(0);
