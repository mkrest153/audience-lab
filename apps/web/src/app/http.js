// The only way to the server: adds the Bearer token, the idempotency key and
// If-Match, and turns every answer into { ok, status, data | error, headers }.
import OPS from './ops.json';
import { app, syncClock } from './store.js';

export class NetError extends Error {
  // lost: the request may have reached the server (a write whose answer never came)
  constructor(lost) { super('network'); this.lost = lost; }
}

export const methodOf = (op) => (OPS[op] ? OPS[op].method : 'GET');
export const titleOf = (op) => (OPS[op] ? OPS[op].title : op);

export function pathOf(op, params = {}) {
  const meta = OPS[op];
  if (!meta) throw new Error(`unknown operation ${op}`);
  const ws = params.workspace_id || app.get().ws || '';
  return meta.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(k === 'workspace_id' ? ws : (params[k] ?? '')));
}

export async function send(op, { params = {}, body, key, ifMatch, token } = {}) {
  const method = methodOf(op);
  const headers = { Accept: 'application/json' };
  const tk = token === undefined ? app.get().token : token;
  if (tk) headers.Authorization = `Bearer ${tk}`;
  if (key) headers['Idempotency-Key'] = key;
  if (ifMatch) headers['If-Match'] = ifMatch;
  const init = { method, headers, credentials: 'same-origin', cache: 'no-store' };
  if (body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let r;
  try {
    r = await fetch(pathOf(op, params), init);
  } catch (e) {
    throw new NetError(method !== 'GET');
  }
  syncClock(r.headers.get('Date'));
  const correlation_id = r.headers.get('X-Correlation-Id');
  if (r.ok && op === 'downloadEditorialExport') {
    const binary = new Uint8Array(await r.arrayBuffer());
    return { ok: true, status: r.status, data: null, binary, correlation_id,
      headers: { 'Content-Type': r.headers.get('Content-Type'), 'Content-Disposition': r.headers.get('Content-Disposition') } };
  }
  let json = null;
  try { json = await r.json(); } catch (e) { json = null; }
  if (!json) {
    if (r.status >= 500 || r.status === 0) throw new NetError(method !== 'GET');
    return { ok: false, status: r.status, error: { code: 'INTERNAL_ERROR', message: '서버 응답을 읽지 못했습니다.', correlation_id }, headers: {}, correlation_id };
  }
  const res = { ok: r.ok, status: r.status, data: json.data, error: json.error, headers: { ETag: r.headers.get('ETag') }, correlation_id };
  if (!r.ok && r.status === 401 && op !== 'whoami') app.set((s) => ({ authLost: s.authLost + 1 }));
  return res;
}

// account endpoints outside the 30 operations
export async function auth(path, { method = 'POST', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  const tk = token === undefined ? app.get().token : token;
  if (tk) headers.Authorization = `Bearer ${tk}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  } catch (e) {
    throw new NetError(method !== 'GET');
  }
  let json = null;
  try { json = await r.json(); } catch (e) { json = null; }
  return { ok: r.ok, status: r.status, data: json ? json.data : null, error: json ? json.error : { code: 'INTERNAL_ERROR', message: '서버 응답을 읽지 못했습니다.' } };
}
