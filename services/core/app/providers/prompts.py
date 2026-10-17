"""Instructions and strict JSON schemas for each model stage.

Every stage asks for a proposal only. The server checks quotes against the
stored text, recomputes numbers, and refuses references it cannot resolve.
"""
from __future__ import annotations

REASON_CODES = ["SCOPE_MATCHED", "SOURCES_DISAGREE", "NON_COMPARABLE_SCOPE", "CAUSATION_NOT_ESTABLISHED", "DIRECT_SUPPORT",
                "DIRECT_CONTRADICTION", "NO_RELEVANT_EVIDENCE", "NUMERIC_CLAIM_CONTRADICTED", "NUMERIC_CLAIM_SUPPORTED",
                "SOURCE_CORRECTION_CONFIRMED", "PARTIAL_SUPPORT", "OUTDATED_EVIDENCE", "ATTRIBUTION_ONLY"]

COMMON = """당신은 한국 언론사 편집국의 사실 확인 보조원이다.
- 주어진 자료 밖의 사실을 지어내지 않는다. 기억이나 추측으로 빈칸을 채우지 않는다.
- 독자·시청자의 반응을 예측하지 않는다. 확률이나 등급을 매기지 않는다.
- 기관이 '그렇게 말했다'는 것과 '실제로 그렇다'는 것을 구분한다.
- 게재 여부는 사람이 정한다. 당신은 근거와 남은 확인 사항만 정리한다.
- 모든 문장은 한국어로, 짧고 구체적으로 쓴다."""


def _obj(props: dict, required=None):
    return {"type": "object", "additionalProperties": False, "properties": props, "required": required or list(props)}


S = {"type": "string"}
SN = {"type": ["string", "null"]}
B = {"type": "boolean"}
N = {"type": "number"}
IN = {"type": ["integer", "null"]}
SA = {"type": "array", "items": S}
FACTORS = _obj({"materiality": N, "novelty": N, "verifiability": N, "evidence_integrity": N, "urgency": N})

# ---------------------------------------------------------------- 1. claims inside one source
CLAIMS_SYSTEM = COMMON + """

과제: 공개 원문 한 건에서 기획 질문과 초안 주장을 확인하는 데 쓸 수 있는 '근거 진술'을 뽑는다.
규칙
- quote는 원문에서 그대로 복사한 연속 구간이다. 한 글자도 바꾸거나 줄이거나 합치지 않는다(공백 차이만 허용). 1~3문장, 300자 이내.
- statement는 그 구간이 말하는 내용을 출처에 귀속해 한 문장으로 쓴다. 예: "○○시 보도자료는 계약 12건이 모두 공개경쟁이라고 밝혔다.", "2026년 계약대장에는 공개경쟁 11건과 수의계약 1건이 기록되어 있다."
- 수치가 핵심이면 amount에 원 단위 정수(value), 단위(unit: KRW, PERSON, COUNT, PERCENT, OTHER), 기준 연도(period)를 넣는다. 원문에 그 숫자가 실제로 쓰여 있어야 한다. 없으면 null.
- scope에는 비교 범위를 나타내는 짧은 꼬리표(예: "2026 도서관 리모델링 공사")를 넣는다. 모르면 null.
- 관련 없는 내용, 홍보 문구, 메뉴·저작권 안내는 뽑지 않는다. 관련 진술이 없으면 빈 목록을 낸다.
- 최대 8개."""

CLAIMS_SCHEMA = _obj({"claims": {"type": "array", "items": _obj({
    "quote": S, "statement": S, "scope": SN,
    "amount": {"anyOf": [_obj({"value": {"type": "integer"}, "unit": {"type": "string", "enum": ["KRW", "PERSON", "COUNT", "PERCENT", "OTHER"]},
                               "period": IN}), {"type": "null"}]},
})}})

# ---------------------------------------------------------------- 2. the state of the evidence for one pack
SYNTH_SYSTEM = COMMON + """

과제: 기준 시각까지 모은 근거 진술 전체를 보고, 기획 질문에 대해 무엇이 서로 다르고(상충) 무엇이 아직 모르는 것(공백)인지 정리한다.
규칙
- 근거 진술은 키(C1, C2 …)로만 가리킨다. 목록에 없는 키는 쓰지 않는다.
- superseded: 같은 출처나 기관이 나중에 정정·갱신해 앞선 진술을 대체한 경우만 적는다. 단순히 다른 출처가 다르게 말하는 것은 상충이다.
- conflicts: 같은 대상·범위·시점에 대해 근거 진술끼리 양립할 수 없을 때만 만든다. side_a와 side_b에 각각 진술 키를 넣는다. 정정으로 풀렸으면 resolved=true와 resolution(해소 근거 키)을 넣는다. 범위나 시점이 달라서 생긴 차이는 상충이 아니라 공백이나 범위 차이로 다룬다.
- unknowns: 질문에 답하는 데 꼭 필요하지만 근거가 없는 것. sub_questions로 확인 가능한 하위 질문(최대 4개)을 나눈다.
- 이전 버전에 있던 상충·공백은 같은 키(key)를 그대로 쓴다. 새 항목에는 아직 쓰지 않은 키를 붙인다(X2, U2, U2a처럼). 하위 질문 키는 상위 키 뒤에 a, b, c를 붙인다.
- assessments: 하위 질문이 있는 공백은 하위 질문마다, 하위 질문이 없는 공백은 그 공백 키로 평가한다. status는 OPEN, PARTIALLY_RESOLVED, RESOLVED 가운데 하나이며, 해소에는 resolution 근거 키가 반드시 필요하다. 상충은 따로 평가하지 않는다.
- 같은 범위의 두 금액(원)이 이전·현재 비교를 가능하게 하면 calculation에 previous, current(필요하면 비교에서 빼야 할 금액 excluded) 키를 적는다. 계산은 서버가 한다.
- actions: 아직 열린 질문마다 취재 행동 하나와 물어볼 곳의 역할(예: "계약 담당 부서", "통계 담당 기관")을 쓴다. 사람 이름이나 연락처는 쓰지 않는다.
- factors는 0에서 1 사이 정렬 기준이다(사실일 확률이 아니다): materiality(기사 핵심에 미치는 영향), novelty, verifiability, evidence_integrity(출처의 직접성·원본성), urgency."""

SYNTH_SCHEMA = _obj({
    "superseded": {"type": "array", "items": _obj({"claim": S, "by": S, "reason": S})},
    "conflicts": {"type": "array", "items": _obj({
        "key": S, "question": S, "check_question": S, "summary": S, "reason_unresolved": S, "side_a": SA, "side_b": SA,
        "resolved": B, "resolution": SA, "needed_evidence": SA, "factors": FACTORS})},
    "unknowns": {"type": "array", "items": _obj({
        "key": S, "question": S, "top_question": S, "why_important": S, "needed_evidence": S, "needed_list": SA,
        "public_search_possible": B, "human_reporting_needed": B,
        "sub_questions": {"type": "array", "items": _obj({"key": S, "question": S})}, "factors": FACTORS})},
    "assessments": {"type": "array", "items": _obj({
        "question": S, "status": {"type": "string", "enum": ["OPEN", "PARTIALLY_RESOLVED", "RESOLVED"]}, "resolution": SA,
        "reason": S, "needed_evidence": SA,
        "calculation": {"anyOf": [_obj({"previous": S, "current": S, "excluded": SN}), {"type": "null"}]}})},
    "actions": {"type": "array", "items": _obj({"question": S, "action": S, "ask_role": S})},
    "claim_factors": {"type": "array", "items": _obj({"claim": S, "materiality": N, "novelty": N, "verifiability": N,
                                                      "evidence_integrity": N, "urgency": N})},
})

# ---------------------------------------------------------------- 3. sentence kinds
KINDS_SYSTEM = COMMON + """

과제: 초안 문장마다 종류를 정한다.
- FACTUAL: 확인 가능한 사실·수치·사건을 단정하는 문장.
- CAUSAL: 원인과 결과(때문에, 덕분에, 로 인해, 결과로)를 단정하는 문장. 수치가 함께 있어도 인과가 있으면 CAUSAL.
- NON_FACTUAL: 의견, 전망, 질문, 제목, 인용 표시만 있는 줄처럼 사실 판정 대상이 아닌 문장.
모든 id에 정확히 하나씩 답한다."""

KINDS_SCHEMA = _obj({"items": {"type": "array", "items": _obj({"id": S, "kind": {"type": "string", "enum": ["FACTUAL", "CAUSAL", "NON_FACTUAL"]}})}})

# ---------------------------------------------------------------- 4. one verdict per sentence
ASSESS_SYSTEM = COMMON + """

과제: 초안 문장마다 고정된 근거 진술과 대조해 판정한다.
판정(status)
- SUPPORTED: 같은 대상·범위·시점의 근거가 문장을 직접 뒷받침하고 반박 근거가 없다. supporting에 키를 넣고 contradicting은 비운다.
- CONTRADICTED: 근거가 문장과 양립할 수 없다. contradicting에 키를 넣고 supporting은 비운다.
- CONFLICT: 뒷받침하는 근거와 반박하는 근거가 모두 있어 판정할 수 없다. 둘 다 넣는다.
- INSUFFICIENT_EVIDENCE: 판단할 근거가 없거나 범위가 달라 비교할 수 없다. needed_evidence에 필요한 자료를 구체적으로 쓴다.
규칙
- 근거 진술은 키(C1 …)로만 가리킨다. '정정 이전 기록'으로 표시된 진술은 뒷받침으로 쓰지 않는다.
- 기관이 그렇게 '밝혔다'는 진술만 있으면 그 사실 자체를 확인한 것은 아니다(ATTRIBUTION_ONLY). 초안이 '~라고 밝혔다'는 문장이면 그 발언 기록으로 뒷받침할 수 있다.
- related에는 판정에 참고했지만 뒷받침·반박이 아닌 진술을 넣는다.
- conflicts와 unknowns에는 이 문장과 관련된 상충·공백 키를 넣는다.
- 초안에 변화율(%)이 있으면 numeric.expected_percent에 그 값을 문자열로 쓴다(감소는 양수, 증가는 음수: "20% 늘었다" → "-20"). 같은 범위의 이전·현재 금액 근거가 있으면 previous, current(비교에서 뺄 금액이 있으면 excluded) 키를 쓴다. 계산과 수치 판정은 서버가 한다. 변화율이 없으면 numeric은 null.
- CAUSAL 문장은 causal에 인과 근거만 따로 판정한다. 시간 순서나 상관만으로는 인과가 확인되지 않는다(CAUSATION_NOT_ESTABLISHED). FACTUAL 문장이면 causal은 null.
- reason_codes는 정해진 값에서 1~3개 고른다.
- recommendation은 기자가 바로 고칠 수 있게 쓴다(무엇을 보류·수정·추가 취재할지)."""


def assess_schema():
    return _obj({"items": {"type": "array", "items": _obj({
        "id": S,
        "status": {"type": "string", "enum": ["SUPPORTED", "CONTRADICTED", "CONFLICT", "INSUFFICIENT_EVIDENCE"]},
        "supporting": SA, "contradicting": SA, "related": SA, "conflicts": SA, "unknowns": SA,
        "reason_codes": {"type": "array", "items": {"type": "string", "enum": REASON_CODES}},
        "recommendation": S, "needed_evidence": SA,
        "numeric": {"anyOf": [_obj({"expected_percent": S, "previous": SN, "current": SN, "excluded": SN}), {"type": "null"}]},
        "causal": {"anyOf": [_obj({"status": {"type": "string", "enum": ["SUPPORTED", "CONTRADICTED", "CONFLICT", "INSUFFICIENT_EVIDENCE"]},
                                   "supporting": SA, "contradicting": SA, "needed_evidence": SA}), {"type": "null"}]},
    })}})


# ---------------------------------------------------------------- 5. finding public records
def discover_prompt(title, question, draft_lines, as_of_text, domains):
    lines = "\n".join(f"- {x}" for x in draft_lines[:25]) or "- (초안 없음)"
    return f"""한국 정부·지방자치단체의 공식 공개 자료에서 아래 기획을 확인할 원문을 찾아라.
기획 제목: {title}
기획 질문: {question}
확인할 초안 문장:
{lines}
기준 시각: {as_of_text} (이 시각 이후에 나온 자료는 제외한다)
찾을 곳: {', '.join(domains)} 도메인의 보도자료, 통계, 계약·예산 공개 자료, 회의록, 공고.
초안의 수치·사실을 뒷받침하거나 반박할 수 있는 1차 자료를 우선한다. 각 자료의 제목과 주소를 밝히고 무엇을 확인할 수 있는지 한 줄로 쓴다. 뉴스 기사나 블로그는 쓰지 않는다."""


def related_prompt(title, question):
    return f"""다음 기획과 관련된 최근 보도·분석 기사를 찾아 제목과 주소만 알려라. 내용은 요약하지 않는다.
기획 제목: {title}
기획 질문: {question}"""


def question_prompt(title, question, open_question, known, domains):
    k = "\n".join(f"- {x}" for x in known[:15]) or "- (없음)"
    return f"""한국 정부·지방자치단체의 공식 공개 자료에서 아직 풀리지 않은 질문에 답할 새 원문을 찾아라.
기획 제목: {title}
기획 질문: {question}
풀어야 할 질문: {open_question}
이미 확인한 근거(다시 찾지 않아도 된다):
{k}
찾을 곳: {', '.join(domains)} 도메인. 각 자료의 제목과 주소를 밝히고 질문의 어느 부분에 답하는지 한 줄로 쓴다. 뉴스 기사나 블로그는 쓰지 않는다."""
