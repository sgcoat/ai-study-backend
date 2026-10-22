# 백엔드 Docker 이미지 1.0.0

## 확인된 결과

- 완료일: 2026-10-22 (한국 시간)
- GitHub 비공개 저장소: [sgcoat/ai-study-backend](https://github.com/sgcoat/ai-study-backend)
- 빌드 소스 커밋: `65754a4634bfbb7b4d7b61ad5a9403600d5a6259`
- GitHub Actions: [빌드·업로드 성공](https://github.com/sgcoat/ai-study-backend/actions/runs/39741653145), 작업 소요 2분 40초
- Docker Hub 비공개 저장소: [devcksgur/ai-study-backend](https://hub.docker.com/repository/docker/devcksgur/ai-study-backend/tags)
- 이미지 태그: `devcksgur/ai-study-backend:1.0.0`
- 지원 플랫폼: `linux/amd64`, `linux/arm64`
- 인덱스 digest: `sha256:2ac34ce8b44b8aecbc43bc07d982337d630e8650f2b283120bdd286bc6983f22`

위 digest는 두 플랫폼을 포함하는 이미지 인덱스입니다. 배포 서버는 자신의 아키텍처에 맞는 이미지를 선택합니다. Docker Hub에서 플랫폼별로 표시하는 개별 manifest digest와 구별합니다.

Mac에 Docker를 설치하지 않고 GitHub Actions에서 빌드했습니다. 실제 API 서버는 아직 배포하지 않았으며 새 서버의 SMTP·Gemini 호출·볼륨 유지 동작도 아직 확인하지 않았습니다. DB와 사진은 이미지에 포함하지 않았습니다.

## 배포 서버에서 실행할 명령

배포 서버에는 Docker Engine, Compose 2.30.0 이상, Git과 OpenSSL이 필요합니다. 아래 명령은 Mac이 아닌 **실제로 API를 실행할 서버**에서 사용합니다. 비공개 GitHub 저장소 접근 인증도 필요합니다. 소스 전체를 받을 필요가 없다면 `server/deploy/docker/` 폴더만 서버로 복사해도 됩니다.

```sh
git clone https://github.com/sgcoat/ai-study-backend.git
cd ai-study-backend/server/deploy/docker
bash prepare.sh --image devcksgur/ai-study-backend@sha256:2ac34ce8b44b8aecbc43bc07d982337d630e8650f2b283120bdd286bc6983f22
```

생성된 `server.env`를 서버에서 직접 편집해 다음 값을 채웁니다.

- `GEMINI_API_KEY`: 실제 Gemini 키. `AI_PROVIDER=gemini`를 사용합니다.
- `GEMINI_MODEL`: 해당 키에서 사용 가능한 모델.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`: 실제 발신 설정.
- `AUTH_SECRET`은 준비 스크립트가 생성한 값을 유지합니다.

예시 파일의 빈 키로는 전체 API의 production 모드를 시작할 수 없습니다. 실제 비밀 값은 GitHub에 저장하거나 이미지 빌드 인자로 전달하지 않습니다. GitHub의 `DOCKERHUB_TOKEN`은 이미지 업로드용이며 Gemini·SMTP 키와 별개입니다.

설정이 끝나면 실행합니다. Docker Hub 로그인에는 가능하면 별도의 읽기 전용 토큰을 사용합니다.

```sh
docker login --username devcksgur
docker compose pull
docker compose config --quiet
docker compose up -d --wait
docker compose ps
curl --fail http://127.0.0.1:3000/health
```

기본 API 바인딩은 서버의 localhost입니다. 실제 iPhone 앱에서 사용할 주소·HTTPS 도메인은 서버가 정해진 뒤 연결합니다. 기존 로컬 앱·API 설정은 이 배포 작업에서 변경하지 않았습니다.

Compose 파일·HTTPS·영구 데이터·업데이트 절차는 [Docker 배포 안내](DOCKER_DEPLOYMENT.md)를 참고하세요. 새 서버의 데이터 볼륨은 비어 있는 상태로 시작합니다. 기존 로컬 DB·사진의 이전은 별도 작업입니다.
