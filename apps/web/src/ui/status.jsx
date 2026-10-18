// Every status is written out in Korean; the icon in front differs by shape
// as well as by colour, so nothing depends on colour alone.
import { CircleCheck, CircleX, CircleDashed, CircleMinus, Split, TriangleAlert, LoaderCircle, Ban, Clock, CircleDot } from 'lucide-react';
import * as L from '../labels.js';
import { cx } from './kit.jsx';

const TONE = {
  pos: 'bg-positive-bg text-positive-ink',
  warn: 'bg-warning-bg text-warning-ink',
  neg: 'bg-negative-bg text-negative-ink',
  mute: 'bg-g100 text-g600',
  plain: 'bg-white text-g500 ring-1 ring-inset ring-g200',
  run: 'bg-brand-bg text-brand',
};
export const DOT = { pos: 'bg-positive', warn: 'bg-warning', neg: 'bg-negative', mute: 'bg-g400', plain: 'bg-g300', run: 'bg-brand' };

const KINDS = {
  review: {
    map: L.REVIEW_STATUS,
    look: { SUPPORTED: ['pos', CircleCheck], CONFLICT: ['warn', Split], CONTRADICTED: ['neg', CircleX], INSUFFICIENT_EVIDENCE: ['mute', CircleDashed], NON_FACTUAL: ['plain', CircleMinus] },
  },
  question: {
    map: L.QUESTION_STATUS,
    look: { OPEN: ['mute', CircleDashed], PARTIALLY_RESOLVED: ['warn', CircleDot], RESOLVED: ['pos', CircleCheck], CONFLICTED: ['warn', Split] },
  },
  job: {
    map: L.JOB_STATUS,
    look: { QUEUED: ['plain', Clock], RUNNING: ['run', LoaderCircle], COMPLETED: ['pos', CircleCheck], PARTIAL: ['warn', TriangleAlert], FAILED: ['neg', CircleX], BLOCKED: ['neg', Ban] },
  },
  task: {
    map: { OPEN: '진행 중', DONE: '완료', CANCELLED: '취소' },
    look: { OPEN: ['run', CircleDot], DONE: ['pos', CircleCheck], CANCELLED: ['plain', Ban] },
  },
  submission: {
    map: { REGISTERED: '등록됨', ACCEPTED: '근거로 반영', BLOCKED: '차단' },
    look: { REGISTERED: ['plain', Clock], ACCEPTED: ['pos', CircleCheck], BLOCKED: ['neg', Ban] },
  },
};

export const toneOf = (kind, code) => ((KINDS[kind] && KINDS[kind].look[code]) || ['plain'])[0];
export const labelOf = (kind, code) => (KINDS[kind] && KINDS[kind].map[code]) || code;

export function Status({ kind, code, size = 'sm', className }) {
  if (!code) return <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold', TONE.plain, className)}>확인 중</span>;
  const def = KINDS[kind];
  const [tone, Icon] = (def && def.look[code]) || ['plain', CircleMinus];
  return (
    <span className={cx('inline-flex shrink-0 items-center font-semibold', TONE[tone],
      size === 'lg' ? 'gap-1.5 rounded-lg px-2.5 py-1 text-sm' : 'gap-1 rounded-md px-2 py-0.5 text-xs', className)}>
      <Icon className={cx(size === 'lg' ? 'size-4' : 'size-3.5', code === 'RUNNING' && 'animate-spin')} aria-hidden="true" />
      {(def && def.map[code]) || code}
    </span>
  );
}
