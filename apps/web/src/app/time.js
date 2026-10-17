// Times are shown in the viewer's own time zone and sent to the server as
// ISO 8601 with an explicit offset.
const pad = (n) => String(n).padStart(2, '0');

function zoneLabel(offsetMinutes) {
  if (offsetMinutes === 540) return 'KST';
  if (offsetMinutes === 0) return 'UTC';
  const a = Math.abs(offsetMinutes);
  return `UTC${offsetMinutes < 0 ? '-' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${pad(a % 60)}` : ''}`;
}
function offsetString(offsetMinutes) {
  const a = Math.abs(offsetMinutes);
  return `${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// "2026.09.30 18:00 KST"
export function when(isoString, { seconds = false, zone = true } = {}) {
  if (!isoString) return '없음';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  const s = seconds ? `:${pad(d.getSeconds())}` : '';
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${s}${zone ? ` ${zoneLabel(-d.getTimezoneOffset())}` : ''}`;
}
// "10.02 18:00"
export function whenShort(isoString) {
  if (!isoString) return '없음';
  const d = new Date(isoString);
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// wall-clock time of a real moment (polling), "18:00:03"
export function clockTime(ms) {
  if (!ms) return '없음';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// ISO instant -> value of <input type="datetime-local"> in the viewer's zone
export function toLocalInput(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// value of <input type="datetime-local"> -> ISO 8601 with the viewer's offset
export function fromLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const body = value.length === 16 ? `${value}:00` : value;
  return `${body}${offsetString(-d.getTimezoneOffset())}`;
}
export const count = (s) => Array.from(s || '').length;
export const short = (id) => (id ? String(id).slice(0, 8) : '없음');
export function won(n) {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}
export function bytes(n) {
  if (n === null || n === undefined) return '없음';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
