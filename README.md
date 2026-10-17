# Audience Lab — 편집국 기획 검토

기자·데스크·PD·작가가 쓴 기획과 초안을 **공개 자료와 대조**하는 업무 도구입니다.
초안 문장마다 근거를 붙이고, 출처끼리 다른 설명(상충)과 아직 모르는 것(공백)을 취재 과제로 넘기고,
새로 확보한 자료로 다시 검토해 무엇이 왜 바뀌었는지 보여 줍니다. 게재와 편성 판단은 사람이 합니다.

- 서비스: Render 한 서비스 (FastAPI + SQLite, 웹 화면을 함께 서빙). 지금은 무료 플랜이라 다시 시작하면 기록이 지워집니다 (`OPERATIONS.md`)
- 소개 홈페이지: `homepage/` (정적 페이지, Vercel)

## 하지 않는 것

- 독자·시청자 반응을 예측하지 않습니다. 반론 틀은 합성 해석이며 사실이 아니라고 표시합니다.
- 점수는 확률이 아닙니다. 판정은 기준 시각까지 확인한 자료 범위 안에서만 유효합니다.
- 권리가 확인되지 않은 자료의 본문은 저장하지도 보여 주지도 않습니다. 제목과 주소만 남깁니다.

## 구조

```
apps/web/          React 화면 (esbuild로 dist/ 생성)
services/core/     FastAPI 서비스
  app/engine/      검토 엔진: 근거 묶음, 초안 대조, 과제, 재검토, 비교, 보고서
  app/providers/   근거 공급자: fixture(시연 청람시 자료), openai(실제 공개 자료 검색과 판정)
  app/report/      PDF·DOCX·JSON 보고서 생성 (보고서 글꼴: NanumGothic 부분집합, OFL)
  tests/           명세 묶음의 닫힌 스키마로 응답을 검사하는 테스트
homepage/          소개 홈페이지 (정적)
Dockerfile         웹 빌드 → 파이썬 서비스 이미지
render.yaml        Render Blueprint
```

## 두 공간

| 공간 | 누가 | 근거 | 저장소 |
| --- | --- | --- | --- |
| 편집국 | 관리자가 발급한 계정 | 정부·지자체 공개 자료 검색(OpenAI web search, `go.kr`·`korea.kr`·`kosis.kr`)과 직접 등록한 원문 | `audience-lab.db` |
| 시연 | 로그인 화면의 시연 계정 3개 | 가상의 청람시 자료만 (모델 호출 없음) | `audience-lab-demo.db`, 부팅할 때마다 새로 만듦 |

시연 계정으로는 편집국 공간의 기획이 보이지 않고, 모델 사용량도 쓰지 않습니다.

## 실제 파이프라인 (편집국 공간)

1. 기획 질문과 초안으로 공개 자료를 검색합니다. 허용 도메인 페이지만 서버가 직접 받아 본문을 저장합니다(저작권법 제24조의2 공공저작물).
2. 모델이 원문에서 인용한 문장만 근거 진술이 됩니다. 서버가 인용 위치를 원문에서 다시 찾고, 못 찾으면 버립니다. 금액은 그 구간에 실제로 적힌 것만 남깁니다.
3. 상충·공백·질문 트리를 만들고, 상위 질문 상태는 하위 질문에서 서버가 다시 계산합니다.
4. 초안 문장을 나눠 사실·인과·의견을 가르고, 문장마다 근거 있음·상충·반박됨·근거 부족·사실 판정 대상 아님으로 판정합니다. 수치 비교는 서버가 원 단위 정수로 다시 계산합니다.
5. 관련 보도는 링크만 남깁니다(권리 미확인, 본문 저장 안 함).

## 로컬 실행

```bash
# 웹 화면
cd apps/web && npm ci && npm run build

# 서비스
cd services/core
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
WEB_DIST=../../apps/web/dist DATA_DIR=./data \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='바꿀-비밀번호' \
OPENAI_API_KEY=sk-... \
uvicorn app.main:app --port 8000
# 테스트
pytest -q
```

`OPENAI_API_KEY`가 없으면 편집국 공간의 실제 검토는 꺼지고, 시연 공간만 동작합니다.

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `OPENAI_API_KEY` | (없음) | 실제 검색과 판정에 쓰는 키 |
| `OPENAI_MODEL` | `gpt-5.4-mini` | 근거 정리·판정 모델 |
| `OPENAI_SEARCH_MODEL` | `OPENAI_MODEL` | 공개 자료 검색 모델 |
| `OPENAI_REASONING_EFFORT` | `low` | 추론 강도 (모델이 받지 않으면 자동으로 뺌) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | (없음) | 첫 관리자 계정. 이미 있으면 다시 만들지 않음 |
| `DATA_DIR` | `./data` | SQLite 위치. Render에서는 `/var/data` (유료 플랜이면 디스크) |
| `EPHEMERAL_STORAGE` | `0` | `1`이면 다시 시작할 때 기록이 지워진다는 안내를 화면에 띄움 |
| `DAILY_MODEL_CALL_LIMIT` | `600` | 하루 모델 호출 한도 (0이면 제한 없음) |
| `DAILY_SEARCH_CALL_LIMIT` | `150` | 하루 검색 호출 한도 |
| `OPEN_DOMAINS` | `go.kr,korea.kr,kosis.kr` | 본문을 저장할 수 있는 공개 도메인 |
| `RELATED_NEWS_LINKS` | `1` | 관련 보도 링크(본문 없이) 수집 여부 |
| `DEMO_ACCOUNTS` / `SEED_DEMO` | `1` | 시연 계정과 시연 기획 |
| `DEMO_RESET_ON_BOOT` | `1` | 부팅할 때 시연 공간을 새로 만듦 |
| `WRITES_PER_MINUTE` | `30` | 계정당 분당 쓰기 요청 한도 |

## 배포

`OPERATIONS.md`를 봅니다.
