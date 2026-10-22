# 카드 등록 없는 클라우드 API

## 클라우드 API 구현·배포

`ai-study-api`와 `ai-study-worker`, Postgres 및 비공개 사진 버킷을 추가했습니다. 앱 연결은 Supabase 주소를 사용하는 `pnpm dev:cloud`로 실행합니다. [구조·실행·배포 방법](DEPLOYMENT.md), [현재 배포와 확인 범위](DEPLOYMENT_STATUS.md)를 참고하세요. API 함수는 사용자가 승인한 앱 세션 검증을 사용하고, 작업 실행 함수는 서버 JWT와 서버 키를 검증합니다.

## SMTP·OTP 설정 완료

2026-10-22에 Supabase Custom SMTP 저장 상태를 새로고침 후 확인했고, 신규 가입·로그인 이메일 템플릿과 OTP 6자리·만료 300초를 설정했습니다. 사용자 승인을 받아 본인 이메일로 인증 코드 1회를 요청해 HTTP 200을 확인했고, 사용자가 실제 메일 도착과 6자리 코드를 확인했습니다. [설정 결과·확인 범위](SMTP_SETUP_RESULT.md)를 참고하세요.

## 생성된 프로젝트

| 서비스 | 프로젝트 | 상태 |
| --- | --- | --- |
| Supabase | `ai-study-backend` / `jqhivsrfrkycfjefgoam` | Free 조직, 서울, Healthy 확인 |
| Firebase | `AI Study` / `ai-study-97811` | Spark, 무료($0/월) 확인 |

- [Supabase 대시보드](https://supabase.com/dashboard/project/jqhivsrfrkycfjefgoam)
- [Supabase SMTP](https://supabase.com/dashboard/project/jqhivsrfrkycfjefgoam/auth/smtp)
- [Firebase 프로젝트](https://console.firebase.google.com/project/ai-study-97811/overview)
- Supabase 프로젝트 주소: `https://jqhivsrfrkycfjefgoam.supabase.co`

이 문서의 프로젝트 ID·주소는 비밀 키가 아닙니다. DB 비밀번호, SMTP 앱 비밀번호와 서버용 키는 저장소에 넣지 않습니다.

## 무료 구성의 범위

서버 API·Postgres·사진 저장소는 Supabase Free의 Edge Functions·Database·Storage를 사용합니다. Firebase는 Spark 범위에서 준비했습니다. Firebase의 Cloud Functions/Cloud Run은 결제 계정이 필요하므로 이번 무료 구성에서는 사용하지 않습니다. 현재 네이티브 Expo 앱은 Firebase Hosting에 올리는 웹사이트가 아닙니다.

로컬 Fastify API는 SQLite와 로컬 사진 저장소, 프로세스 내부 작업 워커를 사용합니다. 클라우드에는 기존 앱 API 형식을 유지하는 별도 Edge API와 영구 작업 저장을 구현했습니다. Docker Hub의 `1.0.0` 이미지를 Supabase에 그대로 실행하는 구성은 아닙니다. 앱의 공개 API 주소를 클라우드로 설정했고 이전 환경 파일은 로컬 `work/cloud-env-backups/`에 보관했습니다.

## SMTP 설정

1. 발신 Gmail 계정의 [앱 비밀번호](https://myaccount.google.com/apppasswords)를 직접 발급합니다. 일반 Google 로그인 비밀번호를 사용하지 않습니다.
2. 위 Supabase SMTP 화면에서 아래와 같이 설정합니다.

| 항목 | 값 |
| --- | --- |
| Enable custom SMTP | 켬 |
| Sender email address | 본인 발신 Gmail 주소 |
| Sender name | `AI Study` |
| Host | `smtp.gmail.com` |
| Port number | `465` |
| Username | Sender email address와 같은 Gmail 주소 |
| Password | 발급한 16자리 앱 비밀번호, 표시용 공백 제거 |

새 인증 정보의 발급·입력·저장은 사용자가 직접 진행합니다. `Save changes` 이후 저장 상태를 확인합니다. 저장 성공은 SMTP 인증·실제 수신 성공과 다릅니다. 받은편지함 수신은 승인된 수신자에게 실제 코드 요청 후 확인합니다.

2026-10-22에 기존 로컬 SMTP 설정으로 메일 발송 없는 연결·인증 확인을 시도했고 인증 실패를 확인했습니다. 앱 비밀번호의 표시용 공백을 제거한 값으로도 인증에 실패했습니다. 이후 사용자가 Supabase에 새 자격 증명을 직접 저장했고, Supabase를 통한 인증 메일 수신을 확인했습니다. 기존 로컬 환경 파일에는 새 SMTP 비밀번호를 복사하지 않았습니다.

## 6자리 OTP 이메일 템플릿

Authentication → Emails → Templates에서 다음 두 템플릿에 `email-templates/otp.html`의 전체 코드를 적용하고 저장했습니다.

- **Confirm sign up:** 제목 `AI Study 이메일 인증 코드`
- **Magic link or OTP:** 제목 `AI Study 로그인 인증 코드`

두 템플릿 모두 `{{ .Token }}`을 표시합니다. `{{ .ConfirmationURL }}`만 사용하는 기본 템플릿은 링크를 보내므로 앱의 코드 입력 흐름과 다릅니다. 신규 사용자와 기존 사용자 템플릿을 모두 설정해야 합니다.

Authentication → Sign In / Providers → Email에서 기본 OTP 8자리·만료 3600초를 확인했습니다. 만료 시간을 300초로 저장했고, 자리수 변경은 사용자의 명시적인 승인을 받은 뒤 6자리로 저장했습니다. 설정 창을 다시 열어 6자리·300초 값을 확인했습니다. 재전송 간격은 변경하지 않았습니다.

`scripts/request-login-code.mjs`는 승인받은 이메일로 실제 인증 메일을 한 번 요청하는 진단 도구입니다. `SUPABASE_PUBLISHABLE_KEY`에 프로젝트의 공개 publishable 키를 넣고 `--email <승인된 주소> --send`를 명시해야 합니다. 비밀 키·service-role 키는 받지 않으며, 실패·타임아웃 시 자동으로 재발송하지 않습니다. 정상 응답만으로 받은편지함 도착을 판단하지 않습니다.

## 이어서 필요한 작업

1. Expo를 클라우드 연결로 재시작한 뒤 로그인·자료 저장의 실제 앱 흐름 확인.
2. 필요한 기존 로컬 자료의 별도 이전과 사용자 ID 매핑.
3. 실제 Gemini 이용 시 서버 키·모델·무료 사용 범위 설정과 생성 흐름 확인.

기존 로컬 데이터는 새 프로젝트로 자동 복사하지 않았습니다. 클라우드 새 로그인에서 보이는 자료는 새 Postgres에 저장한 자료입니다.

## 공식 문서

- [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase 이메일 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase Edge Functions 제한](https://supabase.com/docs/guides/functions/limits)
- [Firebase Functions 배포와 Blaze](https://firebase.google.com/docs/functions/)
