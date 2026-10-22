# AI Study Backend

Fastify + TypeScript + SQLite. Node.js 24 이상을 사용합니다.

- 비공개 Docker Hub 이미지: `devcksgur/ai-study-backend`
- GitHub Actions에서 수동으로 AMD64·ARM64 이미지를 빌드하고 업로드합니다.
- GitHub Actions secret `DOCKERHUB_TOKEN`을 먼저 설정하세요.
- [빌드·배포 안내](docs/DOCKER_DEPLOYMENT.md)
- [1.0.0 업로드 결과와 확정 이미지](docs/DOCKER_RELEASE_1.0.0.md)
- [Dockerfile](server/Dockerfile), [Docker Compose](server/deploy/docker/compose.yaml)

API 키와 SMTP 설정은 배포 서버의 `server.env`에 직접 입력합니다. 소스·이미지에는 포함하지 않습니다.
이 저장소는 앱 프로젝트에서 내보낸 백엔드 전용 소스입니다. 로컬 앱 개발 명령과 앱 파일은 포함하지 않습니다.
