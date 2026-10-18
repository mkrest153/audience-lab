// 출처 변경 알림: 알림, 정정 피드, 모니터링 정책.
import { useState } from 'react';
import { Bell } from 'lucide-react';
import * as L from '../labels.js';
import { go, bump } from '../app/store.js';
import { api, useQuery, useAction, fieldErrors, NetError } from '../app/api.js';
import { Status } from '../ui/status.jsx';
import { Fold, Btn, Field, Check2, Notice, NetNote, More, KV, IdLine, Code, Tag, Empty, QueryState, ActionState, inputCls, cx, labelOr } from '../ui/kit.jsx';
import { whenShort } from '../app/time.js';
import { claimMap } from './shared.jsx';

function Notifications({ f, feed }) {
  const [busy, setBusy] = useState(null);
  const [net, setNet] = useState(false);
  const runs = feed ? feed.runs : [];
  const target = (n) => runs.find((r) => r.changes.includes(n.change_id)) || null;
  const openNote = async (n) => {
    setBusy(n.id); setNet(false);
    try {
      if (!n.read_at) await api('markNotificationRead', { params: { case_id: f.c.id, notification_id: n.id }, body: { read: true } });
      bump();
      const r = target(n);
      if (r && r.delta_id) go({ to: 'sec-compare', deltaId: r.delta_id });
      else if (r && r.result_brief_id) go({ to: 'sec-review', view: { kind: 'brief', id: r.result_brief_id }, sub: 'brief' });
    } catch (e) {
      if (!(e instanceof NetError)) throw e;
      setNet(true);
    } finally { setBusy(null); }
  };
  if (!f.notes.length) return <Empty icon={Bell}>알림이 없습니다. 출처가 정정되어 판정이 달라지면 여기에 나타납니다.</Empty>;
  return (
    <div className="space-y-2">
      {net ? <NetNote lost /> : null}
      <ul className="space-y-2">
        {f.notes.map((n) => {
          const r = target(n);
          return (
            <li key={n.id} className={cx('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3', n.read_at ? 'border-g100' : 'border-warning/40 bg-warning-bg/40')}>
              <Tag tone="warn">{n.priority}</Tag>
              <div className="min-w-0 flex-1">
                <p className={cx('text-sm', n.read_at ? 'text-g700' : 'font-semibold text-g900')}>{n.title}</p>
                <p className="text-xs text-g500">{labelOr(L.CHANGE_TYPE, n.change_type)} · {whenShort(n.created_at)} · {n.read_at ? `읽음 ${whenShort(n.read_at)}` : '읽지 않음'}</p>
              </div>
              <Btn size="sm" busy={busy === n.id} onClick={() => openNote(n)}>{r && (r.delta_id || r.result_brief_id) ? '달라진 내용 보기' : '읽음으로 기록'}</Btn>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-g500">읽음은 사람마다 따로 기록됩니다. 알림은 이 화면 안에서만 보이며 바깥으로 메시지를 보내지 않습니다.</p>
    </div>
  );
}

function Feed({ feed, claims }) {
  if (!feed.changes.length && !feed.runs.length) return <Empty>확인된 출처 변경이 없습니다.</Empty>;
  const why = (list) => list.map((x) => x.reason).filter(Boolean).join(', ');
  return (
    <div className="space-y-3">
      {feed.changes.length ? (
        <ul className="space-y-2">
          {feed.changes.map((x) => (
            <li key={x.id} className="rounded-xl border border-g100 p-3.5 text-sm">
              <p className="flex flex-wrap items-center gap-2"><Tag tone="warn">{x.priority}</Tag><span className="font-semibold text-g900">{labelOr(L.CHANGE_TYPE, x.change_type)}</span><span className="text-xs text-g500">{whenShort(x.detected_at)}</span></p>
              {x.claim_ids.length ? <ul className="mt-2 list-disc space-y-0.5 pl-5 text-g700">{x.claim_ids.map((id) => <li key={id}>{claims[id] ? claims[id].text : '관련 근거 진술'}{claims[id] && claims[id].superseded ? ' (정정 이전 기록)' : ''}</li>)}</ul> : null}
              <More className="mt-2"><KV rows={[['출처', <IdLine key="s" v={x.source_id} />], ['원문 버전', <span key="r"><IdLine v={x.before_revision_id} /> → <IdLine v={x.after_revision_id} /></span>], ['변화 코드', <Code key="c">{x.change_type}</Code>]]} /></More>
            </li>
          ))}
        </ul>
      ) : null}
      {feed.runs.length ? (
        <div>
          <p className="mb-2 text-xs font-semibold text-g500">수집 주기 기록 {feed.runs.length}건</p>
          <ul className="space-y-2">
            {feed.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-g100 px-4 py-2.5 text-sm">
                <span className="text-xs text-g500">{whenShort(r.started_at)}</span><Status kind="job" code={r.status} />
                <span className="text-g600">다시 본 것 {r.selected.length} · 그대로 {r.unchanged.length} · 예산으로 미룸 {r.deferred.length}{r.deferred.length ? ` (${why(r.deferred) || '예산'})` : ''} · 막힘 {r.blocked.length}{r.blocked.length ? ` (${why(r.blocked) || '권한·무결성'})` : ''}</span>
                <span className="ml-auto flex gap-2">
                  {r.changes.length === 0 ? <span className="text-xs text-g400">변경 없음</span> : null}
                  {r.delta_id ? <Btn size="sm" onClick={() => go({ to: 'sec-compare', deltaId: r.delta_id })}>비교 보기</Btn> : null}
                  {r.result_brief_id ? <Btn size="sm" onClick={() => go({ to: 'sec-review', view: { kind: 'brief', id: r.result_brief_id }, sub: 'brief' })}>새 요약 보기</Btn> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-g500">정정으로 달라진 출처에 기대는 판정만 다시 봅니다. 예산 때문에 미룬 것과 권한·무결성 때문에 막힌 것은 따로 셉니다. 재게시나 검색 누락만으로 상충이나 해소를 만들지 않습니다.</p>
    </div>
  );
}

function Policy({ f, data }) {
  const a = useAction();
  const [form, setForm] = useState(null);
  const p = form || data.policy;
  const fe = fieldErrors(a.error);
  const set = (k, v) => setForm({ ...p, [k]: v });
  const num = (v) => (v === '' ? '' : Number(v));
  if (!data.environment_enabled) {
    return (
      <Notice tone="mute" title="이 서버에서는 자동 모니터링이 꺼져 있습니다">
        <p>출처를 주기적으로 다시 확인하는 기능은 서버 설정으로 켭니다. 위의 '공개 자료 다시 찾기'는 그대로 쓸 수 있습니다.</p>
        <p className="text-g500">켜졌을 때의 기본값: 주기 {data.policy.cadence_minutes}분 · 질의 예산 {data.policy.query_budget} · 자료 예산 {data.policy.source_budget}</p>
      </Notice>
    );
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); a.run('setMonitoringPolicy', { params: { case_id: f.c.id }, body: p, onOk: () => setForm(null) }); }} noValidate>
      <Check2 id="mon-on" disabled={!f.write} checked={!!p.monitoring_enabled} onChange={(e) => set('monitoring_enabled', e.target.checked)}>이 기획의 출처를 주기적으로 다시 확인</Check2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="mon-cadence" label="확인 주기(분)" error={fe.cadence_minutes} hint="60에서 10080"><input id="mon-cadence" type="number" inputMode="numeric" className={inputCls} disabled={!f.write} value={p.cadence_minutes} onChange={(e) => set('cadence_minutes', num(e.target.value))} /></Field>
        <Field id="mon-q" label="질의 예산" error={fe.query_budget} hint="5에서 50"><input id="mon-q" type="number" inputMode="numeric" className={inputCls} disabled={!f.write} value={p.query_budget} onChange={(e) => set('query_budget', num(e.target.value))} /></Field>
        <Field id="mon-s" label="자료 예산" error={fe.source_budget} hint="1에서 200"><input id="mon-s" type="number" inputMode="numeric" className={inputCls} disabled={!f.write} value={p.source_budget} onChange={(e) => set('source_budget', num(e.target.value))} /></Field>
      </div>
      <div className="empty:hidden"><ActionState a={a} fields={['cadence_minutes', 'query_budget', 'source_budget']} /></div>
      {a.ok ? <Notice tone="ok" role="status">정책을 저장했습니다.</Notice> : null}
      {f.write ? <Btn kind="primary" type="submit" busy={a.busy}>정책 저장</Btn> : <p className="text-sm text-g500">열람 권한에서는 정책을 바꿀 수 없습니다.</p>}
    </form>
  );
}

function AlertsBody({ f }) {
  const p = { case_id: f.c.id };
  const feed = useQuery('getMonitoringFeed', p);
  const policy = useQuery('getMonitoringPolicy', p);
  const board = useQuery('getRealityBoard', { ...p, pack_id: f.head.pack_id || '' }, !!f.head.pack_id);
  return (
    <div className="space-y-6">
      <div><p className="mb-2 text-sm font-bold text-g900">알림</p><Notifications f={f} feed={feed.data} /></div>
      <div><p className="mb-2 text-sm font-bold text-g900">출처 정정 피드</p><QueryState q={feed} what="변경 피드" />{feed.data ? <Feed feed={feed.data} claims={claimMap(board.data)} /> : null}</div>
      <div><p className="mb-2 text-sm font-bold text-g900">모니터링 정책</p><QueryState q={policy} what="모니터링 정책" />{policy.data ? <Policy f={f} data={policy.data} /> : null}</div>
    </div>
  );
}

export function AlertsCard({ f }) {
  return (
    <Fold id="sec-alerts" icon={Bell} title="출처 변경 알림" defaultOpen={f.unread > 0}
      sub="출처가 정정되면 그 출처에 기댄 판정만 다시 보고, 달라진 결과를 알립니다."
      badge={f.unread ? <Tag tone="warn">읽지 않음 {f.unread}</Tag> : f.notes.length ? <Tag tone="line">{f.notes.length}건</Tag> : null}>
      <AlertsBody f={f} />
    </Fold>
  );
}
