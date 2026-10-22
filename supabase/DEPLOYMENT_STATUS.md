# 클라우드 API 배포 상태

기준일: 2026-10-22. 대상: `ai-study-backend` / `jqhivsrfrkycfjefgoam` / Supabase Free.

## 반영한 내용

- Postgres의 비공개 `study` 스키마와 모든 테이블의 RLS 설정.
- `ai-study-materials` 비공개 Storage 버킷.
- `ai-study-api`, `ai-study-worker` 함수의 소스 배포.
- 사용자의 명시적인 승인에 따른 API의 앱 세션 인증 전환. API의 legacy JWT 검증 OFF, 작업 실행 함수는 ON.
- Reauthentication 이메일 제목·본문 저장 후 새로고침과 미리보기로 확인.
- 서버 설정 `AI_PROVIDER=mock`, `ACCOUNT_DELETION_ENABLED=true` 저장.
- `/api/v1/health`에서 `status=ok`, `platform=supabase`, `schemaVersion=2`, `accountDeletionEnabled=true` 확인.
- 루트 `.env`의 공개 API 주소를 클라우드로 변경. 이전 환경 파일을 `work/cloud-env-backups/`에 보관.
- `pnpm dev:cloud`, `pnpm cloud:connect`, `pnpm cloud:typecheck`, `pnpm cloud:bundle` 명령 추가.

## DB 적용 순서

1. `202610220001_cloud_api.sql`: 테이블·서버 전용 RPC·비공개 버킷 생성.
2. `202610220002_account_reauthentication.sql`: 로그인 코드와 구분하는 삭제 재인증.
3. `202610220003_account_delete_lock_order.sql`: Auth의 FK 삭제와 자료 쓰기의 잠금 순서 조정.

세 번째 보완은 API 계약을 변경하지 않으므로 준비 응답의 계약 버전은 2입니다. 대시보드 SQL Editor로 적용했습니다. CLI 마이그레이션 이력은 향후 CLI 연결 시 이미 적용한 위 버전을 등록해야 합니다.

## 빌드 확인

| 확인 항목 | 결과 |
| --- | --- |
| 클라우드 소스 TypeScript 검사 | 통과 |
| Expo 앱 TypeScript 검사 | 통과 |
| 대시보드 배포용 번들 생성 | 완료 |
| 앱 연결·실행 보조 스크립트 문법 | 통과 |
| DB 생성·함수 배포 결과 | 대시보드에서 확인 |
| 클라우드 API 준비 응답 | 정상 |

## 다음 점검에서 확인할 범위

새 클라우드 API를 통한 OTP 발송·코드 검증·앱 세션 복원·사진 업로드·자료 CRUD·AI 작업·답안 제출·계정 삭제의 실제 전체 흐름은 이번 배포 단계에서 실행하지 않았습니다. 이전 SMTP 단계에서는 사용자가 승인한 인증 메일 1회가 실제 도착했고 6자리임을 확인했습니다. 이번 단계에서는 추가 메일을 보내거나 사용자를 삭제하거나 실제 AI를 호출하지 않았습니다. 자동 테스트도 실행하지 않았습니다.

실제 Gemini 키는 아직 클라우드에 설정하지 않았습니다. 현재 생성 결과는 예시 서비스이며 이미지 OCR과 의미 기반 채점을 수행하지 않습니다. 기존 로컬 SQLite 자료·사진·계정 ID별 임시 저장본은 별도 이전 대상입니다.

## 관련 자료

- [실행·배포·가정·변경 위치](DEPLOYMENT.md)
- [SMTP·OTP 수신 확인 결과](SMTP_SETUP_RESULT.md)
- [API 준비 응답](https://jqhivsrfrkycfjefgoam.supabase.co/functions/v1/ai-study-api/api/v1/health)
- [배포 함수 목록](https://supabase.com/dashboard/project/jqhivsrfrkycfjefgoam/functions)
