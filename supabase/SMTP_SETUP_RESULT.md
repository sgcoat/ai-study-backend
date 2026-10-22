# Supabase SMTP·OTP 설정 결과

확인일: 2026-10-22 (한국 시간)

## 완료한 설정

| 항목 | 결과 |
| --- | --- |
| 프로젝트 | `ai-study-backend` / `jqhivsrfrkycfjefgoam` |
| 요금제 | 기존 Free 조직의 프로젝트 |
| Custom SMTP | 사용자 직접 저장 후 페이지 새로고침으로 활성 상태·저장된 비밀번호 표시 확인 |
| SMTP 서버 | `smtp.gmail.com:465` |
| 발신 이름 | `AI Study` |
| Confirm sign up 제목 | `AI Study 이메일 인증 코드` |
| Magic link or OTP 제목 | `AI Study 로그인 인증 코드` |
| 이메일 본문 | `email-templates/otp.html`의 `{{ .Token }}` 표시 |
| OTP 길이 | 기본 8자리에서 사용자 승인 후 6자리로 저장 |
| OTP 만료 | 기본 3600초에서 300초로 저장 |
| 설정 재조회 | 이메일 provider 설정 창을 다시 열어 6자리·300초 확인 |
| 실제 발송 요청 | 승인받은 본인 이메일로 1회, Supabase `/auth/v1/otp` HTTP 200 |
| 실제 수신 | 사용자: “메일이 도착했고 6자리예요” 확인 |

SMTP 비밀번호, 인증 코드, 세션 토큰과 수신 이메일 주소는 이 문서에 기록하지 않았습니다. SMTP 비밀번호는 사용자가 Supabase에 직접 입력했습니다. 발송 도구는 프로젝트의 공개 publishable 키만 사용했으며 SMTP 비밀번호를 읽지 않았습니다.

## 확인 범위

SMTP 저장 상태, 신규 가입·로그인 템플릿 저장과 미리보기, OTP 설정, 실제 이메일 수신·6자리 표시까지 확인했습니다. Supabase OTP를 제출해 세션을 발급받는 검증은 아직 하지 않았습니다. 새 SMTP 비밀번호는 기존 로컬 `server/.env`에 자동 복사하지 않았습니다.

현재 Expo 앱은 기존 로컬 API를 사용합니다. 이번 수신 확인 코드를 로컬 로그인 화면에서 검증하는 구성은 아닙니다. Supabase API·세션 처리와 데이터 저장소를 구현한 뒤 앱의 API 주소를 전환해야 합니다.

## 재사용할 파일

- `email-templates/otp.html`: 두 인증 이메일에 적용한 전체 HTML.
- `scripts/request-login-code.mjs`: 수신자 승인 후 실제 인증 메일을 1회 요청하는 도구. 자동 재시도 없음.
- `projects.json`: 비밀 값이 없는 프로젝트 ID·주소.

## 다음 작업

앱이 호출하는 `/auth/login`, `/auth/verify`, `/users/me` 계약을 Supabase API에 연결하고, 세션 보관·자동 로그인·로그아웃·401 처리와 자료 소유권을 함께 이전합니다. 그 뒤 Postgres·비공개 Storage·비동기 AI 작업을 이전하고 클라우드 주소로 앱을 연결합니다.
