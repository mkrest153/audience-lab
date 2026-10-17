// Shared pieces of the product screens.
/* global React */
import * as L from '../labels.js';
import { app, useStore, dismissToast, navigate, useNow, nowIso } from './store.js';
import { short, clockTime, toLocalInput, fromLocalInput } from './time.js';
import { isDemoTitle } from './demo.js';

const { useState, useRef, useEffect } = React;

export const cx = (...a) => a.filter(Boolean).join(' ');

// Brings one result into view when a link named it (route.reveal). A link
// followed on purpose also moves focus there; a row that merely appeared after
// the person's own request is only scrolled to. Content above may still be
// loading, so the place is kept for a moment unless the person takes over.
export function useReveal(kind, id, block = 'center', room = 0) {
  const reveal = useStore(app, (s) => s.route.reveal);
  const ref = useRef(null);
  const hit = reveal && reveal.kind === kind && reveal.id === id ? reveal : null;
  useEffect(() => {
    const el = ref.current;
    if (!hit || !el) return undefined;
    const place = () => {
      el.scrollIntoView({ block: hit.soft ? 'nearest' : block });
      if (!hit.soft || !room) return;
      // leave room under a row that will grow (table rows take no scroll margin)
      const r = el.getBoundingClientRect();
      const over = r.bottom + room - window.innerHeight;
      if (over > 0) window.scrollBy(0, Math.min(over, Math.max(0, r.top - 16)));
    };
    place();
    if (!hit.soft) el.focus({ preventScroll: true });
    let live = true;
    const stop = () => { live = false; };
    const taken = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    taken.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    const timers = [200, 500, 1000].map((ms) => setTimeout(() => { if (live && document.contains(el)) place(); }, ms));
    return () => { live = false; timers.forEach(clearTimeout); taken.forEach((e) => window.removeEventListener(e, stop)); };
  }, [hit]);
  return [ref, hit];
}
export const MeContext = React.createContext(null);
export const useMe = () => React.useContext(MeContext);
export const canWrite = (me) => !!me && (me.role === 'EDITOR' || me.role === 'ADMIN');

// Every status is a text label; the small mark in front differs by shape as
// well as by colour.
const STATUS = {
  review: { map: L.REVIEW_STATUS, look: { SUPPORTED: ['ok', 'dot'], CONFLICT: ['warn', 'diamond'], CONTRADICTED: ['bad', 'cross'], INSUFFICIENT_EVIDENCE: ['mute', 'ring'], NON_FACTUAL: ['plain', 'dash'] } },
  question: { map: L.QUESTION_STATUS, look: { OPEN: ['mute', 'ring'], PARTIALLY_RESOLVED: ['half', 'half'], RESOLVED: ['ok', 'dot'], CONFLICTED: ['warn', 'diamond'] } },
  job: { map: L.JOB_STATUS, look: { QUEUED: ['plain', 'dash'], RUNNING: ['run', 'play'], COMPLETED: ['ok', 'dot'], PARTIAL: ['warn', 'half'], FAILED: ['bad', 'cross'], BLOCKED: ['bad', 'square'] } },
  task: { map: L.TASK_STATUS, look: { OPEN: ['run', 'ring'], DONE: ['ok', 'dot'], CANCELLED: ['plain', 'dash'] } },
  submission: { map: { REGISTERED: '등록됨', ACCEPTED: '근거로 반영', BLOCKED: '차단' }, look: { REGISTERED: ['plain', 'ring'], ACCEPTED: ['ok', 'dot'], BLOCKED: ['bad', 'square'] } },
};
export function St({ kind, code, small, plain }) {
  if (!code) return <span className="st tone-plain">확인 중</span>;
  const def = STATUS[kind];
  const [tone, mark] = (def.look[code]) || ['plain', 'dash'];
  return (
    <span className={cx('st', `tone-${tone}`, small && 'st-s')}>
      <i className={`mk mk-${mark}`} aria-hidden="true"></i>
      <span className="st-t">{def.map[code] || code}</span>
      {!plain && def.map[code] ? <code className="st-c">{code}</code> : null}
    </span>
  );
}

// An identifier: eight characters by default, the whole value on demand.
export function Id({ v, n = 8 }) {
  const [open, setOpen] = useState(false);
  if (!v) return <span className="id-none">없음</span>;
  return (
    <button type="button" className="id" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? v : String(v).slice(0, n)}<span className="sr"> {open ? '줄여 보기' : '전체 보기'}</span>
    </button>
  );
}

export function Pins({ items }) {
  return (
    <dl className="pins">
      {items.filter(Boolean).map((it) => (
        <div key={it.label} className="pin">
          <dt>{it.label}</dt>
          <dd>{it.id !== undefined ? <Id v={it.id} /> : it.text}{it.extra ? <span className="pin-x"> {it.extra}</span> : null}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Btn({ kind = 'second', busy, disabled, children, className, ...rest }) {
  return (
    <button type="button" {...rest} className={cx('btn', `btn-${kind}`, className)} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="spin" aria-hidden="true"></span> : null}{children}
    </button>
  );
}

export function Field({ id, label, hint, error, count, max, required, children, wide }) {
  return (
    <div className={cx('field', error && 'has-error', wide && 'field-wide')}>
      <label htmlFor={id}>{label}{required ? <span className="req">필수</span> : null}</label>
      {children}
      <div className="field-meta">
        {error ? <p className="field-error" role="alert">{error}</p> : <p className="field-hint">{hint || ''}</p>}
        {max ? <span className={cx('counter', count > max && 'over')}>{count.toLocaleString('ko-KR')} / {max.toLocaleString('ko-KR')}자</span> : null}
      </div>
    </div>
  );
}

export function ApiError({ error, status, title }) {
  if (!error) return null;
  const hint = L.ERROR_HINT[error.code];
  return (
    <div className="note tone-bad" role="alert">
      <p className="note-h">{title || '요청을 처리하지 못했습니다'} <code>{status} {error.code}</code></p>
      <p>{error.message}</p>
      {error.details && error.details.length ? (
        <ul className="plain">{error.details.map((d, i) => <li key={i}><code>{d.field}</code> {d.reason}</li>)}</ul>
      ) : null}
      {hint ? <p className="note-hint">{hint}</p> : null}
      <p className="note-foot">추적 번호 <code>{error.correlation_id || '없음'}</code></p>
    </div>
  );
}

export function NetNote({ at, onRetry, lost }) {
  return (
    <div className="note tone-warn" role="alert">
      <p className="note-h">서버 응답을 받지 못했습니다</p>
      <p>
        {lost
          ? '요청은 서버에 닿았을 수 있습니다. 같은 내용으로 다시 보내면 같은 요청 키를 써서, 이미 만들어졌다면 그 결과를 그대로 받습니다.'
          : '작업 상태가 바뀐 것은 아닙니다. 화면에는 마지막으로 확인한 내용을 그대로 둡니다.'}
        {at ? ` 마지막 확인 ${clockTime(at)}.` : ''}
      </p>
      {onRetry ? <p><Btn onClick={onRetry}>다시 확인</Btn></p> : null}
    </div>
  );
}

export function Loading({ what = '내용' }) {
  return <p className="loading" role="status">{what}을 불러오는 중입니다.</p>;
}
export function Empty({ children }) {
  return <p className="empty">{children || '해당 항목 없음'}</p>;
}

// Shows a resource the usual way: first load, API error, transport failure
// over the last good answer.
export function QueryState({ q, what }) {
  if (q.loading) return <Loading what={what} />;
  return (
    <>
      {q.net ? <NetNote at={q.at} onRetry={q.refetch} /> : null}
      {q.error ? <ApiError error={q.error} status={q.status} /> : null}
    </>
  );
}

export function Warnings({ items, compact }) {
  if (!items || !items.length) return null;
  return (
    <ul className={cx('warns', compact && 'warns-s')}>
      {items.map((w, i) => (
        <li key={i}><span className="warn-t">경고</span><span>{w.message}</span><code>{w.code}</code></li>
      ))}
    </ul>
  );
}

export function Tabs({ items, value, onChange, label, small, prefix = 'tab', id }) {
  const refs = useRef({});
  const onKey = (e, i) => {
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    if (j < 0) return;
    e.preventDefault();
    onChange(items[j].id);
    const el = refs.current[items[j].id];
    if (el) el.focus();
  };
  return (
    <div role="tablist" id={id} aria-label={label} className={cx('tabs', small && 'tabs-s')}>
      {items.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" type="button" id={`${prefix}-${t.id}`}
          aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} className={cx('tab', value === t.id && 'on')}
          onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.label}{t.badge !== undefined && t.badge !== null ? <span className="tab-b">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore(app, (s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action ? <button type="button" className="link" onClick={() => { navigate(t.action.route); dismissToast(t.id); }}>{t.action.label}</button> : null}
          <button type="button" className="link quiet" onClick={() => dismissToast(t.id)}>닫기</button>
        </div>
      ))}
    </div>
  );
}

// A demo-only helper next to a form: fills in the fictional fixture material.
// Styled apart so it is not mistaken for a product feature.
export function DemoFill({ items, label = '시연 자료', show = true }) {
  if (!show) return null;
  return (
    <div className="demofill" role="group" aria-label="시연 자료 채우기">
      <span className="demofill-l">{label}</span>
      {items.map((it) => <button key={it.label} type="button" className="demofill-b" onClick={it.run}>{it.label}</button>)}
    </div>
  );
}

export function Chips({ items }) {
  return <span className="chips">{items.map((x) => <span key={x} className={cx('chip', /^(SYNTHETIC|NOT_|EDITORIAL)/.test(x) && 'chip-syn')}>{L.LABEL[x] || x}</span>)}</span>;
}

// What a write action left behind: an API refusal, a lost response, or a note
// that the server answered an earlier identical request.
export function ActionState({ a, fields }) {
  if (a.net) return <NetNote lost={a.net.lost} />;
  if (a.error) {
    const shown = fields || [];
    const rest = (a.error.details || []).filter((d) => !shown.includes(d.field));
    return <ApiError error={{ ...a.error, details: rest }} status={a.status} />;
  }
  if (a.reused) return <p className="note tone-info" role="status">같은 요청을 이미 받은 적이 있어, 새로 만들지 않고 그때의 결과를 돌려받았습니다.</p>;
  return null;
}

// A date-time input in the viewer's zone. Until the viewer edits it, it
// follows the current time; the server always gets an explicit offset.
export function useClockField() {
  const now = useNow();
  const [v, setV] = useState(null);
  const value = v === null ? (now ? toLocalInput(now) : '') : v;
  // while it follows the clock, the value sent is the server's "now" at that moment
  return { value, set: setV, iso: v === null ? now : fromLocalInput(value), following: v === null, fresh: () => (v === null ? nowIso() : fromLocalInput(value)), reset: () => setV(null) };
}
export function TimeField({ id, label, field, error, hint, required, readOnly }) {
  return (
    <Field id={id} label={label} error={error} required={required} hint={`${hint ? `${hint} ` : ''}서버에는 시간대를 붙여 보냅니다: ${field.iso || '시각을 넣어 주세요'}`}>
      <input id={id} type="datetime-local" value={field.value} readOnly={readOnly} onChange={(e) => field.set(e.target.value)} aria-invalid={!!error} />
    </Field>
  );
}

export const labelOr = (map, code) => map[code] || code;
export { short };

// Demo material is offered only where it can be used: demo accounts and demo cases.
export function useDemo(c) {
  const me = useMe();
  const led = useStore(app, (s) => (c ? s.ledger[c.id] : null));
  return !!((me && me.demo_only) || (led && led.demo) || (c && isDemoTitle(c.title)));
}
