# Docker 1.0.1

기존 Fastify/SQLite 서버를 AI 호출 없이 배포하기 위한 릴리스입니다. Supabase 함수 배포와는 별도입니다.

- 이미지: `devcksgur/ai-study-backend:1.0.1` (비공개)
- 대상 플랫폼: `linux/amd64`, `linux/arm64`
- 추가 설정: `AI_FEATURES_ENABLED=false`
- 새 배포 예시: AI 비활성화, SMTP 로그인·자료 관리 유지.
- 생성 요청: `503 AI_DISABLED`, AI 클라이언트 생성·외부 호출 차단.

레지스트리 업로드 결과와 digest는 빌드 완료 후 기록합니다. 실제 배포 서버 실행은 서버 정보가 없어 대기 중입니다. 실행 순서는 [SERVER_HANDOFF.md](SERVER_HANDOFF.md)를 참고하세요.
