"""API errors and the catalog of codes the server can return."""
from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: list | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or []


# code -> (HTTP status, message, field)
CATALOG: dict[str, tuple[int, str, str]] = {
    # specification codes
    "IDEMPOTENCY_CONFLICT": (409, "같은 key가 다른 의미 입력에 사용되었다.", "Idempotency-Key"),
    "REVIEW_PARTIAL_NOT_ALLOWED": (409, "부분 결과를 사용하려면 명시적으로 허용해야 한다.", "allow_partial"),
    "RESOURCE_NOT_FOUND": (404, "이 범위에서 객체를 찾을 수 없다.", "resource_id"),
    "ROLE_FORBIDDEN": (403, "쓰기 작업은 EDITOR 이상의 권한이 필요하다.", "role"),
    "TASK_VERSION_CONFLICT": (409, "과제 version이 변경되었다.", "If-Match"),
    "AS_OF_SOURCE_UNAVAILABLE": (422, "자료 수신 이후의 기준 시각을 사용해야 한다.", "as_of"),
    "METADATA_ONLY_BODY_FORBIDDEN": (422, "미확인 권리는 본문을 받을 수 없다.", "body"),
    "EXPORT_RIGHTS_BLOCKED": (403, "현재 권리로는 이 결과 파일을 제공할 수 없다.", "input_id"),
    "CASE_TITLE_MISMATCH": (409, "기존 Case와 입력 제목이 다르다.", "title"),
    "CONFIGURATION_BLOCKED": (503, "검토에 필요한 모델 설정이 없다.", "provider"),
    "MODE_INPUT_INVALID": (422, "이 입력 모드의 필수 원문 또는 초안이 없다.", "mode"),
    # server codes
    "UNAUTHENTICATED": (401, "인증 정보가 없거나 만료되었다.", "Authorization"),
    "WORKSPACE_FORBIDDEN": (403, "이 workspace 경로에 접근할 수 없다.", "workspace_id"),
    "INPUT_INVALID": (422, "입력값을 확인해야 한다.", "body"),
    "TASK_CANCELLED": (409, "취소된 과제에는 결과를 등록할 수 없다.", "task_id"),
    "TASK_NOT_OPEN": (409, "이미 종료된 과제는 다시 변경할 수 없다.", "status"),
    "SOURCE_POLICY_BLOCKED": (403, "승인되지 않은 권리 또는 민감도의 자료는 받을 수 없다.", "rights_class"),
    "REALITY_AS_OF_PRECEDES_BASELINE": (409, "기준 근거보다 과거의 기준 시각으로 실행할 수 없다.", "as_of"),
    "EXPORT_NOT_READY": (409, "파일 생성이 아직 끝나지 않았다.", "export_id"),
    "MONITORING_DISABLED": (409, "이 환경에서는 모니터링 기능이 꺼져 있다.", "monitoring_enabled"),
    "DEMO_ACCOUNT_LIMITED": (403, "시연 계정으로는 실제 검색과 모델 판정을 실행할 수 없다.", "account"),
    "USAGE_LIMIT_REACHED": (429, "오늘 사용할 수 있는 모델 호출량을 모두 썼다.", "usage"),
    "RATE_LIMITED": (429, "요청이 너무 잦다. 잠시 후 다시 시도한다.", "rate"),
    "LOGIN_FAILED": (401, "이메일 또는 비밀번호가 올바르지 않다.", "email"),
    "SOURCE_FETCH_FAILED": (422, "주소에서 원문을 가져오지 못했다.", "source_url"),
    "INTERNAL_ERROR": (500, "서버 내부 오류로 요청을 처리하지 못했다.", "server"),
}


def err(code: str, *, status: int | None = None, message: str | None = None, field: str | None = None,
        reason: str | None = None, details: list | None = None) -> ApiError:
    st, msg, fld = CATALOG.get(code, (422, code, "body"))
    status = st if status is None else status
    message = msg if message is None else message
    field = fld if field is None else field
    return ApiError(status, code, message, details or [{"field": field, "reason": reason if reason is not None else message}])


def invalid(field: str, reason: str) -> ApiError:
    return err("INPUT_INVALID", field=field, reason=reason)
