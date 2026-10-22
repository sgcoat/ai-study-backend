# Docker Hub 배포

## 구성

```text
Mac의 백엔드 소스 → GitHub 비공개 저장소 → GitHub Actions에서 빌드
                                              ↓
                         Docker Hub 비공개 이미지
                                              ↓
                  배포 서버의 Docker Compose → API + 영구 데이터
```

- GitHub: `sgcoat/ai-study-backend` (비공개)
- Docker Hub: `devcksgur/ai-study-backend` (비공개)
- 이미지: `linux/amd64`, `linux/arm64` 두 아키텍처. 일반 서버와 64비트 Raspberry Pi에 사용합니다.
- Mac에는 Docker를 설치하지 않아도 됩니다. **실제로 컨테이너를 실행할 서버에는 Docker Engine과 Compose 2.30.0 이상이 필요합니다.**
- API 키·SMTP 비밀번호·인증 서명 키는 배포 서버의 `server.env`에서만 입력합니다. GitHub와 이미지에 넣지 않습니다.
- GitHub Actions는 수동 실행입니다. 자동 배포·유료 서버 생성·도메인 연결은 하지 않습니다.

## 1. 소스 업로드

이 프로젝트 루트에서 `node server/scripts/export-backend.mjs`를 실행하면 `work/backend-publish/`에 업로드용 백엔드 저장소를 만듭니다. 기존 경로가 있으면 덮어쓰지 않습니다. 다른 경로는 `--output work/backend-publish-v2`로 지정합니다.

업로드 대상은 `server/src/`의 TypeScript 소스, 고정 의존성 파일, Dockerfile, 배포 예시·스크립트, 이 안내와 Actions 워크플로입니다. 앱 소스·실제 환경 파일·DB·업로드 사진·빌드 결과·개발 기록은 제외합니다. 허용 목록에 없는 파일과 심볼릭 링크는 복사하지 않습니다.

아래는 GitHub 명령줄 인증이 완료된 경우에만 실행합니다. 브라우저 로그인과 Git 명령줄 인증은 별개입니다. 비밀번호나 토큰을 원격 URL에 넣지 마세요.

```sh
cd work/backend-publish
git init -b main
git add .
git diff --cached --stat
git commit -m "Package backend for Docker Hub deployment"
git remote add origin https://github.com/sgcoat/ai-study-backend.git
git push -u origin main
```

GitHub 계정 인증이 필요하면 공식 GitHub CLI의 `gh auth login --hostname github.com --git-protocol https --web`과 `gh auth setup-git`을 사용하거나, GitHub Desktop에서 이 폴더를 추가해 같은 비공개 저장소로 업로드합니다. 로그인·권한 승인은 사용자가 직접 진행합니다.

## 2. Docker Hub 토큰 등록

1. Docker Hub의 `devcksgur` 계정에서 Personal access token을 직접 만듭니다. 이미지 push에 필요한 Read & Write 권한과 만료 기간을 선택합니다. Delete 권한은 필요하지 않습니다.
2. GitHub의 `sgcoat/ai-study-backend` → Settings → Secrets and variables → Actions → New repository secret을 엽니다.
3. 이름을 **`DOCKERHUB_TOKEN`**으로 하고 값에 토큰을 직접 붙여 넣습니다. 토큰은 채팅·소스·워크플로 파일에 넣지 않습니다.
4. 워크플로는 사용자명 `devcksgur`를 사용합니다. 계정을 변경하면 `.github/workflows/publish-backend.yml`의 이미지 이름과 로그인 사용자명을 함께 바꿉니다.

GitHub 비공개 저장소의 Actions 사용량·예산과 Docker Hub 저장소 한도를 계정에서 확인한 뒤 실행하세요. 무료 포함량을 초과하는 유료 사용은 별도 동의 없이 진행하지 않습니다.

## 3. 클라우드 빌드와 업로드

GitHub → Actions → **Publish backend to Docker Hub** → Run workflow에서 새 버전 태그(첫 배포 `1.0.0`)를 입력합니다.

워크플로는 소스 체크아웃 → Docker Hub 로그인 → 두 아키텍처 빌드·push → 이미지 manifest 확인을 수행합니다. 실행이 성공하면 Summary에 다음 정보가 남습니다.

```text
devcksgur/ai-study-backend:1.0.0
devcksgur/ai-study-backend@sha256:<실제 digest>
```

태그는 배포마다 새 값을 사용합니다. 배포 설정에는 성공한 실행의 **실제 digest**를 쓰면 같은 이미지를 정확히 지정할 수 있습니다. `sha256:<실제 digest>`는 설명용이며 그대로 실행할 값이 아닙니다. Docker Hub에서도 태그와 두 플랫폼이 표시되는지 확인합니다. 워크플로 실패만으로 업로드가 전혀 없었다고 판단하지 말고 해당 태그도 확인하세요.

이 워크플로는 이미지를 올리기만 합니다. API를 실행하거나 기존 로컬 서버·DB를 변경하지 않습니다.

## 4. 배포 서버에서 실행

배포 서버에 `server/deploy/docker/` 폴더를 복사합니다. 다음 명령은 그 **배포 서버**에서 실행합니다. 비공개 이미지 pull을 위해 해당 서버도 Docker Hub 로그인이 필요합니다. 가능하면 서버에는 읽기 전용 토큰을 사용합니다.

```sh
cd server/deploy/docker
bash prepare.sh --image devcksgur/ai-study-backend:1.0.0
docker login --username devcksgur
```

생성된 `server.env`에 Gemini·SMTP 값을 직접 입력한 다음 시작합니다. 기존 로컬 `server/.env`를 자동 복사하지 않으므로 별도로 설정해야 합니다.

| 파일 | 용도 |
| --- | --- |
| `.env` | 이미지 버전, 로컬 바인딩 포트, 도메인 등 Compose 설정 |
| `server.env` | 실제 Gemini·SMTP 비밀 값, AUTH_SECRET 등 서버 환경 변수 |
| `compose.yaml` | 비공개 이미지 실행, 영구 저장소, 재시작·상태 조회 |
| `compose.https.yaml` | 도메인이 준비된 뒤 Caddy HTTPS 추가 |

`prepare.sh`는 없는 파일만 만들고 `AUTH_SECRET`을 무작위 생성합니다. 기존 파일과 키를 덮어쓰지 않습니다. `server.env`는 Compose의 raw 형식이므로 값에 따옴표를 추가하지 마세요. 공백·`$`도 원래 값 그대로 입력합니다. 파일을 공유하거나 Git에 추가하지 마세요.

전체 앱은 `SERVER_MODE=full`, `EMAIL_PROVIDER=smtp`, `AI_PROVIDER=gemini` 및 유효한 Gemini 키·모델이 필요합니다. 모델 이름은 계정에서 사용 가능한 값으로 바꿀 수 있습니다. 인증만 배포하려면 `SERVER_MODE=auth`로 바꾸지만 이 모드에는 자료 API가 없습니다. 운영 모드에서 개발용 mock AI/console 이메일은 허용하지 않습니다.

```sh
docker compose pull
docker compose up -d --wait
docker compose ps
curl --fail http://127.0.0.1:3000/health
```

처음에는 API가 배포 서버의 `127.0.0.1:3000`에만 열립니다. 기존 API와 포트가 겹치면 `.env`의 `API_PORT`를 바꾸고 상태 조회 포트도 맞춥니다. 이 상태의 localhost 주소는 iPhone 연결 주소가 아닙니다.

## 5. 실제 도메인으로 HTTPS 연결

실제 API 도메인과 배포 서버가 준비되면 DNS를 서버에 연결하고 서버의 80·443 포트를 허용합니다. `.env`의 `APP_DOMAIN`에 `https://`와 경로 없이 호스트명을 입력합니다. 가정한 도메인을 코드에 고정하지 않습니다.

```sh
docker compose -f compose.yaml -f compose.https.yaml pull
docker compose -f compose.yaml -f compose.https.yaml up -d --wait
docker compose -f compose.yaml -f compose.https.yaml ps
```

기본 전용 네트워크가 다른 서버 네트워크와 겹치면 `.env`의 `DOCKER_SUBNET`과 `CADDY_PROXY_IP`를 같은 새 대역으로 함께 바꿉니다. Caddy의 고정 IP만 신뢰할 프록시로 지정합니다. Caddy 인증서 데이터도 영구 볼륨에 저장합니다.

앱은 실제 주소 `https://<API 도메인>/api/v1`을 사용합니다. 이 프로젝트에서는 `pnpm server:connect --url https://<API 도메인>/api/v1`로 앱 연결을 설정하고 Expo를 재시작합니다. 꺾쇠 표시는 실제 값으로 바꿉니다.

## 데이터·업데이트·복구

- SQLite와 첨부 이미지는 `api-data` 볼륨의 `/data`에 보관합니다. 새 서버의 첫 실행은 빈 데이터로 시작하며 로컬 DB·사진은 자동 이전하지 않습니다.
- API는 단일 인스턴스만 실행합니다. SQLite와 작업 워커를 여러 컨테이너로 확장하는 구성은 지원하지 않습니다.
- 정상 종료는 SIGTERM을 처리하고 45초 유예를 줍니다. 처리 중이던 AI 작업의 재개 정책은 기존 서버 정책을 따릅니다.
- 업데이트 전에 서버를 중지한 상태에서 DB와 사진을 함께 백업하세요. 실행 중 SQLite 파일 하나만 복사하는 방법은 사용하지 않습니다. 백업은 Git·레지스트리와 별도로 보호합니다.
- 업데이트는 `.env`의 `BACKEND_IMAGE`만 새 태그/digest로 바꾸고 같은 디렉터리에서 `docker compose pull`, `docker compose up -d --wait`을 실행합니다. 기존 `AUTH_SECRET`, Compose 프로젝트 이름과 볼륨을 유지합니다.
- 이전 이미지 digest로 돌아갈 수 있지만 DB 마이그레이션 역변환은 보장하지 않습니다. DB 형식이 바뀌면 해당 버전의 백업 복원 절차가 필요합니다.
- `docker compose down --volumes`는 DB·사진을 삭제하므로 일반 종료·업데이트에 사용하지 않습니다.
- 문제 확인은 `docker compose ps`, `docker compose logs --tail=100 api`로 합니다. 로그를 공유하기 전 민감한 값이 없는지 확인합니다.

## 준비·확인 범위

Dockerfile은 Node 24의 다단계 빌드, 일반 사용자 실행, `/health` 상태 조회를 사용합니다. 빌드 문맥은 `.dockerignore` 허용 목록으로 제한했습니다. Compose는 읽기 전용 루트, 데이터 볼륨, 제한된 로그와 재시작 정책을 사용합니다.

로컬에서 서버 TypeScript 빌드, 스크립트 문법, YAML 문법, 업로드 명령 미리보기를 확인했습니다. Mac에 Docker가 없어 실제 이미지 빌드·컨테이너 실행·Compose 의미 검증은 아직 수행하지 않았습니다. 이미지 업로드 완료는 GitHub Actions 성공과 레지스트리 태그/digest 확인 후 판단합니다. 실제 배포 서버·도메인 연결은 별도 단계입니다.

## 공식 문서

- [Docker의 GitHub Actions 빌드](https://docs.docker.com/build/ci/github-actions/)
- [GitHub Actions 멀티 플랫폼 빌드](https://docs.docker.com/build/ci/github-actions/multi-platform/)
- [Compose 서비스 설정과 raw 환경 파일](https://docs.docker.com/reference/compose-file/services/)
- [Docker Hub 비공개 저장소](https://docs.docker.com/docker-hub/repos/create/)
- [GitHub CLI 로그인](https://cli.github.com/manual/gh_auth_login)
