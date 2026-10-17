# 운영 안내

## 처음 배포 (Render Blueprint)

1. Render 대시보드 → **New → Blueprint** → 이 저장소 선택.
2. `render.yaml`대로 웹 서비스 `audience-lab`(싱가포르, 무료 플랜)이 만들어집니다. 결제 수단이 필요 없습니다.
3. 값을 직접 넣는 칸 세 개:
   - `OPENAI_API_KEY`: OpenAI 키
   - `ADMIN_EMAIL`: 관리자 로그인 이메일
   - `ADMIN_PASSWORD`: 관리자 비밀번호 (무료 플랜에서는 서버가 켜질 때마다 이 값으로 관리자 계정을 다시 만듭니다. 충분히 긴 값을 넣으세요)
4. **Apply** → 빌드가 끝나면 `https://<서비스 이름>.onrender.com/health`가 `"status": "ok"`를 돌려줍니다.

### 무료 플랜에서 알아 둘 것

- 15분 동안 접속이 없으면 서버가 잠들고, 다음 접속 때 깨어나는 데 1분쯤 걸립니다.
- 저장 공간(디스크)이 없어 다시 시작·배포·잠들기 때마다 **초대한 계정, 기획, 보고서가 지워집니다.** 관리자 계정과 시연 공간은 켜질 때 다시 만들어집니다. 화면 위에도 이 안내가 나옵니다.
- 남겨야 할 결과는 보고서 파일(PDF·DOCX·JSON)로 받아 둡니다.

### 기록을 남기는 유료 플랜으로 바꾸기

`render.yaml`에서 `plan: 0.5c-512mb`(월 $7)로 바꾸고 `disk` 블록의 주석을 풀고(1GB 월 $0.25), `EPHEMERAL_STORAGE`를 `"0"`으로 바꿔 푸시합니다. Render 계정에 결제 수단이 있어야 합니다. 이후로는 관리자 비밀번호를 '내 계정'에서 바꿔도 유지됩니다.

이후 `main`에 푸시하면 자동으로 다시 배포됩니다. `homepage/`와 문서만 바뀐 푸시는 서비스를 다시 빌드하지 않습니다.

## 첫 점검

1. 관리자 계정으로 로그인합니다. (유료 플랜이면 '내 계정'에서 비밀번호를 바꿉니다.)
2. **구성원 관리 → 모델·검색 연결 확인**에서 '검색과 원문 받기까지 확인'을 누릅니다. 모델 호출, 공개 자료 검색, 이 서버가 정부 사이트 원문을 직접 받아 읽는지까지 한 번에 확인합니다.

같은 확인을 명령으로 하려면:

```bash
TOKEN=$(curl -s https://<서비스>.onrender.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<관리자 이메일>","password":"<비밀번호>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')
curl -s https://<서비스>.onrender.com/api/health/llm -H "Authorization: Bearer $TOKEN"
curl -s "https://<서비스>.onrender.com/api/health/llm?search=1" -H "Authorization: Bearer $TOKEN"
```

`ok: true`면 모델 호출이 되고, `search`·`fetch`가 각각 검색과 원문 받기 결과입니다. 실패하면 `error`에 원인(키, 한도, 모델 이름, 사이트 응답)이 나옵니다.

## 계정

- 관리자 → **구성원 관리**에서 이메일·이름·권한으로 계정을 만들면 임시 비밀번호가 한 번만 보입니다. 직접 전달합니다.
- 권한: 열람(읽기만), 편집(검토·과제·결과·보고서), 관리(계정 관리까지).
- 계정을 중지하면 그 계정의 로그인은 바로 끊깁니다. 만든 기록은 지우지 않습니다.

## 비용과 한도

- Render: 무료 플랜은 0원. 유료로 바꾸면 0.5c-512mb 월 $7 + 디스크 1GB 월 $0.25.
- OpenAI: 연결한 계정에 사용량만큼 청구됩니다. 하루 호출 한도는 `DAILY_MODEL_CALL_LIMIT`, `DAILY_SEARCH_CALL_LIMIT`로 정하고, 오늘 사용량은 구성원 관리 화면 아래에 나옵니다.
- 한 번의 근거 실행은 검색 몇 번과 정리·판정 호출 여러 번을 씁니다. 큰 초안은 문장 수만큼 판정이 늘어납니다.

## 모델 바꾸기

Render → 서비스 → **Environment**에서 `OPENAI_MODEL`(필요하면 `OPENAI_SEARCH_MODEL`)을 바꾸고 저장하면 다시 시작됩니다. 모델이 추론 강도 설정을 받지 않으면 서버가 자동으로 빼고 다시 부릅니다.

## 데이터

- 편집국 공간: `/var/data/audience-lab.db` (계정, 세션, 기획, 근거, 검토, 보고서 파일)
- 시연 공간: `/var/data/audience-lab-demo.db` (부팅할 때마다 새로 만듦)
- Render 디스크는 매일 스냅숏이 남습니다. 복원은 Render → 서비스 → Disks에서 합니다.

## 시연 공간

로그인 화면의 시연 계정 세 개(기자 A·에디터 B·열람자 C)는 가상의 청람시 자료만 다룹니다. 다른 제목의 기획은 검토하지 않고, 공개 자료 검색과 모델 호출을 쓰지 않습니다. 끄려면 `DEMO_ACCOUNTS=0`.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 화면 위에 "OpenAI 키가 설정되지 않아" | `OPENAI_API_KEY` 값, 다시 배포 여부 |
| 근거 실행이 `FAILED`, `MODEL_*` 코드 | `/api/health/llm` 결과, OpenAI 결제·한도 |
| 근거 실행이 `PARTIAL` | 일부 페이지를 받지 못함. 실행 상태 화면의 경고에 출처가 나옴 |
| `USAGE_LIMIT_REACHED` | 하루 한도 도달. 한도 값을 올리거나 다음 날 다시 |
| 주소에서 원문 가져오기 실패 | 허용 도메인인지, 스캔 PDF인지. 원문은 직접 붙여 넣어도 됨 |
