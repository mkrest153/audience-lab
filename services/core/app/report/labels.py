"""Korean labels for contract values (same as the web app's labels.js)."""
from datetime import datetime, timedelta, timezone

REVIEW_STATUS = {"SUPPORTED": "근거 있음", "CONFLICT": "상충", "CONTRADICTED": "반박됨",
                 "INSUFFICIENT_EVIDENCE": "근거 부족", "NON_FACTUAL": "사실 판정 대상 아님"}
QUESTION_STATUS = {"OPEN": "미해결", "PARTIALLY_RESOLVED": "일부 해소", "RESOLVED": "해소", "CONFLICTED": "상충 유지"}
TASK_STATUS = {"OPEN": "진행", "DONE": "완료", "CANCELLED": "취소"}
KIND = {"FACTUAL": "사실", "CAUSAL": "인과", "NON_FACTUAL": "의견·질문", "NUMERIC": "수치"}
REASON = {
    "SCOPE_MATCHED": "대상과 범위가 같음", "SOURCES_DISAGREE": "출처끼리 다름", "NON_COMPARABLE_SCOPE": "비교 범위가 다름",
    "CAUSATION_NOT_ESTABLISHED": "인과 근거 없음", "DIRECT_LEDGER_SUPPORT": "대장 기록이 직접 뒷받침", "DIRECT_SUPPORT": "직접 뒷받침",
    "DIRECT_CONTRADICTION": "직접 반박", "NO_RELEVANT_EVIDENCE": "관련 근거 없음", "NON_FACTUAL_TEXT": "사실 문장이 아님",
    "NUMERIC_CLAIM_CONTRADICTED": "수치가 근거와 다름", "NUMERIC_CLAIM_SUPPORTED": "수치가 근거와 같음",
    "SOURCE_CORRECTION_CONFIRMED": "출처가 정정함", "PARTIAL_SUPPORT": "일부만 뒷받침", "OUTDATED_EVIDENCE": "근거 시점이 다름",
    "ATTRIBUTION_ONLY": "주장했다는 기록만 있음",
}
SECTION = {"DECISION": "먼저 볼 것", "WHAT_WE_KNOW": "지금 말할 수 있는 것", "WHAT_IS_DISPUTED": "서로 다른 것",
           "WHAT_IS_STILL_UNKNOWN": "아직 모르는 것", "STRONG_COUNTER_FRAMES": "받을 수 있는 반론"}
EPISTEMIC = {"VERIFIED_FACT": "검증된 사실", "SUPPORTED_CLAIM": "근거 있는 주장", "INFERENCE": "추론", "HYPOTHESIS": "가설",
             "UNVERIFIED": "미검증", "CONTRADICTED": "반박됨", "NOT_RESOLVED": "미해결", "CONFLICT": "상충"}
LABEL = {"REALITY": "실제 근거", "GROUNDED": "원문 연결", "DISPUTED": "상충", "UNKNOWN": "공백", "DECISION_FIRST": "우선 검토",
         "SYNTHETIC_INTERPRETATION": "합성 해석", "NOT_AUDIENCE_PREDICTION": "독자 예측 아님", "NOT_FACT": "사실 아님",
         "EDITORIAL_ACTION": "취재 행동 제안", "FICTIONAL_TEST_DATA": "가상 테스트 자료", "NOT_A_REAL_REPORT": "실제 보고서 아님",
         "AI_ASSISTED_REVIEW": "AI 보조 검토", "HUMAN_DECISION_REQUIRED": "게재 판단은 사람이 함"}
RIGHTS = {"OPEN": "공개(OPEN)", "LICENSED_FULL_TEXT": "라이선스 전문", "LICENSED_PASSAGE": "라이선스 구간",
          "RESTRICTED_LINK_ONLY": "링크만 허용", "UNKNOWN": "권리 미확인"}
CHANGE = {"STATUS_CHANGED": "판정이 바뀜", "EVIDENCE_CHANGED": "근거가 바뀜", "RECOMMENDATION_CHANGED": "권고가 바뀜",
          "UNCHANGED": "그대로", "BEFORE_ONLY": "이전 검토에만 있음", "AFTER_ONLY": "새 검토에만 있음"}
COMPARISON = {"COMPARABLE": "같은 초안이라 비교 가능", "NOT_COMPARABLE": "초안이 달라 비교 불가"}


def kst(iso_string):
    if not iso_string:
        return "없음"
    d = datetime.fromisoformat(iso_string.replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=9)))
    return d.strftime("%Y.%m.%d %H:%M KST")


def short_id(i):
    return i[:8] if i else "없음"


def won(n):
    s = f"{n:,}"
    eok = n / 100000000
    e = int(eok) if float(eok).is_integer() else f"{eok:.1f}".rstrip("0").rstrip(".")
    return f"{s}원 ({e}억 원)"
