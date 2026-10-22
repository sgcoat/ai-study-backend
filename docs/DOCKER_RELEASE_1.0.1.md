# Docker 1.0.1

기존 Fastify/SQLite 서버를 AI 호출 없이 배포하기 위한 릴리스입니다. Supabase 함수 배포와는 별도입니다.

- 이미지: `devcksgur/ai-study-backend:1.0.1` (비공개)
- 대상 플랫폼: `linux/amd64`, `linux/arm64`
- 추가 설정: `AI_FEATURES_ENABLED=false`
- 새 배포 예시: AI 비활성화, SMTP 로그인·자료 관리 유지.
- 생성 요청: `503 AI_DISABLED`, AI 클라이언트 생성·외부 호출 차단.

## 업로드 확인

2026-10-22 GitHub Actions에서 빌드·업로드·manifest 조회가 성공했습니다.

- [성공한 Actions 실행](https://github.com/sgcoat/ai-study-backend/actions/runs/39782843787)
- 소스 커밋: `3e0abdff260f05bb48ca4c59752beb08e8fdc93a`
- 인덱스 digest: `sha256:9be451fa979a50475629d573c32f6320b164fb440d4cbef8ef0e8d0903f891a0`
- AMD64 manifest: `sha256:a72bb8e4514eb59f94a9ba5216e144282acff3566a4438382263f644030803c6`
- ARM64 manifest: `sha256:202adf2690e6e8e0a30de6f3604bd537affa002554f6035a502469c4248c215a`

동일한 이미지로 배포하려면 다음 값을 사용합니다.

```text
devcksgur/ai-study-backend@sha256:9be451fa979a50475629d573c32f6320b164fb440d4cbef8ef0e8d0903f891a0
```

실제 배포 서버 실행은 서버 정보가 없어 대기 중입니다. 이미지 빌드 성공은 SMTP·볼륨 유지·HTTPS가 서버에서 검증됐다는 의미가 아닙니다. 실행 순서는 [SERVER_HANDOFF.md](SERVER_HANDOFF.md)를 참고하세요.
