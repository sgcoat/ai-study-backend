# Docker 서버 배포 인계

2026-10-22: 학교 서버 주소·SSH 계정·폴더·도메인이 아직 없어 원격 서버 기동은 진행하지 않았습니다. 현재 앱은 Supabase API를 사용합니다. 이 문서는 별도 Node/SQLite 백엔드를 서버에서 실행할 때 사용합니다. Supabase의 Auth·DB·Storage와 Docker의 SQLite·업로드 볼륨은 서로 다른 저장소이며 자동 동기화되지 않습니다.

## 서버 관리자에게 받을 정보

- 서버 주소, SSH 사용자명·포트, 배포할 폴더, 기존 프록시 사용 여부.
- 사용할 API 도메인과 DNS 수정 권한, 80·443 포트 공개 가능 여부.
- Docker Engine·Compose 2.30 이상 사용 권한, 영구 볼륨과 백업 보관 위치.
- SMTP 발신 설정을 서버 환경 변수에 직접 입력할 담당자.

비밀번호·개인 키·SMTP 비밀번호는 대화나 GitHub에 올리지 않습니다. 학교 서버의 `dyhs.kr` 도메인을 사용할 수 있는지는 서버 관리자에게 확인해야 합니다.

## AI를 제외하고 실행

`1.0.1` 이상 이미지의 배포 예시는 `AI_FEATURES_ENABLED=false`입니다. 로그인·내 정보·자료·사진·수정·삭제 API를 사용할 수 있고, 새 요약·문제 생성은 `503 AI_DISABLED`를 반환합니다. 외부 AI를 호출하지 않으며 키가 필요하지 않습니다. SMTP는 별도로 설정해야 합니다. 실제 AI를 켜는 작업은 이번 범위에서 제외합니다.

배포 서버에서 실행합니다. GitHub 저장소와 Docker 이미지가 비공개이므로 각 서비스의 읽기 권한으로 로그인해야 합니다.

```sh
git clone https://github.com/sgcoat/ai-study-backend.git
cd ai-study-backend/server/deploy/docker
bash prepare.sh --image devcksgur/ai-study-backend@sha256:9be451fa979a50475629d573c32f6320b164fb440d4cbef8ef0e8d0903f891a0
docker login --username devcksgur
```

생성된 `server.env`의 SMTP 항목을 서버에서 직접 입력합니다. `AUTH_SECRET`은 준비 스크립트가 만든 값을 유지합니다. 기존 `server.env`가 있으면 준비 스크립트가 덮어쓰지 않으므로 `AI_FEATURES_ENABLED=false`와 `AI_PROVIDER=mock`을 직접 확인합니다. 예전 `1.0.0` 이미지는 이 비활성화 플래그를 지원하지 않습니다.

```sh
docker compose pull
docker compose config --quiet
docker compose up -d --wait
docker compose ps
curl --fail http://127.0.0.1:3000/health
```

건강 응답의 `aiProvider`는 `disabled`, `serverMode`는 `full`이어야 합니다. 위 주소는 서버 내부 주소이므로 앱에 입력하지 않습니다. `docker compose config`의 전체 출력은 비밀 값을 포함할 수 있어 `--quiet`만 사용합니다.

## HTTPS와 앱 전환

도메인 DNS를 서버에 연결한 뒤 `.env`의 `APP_DOMAIN`을 실제 도메인으로 설정합니다. 기존 학교 프록시가 있다면 관리자에게 연결을 요청하고, 없으면 제공된 Caddy 구성을 사용합니다.

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --wait
```

새 API의 실제 HTTPS 주소가 확인된 뒤 프론트 `eas.json`의 base 프로필에 `https://실제_API_도메인/api/v1`을 설정합니다. 개발 `.env`도 같은 주소와 `http` 모드로 변경하고 Expo를 재시작합니다. Supabase 세션은 Docker 서버에서 유효하지 않으므로 재로그인이 필요합니다. 현재 Supabase 연결은 서버가 준비되기 전까지 유지합니다.

DB·사진은 `api-data` 영구 볼륨에 저장됩니다. 업데이트 전에 서버를 정상 종료한 상태로 DB와 사진을 함께 백업합니다. 일반 종료·업데이트에 `docker compose down --volumes`를 사용하지 않습니다. 상세 구성은 [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md)를 참고하세요.
