# AI Study Backend

학습 자료 앱의 백엔드 소스입니다. 이메일 코드 인증과 자료·사진·요약·문제·풀이 API 계약을 제공합니다. 실제 AI 연결 작업은 현재 배포 범위에서 제외합니다.

- 프론트: https://github.com/sgcoat/ai-study-frontend (비공개)
- 백엔드: https://github.com/sgcoat/ai-study-backend (비공개)
- Docker Hub: `devcksgur/ai-study-backend` (비공개, AMD64·ARM64)

## 현재 사용하는 클라우드

Supabase Free에 API·Auth·Postgres·비공개 Storage·작업 함수를 배포했습니다.

```text
https://jqhivsrfrkycfjefgoam.supabase.co/functions/v1/ai-study-api/api/v1
```

소스는 `supabase/functions/`, SQL은 `supabase/migrations/`에 있습니다. 현재 실제 AI는 연결하지 않았으며 기존 예시 모드를 유지합니다. [클라우드 배포 안내](supabase/DEPLOYMENT.md)와 [확인 범위](supabase/DEPLOYMENT_STATUS.md)를 참고하세요. 이 저장소만 받은 경우 서버 의존성을 설치한 뒤 다음 명령으로 클라우드 소스를 준비합니다.

```sh
pnpm --dir server install --frozen-lockfile
pnpm --dir server exec tsc -p ../supabase/tsconfig.json
node supabase/scripts/bundle-functions.mjs
```

앱 실행 명령은 프론트 저장소의 `pnpm dev:cloud`입니다. 서버 저장소의 앱 연결 도우미는 원본 통합 작업 폴더와의 소스 동기화용이며 단독 백엔드에서 Expo를 실행하지 않습니다. 기존 마이그레이션은 대시보드에서 적용했으므로 새 DB에 적용할 때와 기존 DB의 CLI 이력을 연결할 때를 구분합니다.

## Docker 서버 배포 준비

`server/`는 Node.js 24 + Fastify + SQLite 서버입니다. GitHub Actions에서 Docker 이미지를 빌드해 Docker Hub에 올리고, 배포 서버에서 Compose로 실행합니다. Mac의 Docker 설치는 필요하지 않습니다.

- [Docker 배포 안내](docs/DOCKER_DEPLOYMENT.md)
- [AI 제외 서버 실행·학교 서버 인계](docs/SERVER_HANDOFF.md)
- [Dockerfile](server/Dockerfile)
- [Compose](server/deploy/docker/compose.yaml)

`1.0.1` 이상 배포 예시는 `AI_FEATURES_ENABLED=false`로 실제 AI 키 없이 로그인·자료 관리 API를 실행합니다. SMTP 비밀 값은 서버의 `server.env`에 직접 입력합니다. 새 AI 생성은 `503 AI_DISABLED`로 거부합니다. `1.0.0`은 이 비활성화 플래그를 지원하지 않습니다.

Supabase 배포와 Docker 배포는 별도입니다. Compose 서버는 아직 확보되지 않았으며, Supabase 자료·사진·계정은 Docker 볼륨으로 자동 이전되지 않습니다. 공개 API 주소를 바꾸기 전 데이터 이전과 재로그인을 계획해야 합니다.

## 이미지 업로드

GitHub Actions의 **Publish backend to Docker Hub**를 수동 실행하며 버전마다 새 태그를 사용합니다. `DOCKERHUB_TOKEN` 저장소 secret이 필요합니다. 이 워크플로는 이미지를 업로드하고 서버를 자동 생성하거나 배포하지 않습니다.

실제 `.env`, SMTP·AI·서명 키, DB, 사진, 빌드 결과는 Git과 이미지에서 제외합니다. `server/.env.example`과 `server/deploy/docker/server.env.example`에는 항목 이름과 공개 예시만 있습니다.
