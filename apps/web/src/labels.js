// Korean labels for contract values. Codes stay visible next to the label so
// a reader can match the screen to the specification.

export const REVIEW_STATUS = {
  SUPPORTED: '근거 있음',
  CONFLICT: '상충',
  CONTRADICTED: '반박됨',
  INSUFFICIENT_EVIDENCE: '근거 부족',
  NON_FACTUAL: '사실 판정 대상 아님',
};
export const QUESTION_STATUS = {
  OPEN: '미해결',
  PARTIALLY_RESOLVED: '일부 해소',
  RESOLVED: '해소',
  CONFLICTED: '상충 유지',
};
export const JOB_STATUS = {
  QUEUED: '대기',
  RUNNING: '진행 중',
  COMPLETED: '완료',
  PARTIAL: '부분 완료',
  FAILED: '실패',
  BLOCKED: '차단',
};
export const STAGE = {
  QUEUED: '접수',
  INGEST: '자료 확인',
  REALITY: '근거 정리',
  REVIEW: '초안 대조',
  COMMIT: '저장',
  RUNNING: '처리',
  TERMINAL: '종료',
};
export const TASK_STATUS = { OPEN: '진행', DONE: '완료', CANCELLED: '취소' };
export const MODE = {
  QUESTION_ONLY: '질문만',
  SOURCE_REVIEW: '공개 자료 검토',
  DRAFT_REVIEW: '초안 검토',
};
export const STATE_REASON = {
  EDITORIAL_QUESTION_SAVED: '기획 질문 저장',
  SWITCH_TO_QUESTION_ONLY: '질문만 모드로 바꿈',
  SWITCH_TO_SOURCE_REVIEW: '공개 자료 검토로 바꿈',
  SWITCH_TO_DRAFT_REVIEW: '초안 검토로 바꿈',
};
export const MODE_HINT = {
  QUESTION_ONLY: '질문에서 공개 자료를 찾아 근거 판과 Brief를 만든다. 초안 주장 표는 만들지 않는다.',
  SOURCE_REVIEW: '직접 넣은 공개 원문을 출처로 검증한다. 넣었다는 이유로 사실이 되지는 않는다.',
  DRAFT_REVIEW: '초안의 문장을 나눠 근거와 대조하고, 문장마다 고칠 점과 취재할 점을 낸다.',
};
export const KIND = { FACTUAL: '사실', CAUSAL: '인과', NON_FACTUAL: '의견·질문', NUMERIC: '수치' };
export const REASON = {
  SCOPE_MATCHED: '대상과 범위가 같음',
  SOURCES_DISAGREE: '출처끼리 다름',
  NON_COMPARABLE_SCOPE: '비교 범위가 다름',
  CAUSATION_NOT_ESTABLISHED: '인과 근거 없음',
  DIRECT_LEDGER_SUPPORT: '대장 기록이 직접 뒷받침',
  DIRECT_SUPPORT: '직접 뒷받침',
  DIRECT_CONTRADICTION: '직접 반박',
  NO_RELEVANT_EVIDENCE: '관련 근거 없음',
  NON_FACTUAL_TEXT: '사실 문장이 아님',
  NUMERIC_CLAIM_CONTRADICTED: '수치가 근거와 다름',
  NUMERIC_CLAIM_SUPPORTED: '수치가 근거와 같음',
  SOURCE_CORRECTION_CONFIRMED: '출처가 정정함',
  PARTIAL_SUPPORT: '일부만 뒷받침',
  OUTDATED_EVIDENCE: '근거 시점이 다름',
  ATTRIBUTION_ONLY: '주장했다는 기록만 있음',
};
export const SECTION = {
  DECISION: '먼저 볼 것',
  WHAT_WE_KNOW: '지금 말할 수 있는 것',
  WHAT_IS_DISPUTED: '서로 다른 것',
  WHAT_IS_STILL_UNKNOWN: '아직 모르는 것',
  STRONG_COUNTER_FRAMES: '받을 수 있는 반론',
};
export const EPISTEMIC = {
  VERIFIED_FACT: '검증된 사실',
  SUPPORTED_CLAIM: '근거 있는 주장',
  INFERENCE: '추론',
  HYPOTHESIS: '가설',
  UNVERIFIED: '미검증',
  CONTRADICTED: '반박됨',
  NOT_RESOLVED: '미해결',
  CONFLICT: '상충',
};
export const LABEL = {
  REALITY: '실제 근거',
  GROUNDED: '원문 연결',
  DISPUTED: '상충',
  UNKNOWN: '공백',
  DECISION_FIRST: '우선 검토',
  SYNTHETIC_INTERPRETATION: '합성 해석',
  NOT_AUDIENCE_PREDICTION: '독자 예측 아님',
  NOT_FACT: '사실 아님',
  EDITORIAL_ACTION: '취재 행동 제안',
  FICTIONAL_TEST_DATA: '가상 테스트 자료',
  NOT_A_REAL_REPORT: '실제 보고서 아님',
  AI_ASSISTED_REVIEW: 'AI 보조 검토',
  HUMAN_DECISION_REQUIRED: '게재 판단은 사람이 함',
};
export const RIGHTS = {
  OPEN: '공개(OPEN)',
  LICENSED_FULL_TEXT: '라이선스 전문',
  LICENSED_PASSAGE: '라이선스 구간',
  RESTRICTED_LINK_ONLY: '링크만 허용',
  UNKNOWN: '권리 미확인',
};
export const FAMILY = {
  CITY_RELEASE: '시 보도자료 계열',
  CONTRACT_LEDGER: '계약대장 계열',
  PREVIOUS_LEDGER: '전년 지출 계열',
  INTERVIEW: '인터뷰 계열',
};
export const RELATION = { SUPPORT: '뒷받침', CONTRADICT: '반박', CONTEXT: '맥락', REPEAT: '같은 계열 재게시' };
export const CHANGE = {
  STATUS_CHANGED: '판정이 바뀜',
  EVIDENCE_CHANGED: '근거가 바뀜',
  RECOMMENDATION_CHANGED: '권고가 바뀜',
  UNCHANGED: '그대로',
  BEFORE_ONLY: '이전 검토에만 있음',
  AFTER_ONLY: '새 검토에만 있음',
};
export const COMPARISON = { COMPARABLE: '같은 초안이라 비교 가능', NOT_COMPARABLE: '초안이 달라 비교 불가' };
export const CHANGE_TYPE = {
  NEW_EVIDENCE: '새 근거',
  NEW_CLAIM: '새 주장',
  CLAIM_STRENGTHENED: '주장 강화',
  CLAIM_WEAKENED: '주장 약화',
  CLAIM_CONTRADICTED: '주장 반박',
  UNKNOWN_RESOLVED: '공백 해소',
  NEW_ENTITY: '새 주체',
  TIMELINE_CHANGE: '시점 변화',
};
export const EXCLUDED = {
  RIGHTS: '권리가 확인되지 않아 제외',
  AFTER_AS_OF: '기준 시각 이후 자료라 제외',
  COLLECTION_FAILED: '수집 실패로 제외',
};
export const PURPOSE = {
  UNKNOWN_DRIVEN: '공백 중심',
  ENTITY_WATCH: '주체 추적',
  EVENT_WATCH: '사건 추적',
  SOURCE_WATCH: '출처 추적',
  EMERGENT: '새 단서',
};
export const CHANNEL = { PUBLIC_SEARCH: '공개 검색', PUBLIC_RECORDS: '공개 기록' };
export const EVENT = {
  'core.intake.created': '기획 입력 저장',
  'core.submission.registered': '원문 등록',
  'core.task.created': '과제 생성',
  'core.task.status_changed': '과제 상태 변경',
  'core.reporting_result.created': '취재 결과 등록',
  'core.reality.queued': '근거 실행 접수',
  'core.reality.completed': '근거 실행 종료',
  'core.editorial_brief.created': 'Brief 생성',
  'core.review.queued': '초안 검토 접수',
  'core.review.completed': '초안 검토 종료',
  'core.reassessment.queued': '재검토 접수',
  'core.reassessment.completed': '재검토 종료',
  'core.search.queued': '검색 접수',
  'core.search.completed': '검색 종료',
  'core.notification.created': '알림 생성',
  'core.notification.read': '알림 읽음',
  'core.export.queued': '보고서 생성 접수',
  'core.export.completed': '보고서 생성 종료',
  'core.export.access_blocked': '보고서 접근 차단',
};
export const ERROR_HINT = {
  CONFIGURATION_BLOCKED: '검토에 필요한 설정이 없습니다. 시연 공간에서는 시연 기획만 검토할 수 있고, 편집국 공간에서는 관리자가 모델 키를 설정해야 합니다.',
  DEMO_ACCOUNT_LIMITED: '시연 계정은 가상의 청람시 자료만 다룹니다. 실제 자료 검토는 관리자가 발급한 계정으로 로그인하세요.',
  USAGE_LIMIT_REACHED: '오늘 쓸 수 있는 모델·검색 호출량을 모두 썼습니다. 내일 다시 시도하거나 관리자에게 한도 조정을 요청하세요.',
  RATE_LIMITED: '짧은 시간에 요청이 몰렸습니다. 1분쯤 뒤에 다시 시도하세요.',
  SOURCE_FETCH_FAILED: '주소에서 원문을 가져오지 못해도 원문을 직접 붙여 넣으면 등록할 수 있습니다.',
  MONITORING_DISABLED: '이 서비스에서는 자동 모니터링을 아직 켜지 않았습니다. 필요할 때 공개 자료 검색을 직접 실행하세요.',
  UNAUTHENTICATED: '로그인이 만료되었습니다. 다시 로그인하세요.',
  EXPORT_RIGHTS_BLOCKED: '허용된 자료만으로 새 검토를 만든 뒤 새 보고서를 요청해야 합니다.',
  TASK_VERSION_CONFLICT: '다른 사람이 먼저 바꿨습니다. 최신 과제를 다시 읽어 확인하세요.',
  REVIEW_PARTIAL_NOT_ALLOWED: '부분 결과로 검토하려면 부분 결과 사용을 직접 선택해야 합니다.',
  AS_OF_SOURCE_UNAVAILABLE: '자료를 받은 시각 이후로 재검토 기준 시각을 잡아야 합니다.',
  IDEMPOTENCY_CONFLICT: '같은 요청 키가 다른 내용에 쓰였습니다. 기존 결과를 조회하거나 새 요청으로 보내세요.',
};

const pad = (n) => String(n).padStart(2, '0');
// 2026-09-30T09:00:00Z -> "2026.09.30 18:00 KST"
export function kst(isoString, withSeconds = false) {
  if (!isoString) return '없음';
  const d = new Date(Date.parse(isoString) + 9 * 3600 * 1000);
  const s = withSeconds ? `:${pad(d.getUTCSeconds())}` : '';
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${s} KST`;
}
export const utcShort = (isoString) => (isoString ? isoString.replace('T', ' ').replace(':00Z', 'Z') : '');
export const shortId = (id) => (id ? id.slice(0, 8) : '없음');
export function won(n) {
  const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const eok = n / 100000000;
  return `${s}원 (${Number.isInteger(eok) ? eok : eok.toFixed(1).replace(/\.0$/, '')}억 원)`;
}
