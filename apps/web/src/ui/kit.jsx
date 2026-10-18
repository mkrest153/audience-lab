// Shared pieces of the product screens, in the MarketView (Toss-style) look:
// white rounded cards on a light gray page, one blue accent, Korean labels
// first. Identifiers, hashes and contract codes live behind '자세히'.
import { useState, useRef, useEffect, createContext, useContext, Fragment } from 'react';
import { ChevronRight, ChevronDown, LoaderCircle, Info, CircleCheck, TriangleAlert, CircleAlert, X, FlaskConical, Inbox, Copy, Check, RotateCcw } from 'lucide-react';
import * as L from '../labels.js';
import { app, useStore, dismissToast, navigate, useNow, nowIso } from '../app/store.js';
import { clockTime, toLocalInput, fromLocalInput, when } from '../app/time.js';
import { isDemoTitle } from '../app/demo.js';

export const cx = (...a) => a.filter(Boolean).join(' ');

// ---------------------------------------------------------------- who is here
export const MeContext = createContext(null);
export const useMe = () => useContext(MeContext);
export const canWrite = (me) => !!me && (me.role === 'EDITOR' || me.role === 'ADMIN');
export const ROLE = { VIEWER: '열람', EDITOR: '편집', ADMIN: '관리' };
// demo material is offered only where it can be used: demo accounts and demo cases
export function useDemo(c) {
  const me = useMe();
  const led = useStore(app, (s) => (c ? s.ledger[c.id] : null));
  return !!((me && me.demo_only) || (led && led.demo) || (c && isDemoTitle(c.title)));
}

// ---------------------------------------------------------------- buttons
const BTN = {
  primary: 'bg-brand text-white hover:bg-brand-press disabled:bg-g300',
  second: 'border border-g200 bg-white text-g700 hover:border-brand hover:text-brand disabled:text-g400 disabled:hover:border-g200',
  ghost: 'text-g600 hover:bg-g100 hover:text-g800 disabled:text-g300 disabled:hover:bg-transparent',
  soft: 'bg-brand-bg text-brand hover:bg-[#d8eaff] disabled:bg-g100 disabled:text-g400',
  danger: 'border border-g200 bg-white text-negative-ink hover:border-negative hover:bg-negative-bg',
};
const SIZE = {
  sm: 'gap-1 rounded-lg px-2.5 py-1.5 text-xs',
  md: 'gap-1.5 rounded-xl px-3.5 py-2 text-sm',
  lg: 'gap-2 rounded-xl px-5 py-3 text-sm',
  block: 'w-full gap-2 rounded-xl px-4 py-3.5 text-[15px]',
};
export function Btn({ kind = 'second', size = 'md', busy, disabled, icon: Icon, children, className, ...rest }) {
  return (
    <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={cx('inline-flex shrink-0 items-center justify-center font-semibold transition disabled:cursor-not-allowed', BTN[kind], SIZE[size], className)}>
      {busy ? <LoaderCircle className={size === 'sm' ? 'size-3.5 animate-spin' : 'size-4 animate-spin'} aria-hidden="true" />
        : Icon ? <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
// a text link that is a button
export function LinkBtn({ children, className, tone = 'brand', ...rest }) {
  return (
    <button type="button" {...rest} className={cx('inline-flex items-center gap-1 rounded text-sm font-semibold hover:underline disabled:cursor-not-allowed disabled:text-g300 disabled:no-underline',
      tone === 'brand' ? 'text-brand' : 'text-g500 hover:text-g700', className)}>{children}</button>
  );
}

// ---------------------------------------------------------------- layout
export function Card({ title, icon: Icon, right, children, className, pad = 'p-5', id, sub }) {
  return (
    <div id={id} className={cx('rounded-2xl border border-g200 bg-white shadow-sm', pad, className)}>
      {title ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-g900">{Icon ? <Icon className="size-4 text-g500" aria-hidden="true" /> : null}{title}</h3>
            {sub ? <p className="mt-0.5 text-xs text-g500">{sub}</p> : null}
          </div>
          {right ? <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// A card that folds. It opens itself when the page jumps to it (route.to).
export function Fold({ id, title, icon: Icon, sub, badge, defaultOpen = false, children, onOpen }) {
  const to = useStore(app, (s) => s.route.to);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (to && to.id === id && !open) { setOpen(true); if (onOpen) onOpen(); } }, [to && to.seq]);
  const toggle = () => { setOpen(!open); if (!open && onOpen) onOpen(); };
  return (
    <div id={id} className="scroll-mt-28 rounded-2xl border border-g200 bg-white shadow-sm">
      <button type="button" data-jump-focus aria-expanded={open} aria-controls={`${id}-body`} onClick={toggle} className="flex w-full flex-wrap items-center gap-3 rounded-2xl px-5 py-4 text-left">
        {Icon ? <Icon className="size-5 shrink-0 text-g500" aria-hidden="true" /> : null}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-g900">{title}{badge ? <span className="ml-2 align-middle">{badge}</span> : null}</span>
          {sub ? <span className="mt-0.5 block text-xs text-g500">{sub}</span> : null}
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-g500">{open ? '접기' : '펼치기'}<ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" /></span>
      </button>
      {open ? <div id={`${id}-body`} className="border-t border-g100 p-5">{children}</div> : null}
    </div>
  );
}

// One step of the case page. The heading takes focus when the stepper jumps here.
export function Section({ id, n, title, desc, right, locked, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28">
      <div className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-brand">{n}단계</p>
          <h2 id={`${id}-h`} tabIndex={-1} className="mt-0.5 text-xl font-bold tracking-tight text-g900 focus:outline-none">{title}</h2>
          {desc ? <p className="mt-1 text-sm text-g500">{desc}</p> : null}
        </div>
        {right && !locked ? <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div> : null}
      </div>
      {locked
        ? <div className="rounded-2xl border border-dashed border-g300 bg-white/60 px-5 py-4 text-sm text-g500">{locked}</div>
        : <div className="space-y-4">{children}</div>}
    </section>
  );
}

export function PageHead({ pill, icon: Icon, title, desc, right }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        {pill ? <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-bg px-3 py-1 text-xs font-semibold text-brand">{Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}{pill}</span> : null}
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-g900">{title}</h1>
        {desc ? <p className="mt-1 text-sm text-g600">{desc}</p> : null}
      </div>
      {right ? <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- notices
const NOTE = {
  info: ['bg-brand-bg', 'text-brand', Info],
  ok: ['bg-positive-bg', 'text-positive-ink', CircleCheck],
  warn: ['bg-warning-bg', 'text-warning-ink', TriangleAlert],
  bad: ['bg-negative-bg', 'text-negative-ink', CircleAlert],
  mute: ['bg-g100', 'text-g500', Info],
  demo: ['border border-example-border bg-example-bg', 'text-example', FlaskConical],
};
export function Notice({ tone = 'info', title, children, role, className, action }) {
  const [bg, ink, Icon] = NOTE[tone] || NOTE.info;
  return (
    <div role={role} className={cx('flex gap-2.5 rounded-xl px-4 py-3 text-sm', bg, className)}>
      <Icon className={cx('mt-0.5 size-4 shrink-0', ink)} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-g700">
        {title ? <p className={cx('font-semibold', tone === 'demo' ? 'text-example' : 'text-g900')}>{title}</p> : null}
        {children ? <div className={cx(title && 'mt-0.5', 'space-y-1 leading-relaxed', tone === 'demo' && 'text-example')}>{children}</div> : null}
        {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

// "다음 액션" callout
export function NextAction({ label = '다음 할 일', children, action }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-brand-bg px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 text-g800"><b className="text-brand">{label}</b> · {children}</p>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- hidden detail
export function More({ label = '자세히', children, className, open, onToggle }) {
  return (
    <details className={cx('group min-w-0 max-w-full open:basis-full', className)} open={open} onToggle={onToggle}>
      <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded text-xs font-medium text-g500 hover:text-g700">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />{label}
      </summary>
      <div className="mt-2 min-w-0 overflow-x-auto rounded-xl bg-g50 p-3 text-xs leading-relaxed text-g600">{children}</div>
    </details>
  );
}
export function KV({ rows, className }) {
  return (
    <dl className={cx('grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1', className)}>
      {rows.filter(Boolean).map(([k, v]) => <Fragment key={k}><dt className="text-g500">{k}</dt><dd className="min-w-0 break-all text-g700">{v}</dd></Fragment>)}
    </dl>
  );
}
export const Code = ({ children }) => <code className="num break-all text-[11px] text-g700">{children}</code>;
export const IdLine = ({ v }) => (v ? <Code>{v}</Code> : <span className="text-g400">없음</span>);

// ---------------------------------------------------------------- small marks
export function Tag({ children, tone = 'mute', className }) {
  const t = {
    mute: 'bg-g100 text-g600', brand: 'bg-brand-bg text-brand', pos: 'bg-positive-bg text-positive-ink', warn: 'bg-warning-bg text-warning-ink',
    neg: 'bg-negative-bg text-negative-ink', demo: 'bg-example-bg text-example ring-1 ring-inset ring-example-border', line: 'bg-white text-g600 ring-1 ring-inset ring-g200',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', t, className)}>{children}</span>;
}
// labels on Brief items; the synthetic ones keep their own look
const SYN = new Set(['SYNTHETIC_INTERPRETATION', 'NOT_FACT', 'NOT_AUDIENCE_PREDICTION', 'EDITORIAL_ACTION']);
export function Labels({ items }) {
  return <span className="inline-flex flex-wrap gap-1">{items.map((x) => <Tag key={x} tone={SYN.has(x) ? 'demo' : 'line'}>{L.LABEL[x] || x}</Tag>)}</span>;
}
const AV = ['bg-brand', 'bg-violet', 'bg-positive', 'bg-warning', 'bg-pink'];
export function Avatar({ name, size = 'md' }) {
  const n = [...(name || '?')];
  const hue = n.reduce((a, ch) => a + ch.codePointAt(0), 0) % AV.length;
  return <span aria-hidden="true" className={cx('grid shrink-0 place-items-center rounded-xl font-bold text-white', AV[hue], size === 'sm' ? 'size-7 text-xs' : 'size-9 text-sm')}>{n[0]}</span>;
}
export function Count({ n }) {
  return <span className="num ml-1 rounded-md bg-g100 px-1.5 py-0.5 text-[11px] font-semibold text-g600">{n}</span>;
}
export function Dot({ className }) {
  return <span aria-hidden="true" className={cx('inline-block size-2 shrink-0 rounded-full', className)} />;
}

// ---------------------------------------------------------------- forms
export const inputCls = 'block w-full rounded-xl border border-g200 bg-white px-3.5 py-2.5 text-[15px] text-g900 placeholder:text-g400 transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 read-only:bg-g50 read-only:text-g600 disabled:cursor-not-allowed disabled:bg-g50 disabled:text-g400 aria-[invalid=true]:border-negative';
export const areaCls = `${inputCls} leading-7`;

export function Field({ id, label, hint, error, count, max, required, children, className, aside }) {
  return (
    <div className={cx('min-w-0', className)}>
      {label ? (
        <div className="mb-1.5 flex items-center gap-2">
          <label htmlFor={id} className="flex items-center gap-1.5 text-sm text-g600">{label}{required ? <span className="text-[11px] font-semibold text-brand">필수</span> : null}</label>
          {aside ? <div className="ml-auto">{aside}</div> : null}
        </div>
      ) : null}
      {children}
      {error || hint || max ? (
        <div className="mt-1.5 flex items-start justify-between gap-3">
          {error ? <p className="text-xs text-negative-ink" role="alert">{error}</p> : <p className="text-xs leading-relaxed text-g500">{hint || ''}</p>}
          {max ? <span className={cx('num shrink-0 text-[11px]', count > max ? 'text-negative-ink' : 'text-g400')}>{count.toLocaleString('ko-KR')} / {max.toLocaleString('ko-KR')}자</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Select({ id, value, onChange, children, disabled, className, label, small }) {
  return (
    <div className={cx('relative min-w-0', className)}>
      <select id={id} value={value} onChange={onChange} disabled={disabled} aria-label={label}
        className={cx('block w-full appearance-none truncate border border-g200 bg-white text-g900 transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-g50 disabled:text-g400',
          small ? 'rounded-lg py-1.5 pl-3 pr-8 text-sm' : 'rounded-xl py-2.5 pl-3.5 pr-9 text-[15px]')}>
        {children}
      </select>
      <ChevronDown className={cx('pointer-events-none absolute top-1/2 -translate-y-1/2 text-g400', small ? 'right-2.5 size-3.5' : 'right-3 size-4')} aria-hidden="true" />
    </div>
  );
}

// checkbox or radio drawn as a card
export function Choice({ type = 'checkbox', id, name, checked, onChange, disabled, title, desc, children, className, compact }) {
  return (
    <label htmlFor={id} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border transition',
      compact ? 'px-3 py-2.5' : 'p-3.5',
      checked ? 'border-brand bg-brand-bg/50' : 'border-g200 bg-white hover:border-g300',
      disabled && 'cursor-not-allowed opacity-60', className)}>
      <input id={id} name={name} type={type} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-brand" />
      <span className="min-w-0 flex-1">
        {title ? <span className="block text-sm font-semibold text-g900">{title}</span> : null}
        {desc ? <span className="mt-0.5 block text-xs leading-relaxed text-g500">{desc}</span> : null}
        {children}
      </span>
    </label>
  );
}

export function Check2({ id, checked, onChange, disabled, children }) {
  return (
    <label htmlFor={id} className={cx('flex cursor-pointer items-start gap-2 text-sm text-g700', disabled && 'cursor-not-allowed opacity-60')}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-brand" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

// arrow keys move along a row of choices (tabs, radio groups)
function useRoving(items, value, onChange) {
  const refs = useRef({});
  const onKey = (e, i) => {
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    if (j < 0) return;
    e.preventDefault();
    onChange(items[j].id);
    const el = refs.current[items[j].id];
    if (el) el.focus();
  };
  return { refs, onKey };
}

// segmented choice ("직접 입력 | 텍스트 붙여넣기")
export function Segmented({ items, value, onChange, label, disabled, id }) {
  const { refs, onKey } = useRoving(items, value, onChange);
  return (
    <div role="radiogroup" aria-label={label} id={id} className="inline-flex flex-wrap gap-1">
      {items.map((it, i) => {
        const on = value === it.id;
        const Icon = it.icon;
        return (
          <button key={it.id} ref={(el) => { refs.current[it.id] = el; }} type="button" role="radio" aria-checked={on} id={`${id}-${it.id}`}
            tabIndex={on ? 0 : -1} disabled={disabled} onClick={() => onChange(it.id)} onKeyDown={(e) => onKey(e, i)}
            className={cx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed',
              on ? 'bg-brand text-white' : 'text-g600 hover:bg-g100', disabled && !on && 'text-g300')}>
            {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}{it.label}
          </button>
        );
      })}
    </div>
  );
}

// pill tabs (MarketView result hub)
export function PillTabs({ items, value, onChange, label, prefix = 'tab' }) {
  const { refs, onKey } = useRoving(items, value, onChange);
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((t, i) => {
        const on = value === t.id;
        const Icon = t.icon;
        return (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" type="button" id={`${prefix}-${t.id}`} aria-selected={on}
            aria-controls={`${prefix}-panel`} tabIndex={on ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
            className={cx('inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
              on ? 'border-brand bg-brand-bg text-brand' : 'border-g200 bg-white text-g600 hover:border-g300 hover:text-g800')}>
            {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}{t.label}
            {t.badge !== undefined && t.badge !== null ? <span className={cx('num text-xs', on ? 'text-brand' : 'text-g400')}>{t.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- loading and errors
export function Loading({ what = '내용' }) {
  return <p className="flex items-center gap-2 py-2 text-sm text-g500" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{what}을 불러오는 중입니다.</p>;
}
export function Empty({ children, icon: Icon = Inbox, action }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-g50 px-4 py-3 text-sm text-g500">
      <Icon className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1">{children || '해당 항목 없음'}</span>{action}
    </div>
  );
}

export function ApiError({ error, status, title }) {
  if (!error) return null;
  const hint = L.ERROR_HINT[error.code];
  return (
    <Notice tone="bad" role="alert" title={title || '요청을 처리하지 못했습니다'}>
      <p>{error.message}</p>
      {error.details && error.details.length ? (
        <ul className="list-disc pl-4">{error.details.filter((d) => d.reason && d.reason !== error.message).map((d, i) => <li key={i}>{d.reason}</li>)}</ul>
      ) : null}
      {hint ? <p className="text-g600">{hint}</p> : null}
      <More className="pt-1">
        <KV rows={[['응답', <Code key="s">{`${status || ''} ${error.code}`}</Code>], ['추적 번호', <IdLine key="c" v={error.correlation_id} />],
          ...(error.details || []).map((d, i) => [`항목 ${i + 1}`, <Code key={i}>{d.field}</Code>])]} />
      </More>
    </Notice>
  );
}

export function NetNote({ at, onRetry, lost }) {
  return (
    <Notice tone="warn" role="alert" title="서버 응답을 받지 못했습니다" action={onRetry ? <Btn size="sm" icon={RotateCcw} onClick={onRetry}>다시 확인</Btn> : null}>
      <p>
        {lost
          ? '요청은 서버에 닿았을 수 있습니다. 같은 내용으로 다시 보내면 같은 요청 키를 써서, 이미 만들어졌다면 그 결과를 그대로 받습니다.'
          : '작업 상태가 바뀐 것은 아닙니다. 화면에는 마지막으로 확인한 내용을 그대로 둡니다.'}
        {at ? ` 마지막 확인 ${clockTime(at)}.` : ''}
      </p>
    </Notice>
  );
}

// first load, API error, or a transport failure over the last good answer
export function QueryState({ q, what }) {
  if (q.loading) return <Loading what={what} />;
  return (
    <>
      {q.net ? <NetNote at={q.at} onRetry={q.refetch} /> : null}
      {q.error ? <ApiError error={q.error} status={q.status} /> : null}
    </>
  );
}

export function Warnings({ items }) {
  if (!items || !items.length) return null;
  return (
    <div className="rounded-xl bg-warning-bg px-4 py-3 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-warning-ink"><TriangleAlert className="size-4" aria-hidden="true" />알아 둘 점 {items.length}건</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-g700">{items.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
      <More className="mt-1.5" label="경고 코드"><span className="flex flex-wrap gap-1.5">{items.map((w, i) => <Code key={i}>{w.code}</Code>)}</span></More>
    </div>
  );
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
  if (a.reused) return <Notice tone="info" role="status">같은 요청을 이미 받은 적이 있어, 새로 만들지 않고 그때의 결과를 돌려받았습니다.</Notice>;
  return null;
}

// ---------------------------------------------------------------- time fields
// A date-time input in the viewer's zone. Until the viewer edits it, it follows
// the current time; the server always gets an explicit offset.
export function useClockField() {
  const now = useNow();
  const [v, setV] = useState(null);
  const value = v === null ? (now ? toLocalInput(now) : '') : v;
  return { value, set: setV, iso: v === null ? now : fromLocalInput(value), following: v === null, fresh: () => (v === null ? nowIso() : fromLocalInput(value)), reset: () => setV(null) };
}
export function TimeField({ id, label, field, error, hint, required, readOnly }) {
  return (
    <Field id={id} label={label} error={error} required={required}
      hint={field.following ? `${hint ? `${hint} ` : ''}지금 시각을 따라갑니다.` : hint}
      aside={!field.following && !readOnly ? <LinkBtn className="text-xs" onClick={field.reset}>지금 시각으로</LinkBtn> : null}>
      <input id={id} type="datetime-local" className={inputCls} value={field.value} readOnly={readOnly} onChange={(e) => field.set(e.target.value)} aria-invalid={!!error} title={field.iso || ''} />
    </Field>
  );
}
export const whenOr = (iso) => (iso ? when(iso) : '없음');
// the latest of several instants; a time that follows the clock is moved up to
// the newest material the server has stamped, so it is never earlier than it
export const laterIso = (...xs) => xs.filter(Boolean).reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));

// ---------------------------------------------------------------- reveal on arrival
// Brings one result into view when a link named it (route.reveal). A link
// followed on purpose also moves focus there; a row that merely appeared after
// the person's own request is only scrolled to.
export function useReveal(kind, id, block = 'center') {
  const reveal = useStore(app, (s) => s.route.reveal);
  const ref = useRef(null);
  const hit = reveal && reveal.kind === kind && reveal.id === id ? reveal : null;
  useEffect(() => {
    const el = ref.current;
    if (!hit || !el) return undefined;
    const place = () => el.scrollIntoView({ block: hit.soft ? 'nearest' : block });
    place();
    if (!hit.soft) el.focus({ preventScroll: true });
    let live = true;
    const stop = () => { live = false; };
    const taken = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    taken.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    const timers = [250, 600, 1200].map((ms) => setTimeout(() => { if (live && document.contains(el)) place(); }, ms));
    return () => { live = false; timers.forEach(clearTimeout); taken.forEach((e) => window.removeEventListener(e, stop)); };
  }, [hit]);
  return [ref, hit];
}

// ---------------------------------------------------------------- toasts
export function Toasts() {
  const toasts = useStore(app, (s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl bg-g900 py-2.5 pl-4 pr-2 text-sm text-white shadow-lg">
          {t.tone === 'ok' ? <CircleCheck className="size-4 shrink-0 text-positive" aria-hidden="true" /> : t.tone === 'bad' ? <CircleAlert className="size-4 shrink-0 text-negative" aria-hidden="true" /> : <Info className="size-4 shrink-0 text-brand-bg" aria-hidden="true" />}
          <span className="min-w-0">{t.text}</span>
          {t.action ? <button type="button" className="shrink-0 rounded-lg px-2 py-1 font-semibold text-[#8ab8ff] hover:bg-white/10" onClick={() => { navigate(t.action.route); dismissToast(t.id); }}>{t.action.label}</button> : null}
          <button type="button" className="shrink-0 rounded-lg p-1 text-g400 hover:bg-white/10 hover:text-white" onClick={() => dismissToast(t.id)} aria-label="알림 닫기"><X className="size-4" aria-hidden="true" /></button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- modal
export function Modal({ title, onClose, children, labelledBy = 'modal-title', wide }) {
  const box = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const first = box.current && box.current.querySelector('input, button, select, textarea');
    if (first) first.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && box.current) {
        const f = [...box.current.querySelectorAll('button, input, select, textarea, a[href]')].filter((x) => !x.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => { root.style.overflow = was; document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-g900/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={cx('w-full rounded-2xl bg-white p-6 shadow-xl', wide ? 'max-w-lg' : 'max-w-md')}>
        <div className="mb-4 flex items-center gap-2">
          <h2 id={labelledBy} className="text-lg font-bold text-g900">{title}</h2>
          <button type="button" className="ml-auto rounded-lg p-1.5 text-g500 hover:bg-g100" onClick={onClose} aria-label="닫기"><X className="size-5" aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CopyBtn({ value, label = '복사' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000); } catch (e) { setDone(false); }
  };
  return <Btn size="sm" icon={done ? Check : Copy} onClick={copy}>{done ? '복사함' : label}</Btn>;
}

export const labelOr = (map, code) => (map && map[code]) || code;

// Korean particle after a word: josa('검토', '이', '가') -> '가'
export function josa(word, withFinal, withoutFinal) {
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return withFinal;
  return code % 28 ? withFinal : withoutFinal;
}
