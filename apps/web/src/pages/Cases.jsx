// 기획 목록 (MarketView 히스토리): 공간의 기획을 열어 이어서 검토합니다.
import { History, Plus, FileText, ChevronRight, FolderOpen } from 'lucide-react';
import { openCase } from '../app/store.js';
import { useQuery } from '../app/api.js';
import { PageHead, QueryState, Btn, Tag, useMe, canWrite } from '../ui/kit.jsx';
import { when, whenShort } from '../app/time.js';

function stageOf(c) {
  const h = c.head;
  if (!h) return ['line', '입력 전'];
  if (h.review_id) return ['pos', '초안 검토 있음'];
  if (h.pack_id && !h.content_version_id) return ['pos', '근거 정리됨'];
  if (h.pack_id) return ['brand', '근거 수집됨'];
  return ['brand', '입력 저장됨'];
}

export function Cases() {
  const me = useMe();
  const q = useQuery('listCases', {});
  const items = q.data ? [...q.data.items].sort((a, b) => b.created_at.localeCompare(a.created_at)) : [];
  const write = canWrite(me);
  return (
    <>
      <PageHead pill="기획 목록" icon={History} title="기획 목록"
        desc={me && me.demo_only ? '시연 공간의 기획입니다. 열어서 입력부터 보고서까지 이어서 볼 수 있습니다.' : '편집국 공간의 기획을 열어 이어서 검토합니다.'}
        right={write ? <Btn kind="primary" icon={Plus} onClick={() => openCase('new')}>새 기획</Btn> : null} />
      <QueryState q={q} what="기획 목록" />
      {q.data && items.length === 0 ? (
        <div className="rounded-2xl border border-g200 bg-white px-6 py-14 text-center shadow-sm">
          <FolderOpen className="mx-auto size-8 text-g300" aria-hidden="true" />
          <p className="mt-3 text-[15px] font-semibold text-g800">아직 기획이 없습니다</p>
          <p className="mt-1 text-sm text-g500">질문과 초안, 또는 공개 자료를 넣어 첫 검토를 시작하세요.</p>
          {write ? <Btn kind="primary" icon={Plus} className="mt-5" onClick={() => openCase('new')}>새 기획</Btn> : <p className="mt-4 text-sm text-g500">열람 권한에서는 기획을 만들 수 없습니다.</p>}
        </div>
      ) : null}
      {items.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((c) => {
            const [tone, text] = stageOf(c);
            return (
              <li key={c.id}>
                <button type="button" onClick={() => openCase(c.id)}
                  className="flex h-full w-full items-start gap-3 rounded-2xl border border-g200 bg-white p-5 text-left shadow-sm transition hover:border-brand">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand"><FileText className="size-4" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-g900">{c.title}</span>
                    <span className="mt-1 block text-xs text-g500">기준 시각 {when(c.as_of)} · 만든 시각 {whenShort(c.created_at)}</span>
                    <span className="mt-2.5 block"><Tag tone={tone}>{text}</Tag></span>
                  </span>
                  <ChevronRight className="mt-2 size-4 shrink-0 text-g300" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
