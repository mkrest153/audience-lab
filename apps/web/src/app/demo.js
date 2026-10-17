// Fictional demo material (the 청람시 fixture of the specification pack). Generated from fixture.json.
const DEMO = {
 "note": "청람시와 이 자료의 문서·금액은 인수 시험용으로 만든 가상 자료입니다.",
 "intake": {
  "title": "청람시 도서관 계약 검토",
  "question": "계약 경쟁 확대와 비용 절감 주장을 기사에 쓸 수 있는가",
  "as_of": "2026-09-30T09:00:00Z",
  "draft": "청람시는 2026년 도서관 리모델링 계약 12건을 모두 공개경쟁으로 체결했다.\n경쟁 확대 덕분에 총 계약금액은 전년보다 20% 줄었다.\n2026년 총 계약금액은 12억 원이다."
 },
 "sources": [
  {
   "key": "S1",
   "title": "시 보도자료",
   "url": "https://fixture.example/s1",
   "published_at": "2026-09-01T00:00:00Z",
   "available_at": "2026-09-30T09:00:00Z",
   "rights": "OPEN",
   "body": "청람시는 2026년 도서관 리모델링 계약 12건을 모두 공개경쟁으로 체결했다고 밝혔다."
  },
  {
   "key": "S2",
   "title": "2026년 계약대장",
   "url": "https://fixture.example/s2",
   "published_at": "2026-09-02T00:00:00Z",
   "available_at": "2026-09-30T09:00:00Z",
   "rights": "OPEN",
   "body": "대상: 2026년 도서관 리모델링 공사. 계약 12건 중 공개경쟁 11건, 긴급 수의계약 1건. 총 계약금액 12억 원."
  },
  {
   "key": "S3",
   "title": "2025년 지출 요약",
   "url": "https://fixture.example/s3",
   "published_at": "2025-12-31T00:00:00Z",
   "available_at": "2026-09-30T09:00:00Z",
   "rights": "OPEN",
   "body": "대상: 2025년 도서관 리모델링 공사와 가구 구매. 총 계약금액 15억 원. 공사와 가구의 금액 구분은 공개하지 않았다."
  },
  {
   "key": "S4",
   "title": "보도자료 재게시",
   "url": "https://fixture.example/s4",
   "published_at": "2026-09-03T00:00:00Z",
   "available_at": "2026-09-30T09:00:00Z",
   "rights": "OPEN",
   "body": "청람시는 2026년 도서관 리모델링 계약 12건을 모두 공개경쟁으로 체결했다고 밝혔다."
  },
  {
   "key": "S5",
   "title": "접근 권한 미확인 인터뷰",
   "url": "https://fixture.example/s5",
   "published_at": "2026-09-04T00:00:00Z",
   "available_at": "2026-09-30T09:00:00Z",
   "rights": "UNKNOWN",
   "body": null
  },
  {
   "key": "S6",
   "title": "2025년 공사와 가구 분리 내역",
   "url": "https://fixture.example/s6",
   "published_at": "2026-10-01T03:00:00Z",
   "available_at": "2026-10-02T09:00:00Z",
   "rights": "OPEN",
   "body": "2025년 도서관 리모델링 공사 계약금액은 12억 5000만 원, 가구 구매는 2억 5000만 원이다. 합계 15억 원이며 공사 범위는 2026년 공사와 동일하다."
  },
  {
   "key": "S7",
   "title": "2026년 계약대장 보충",
   "url": "https://fixture.example/s7",
   "published_at": "2026-10-01T04:00:00Z",
   "available_at": "2026-10-02T09:00:00Z",
   "rights": "OPEN",
   "body": "2026년 도서관 리모델링 공사 계약금액은 12억 원이다. 가구 구매는 제외하며 2025년 분리 내역의 공사와 동일 범위다."
  },
  {
   "key": "S8",
   "title": "시 보도자료 정정",
   "url": "https://fixture.example/s1",
   "published_at": "2026-10-03T08:00:00Z",
   "available_at": "2026-10-03T09:00:00Z",
   "rights": "OPEN",
   "body": "정정: 2026년 계약 12건 중 공개경쟁은 11건, 긴급 수의계약은 1건이다. 앞선 12건 모두 공개경쟁이라는 설명을 바로잡는다."
  }
 ],
 "task_default": {
  "title": "계약 예외와 동일 범위 비용 확인",
  "questions": [
   "수의계약 1건의 사유와 보도자료 정정 여부",
   "2025년 공사비와 가구비 분리 내역",
   "계약 방식 변경과 금액 변화의 인과 근거"
  ]
 },
 "result_note": "분리 내역 확보. 원인은 추가 확인 필요.",
 "task_done_reason": "자료 수신은 마쳤으나 인과 질문은 남아 있다."
};
export default DEMO;
// a source as the submission form wants it
export function sourceBody(key) {
  const s = DEMO.sources.find((x) => x.key === key);
  return { title: s.title, source_url: s.url, recorded_at: s.published_at, rights_class: s.rights, body: s.body };
}
export const isDemoTitle = (t) => (t || '').normalize('NFC').trim().replace(/\s+/g, ' ') === DEMO.intake.title;
