#!/usr/bin/env bash
set -euo pipefail
umask 077

deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
image=''
domain=''

usage() {
  cat <<'TEXT'
Usage: bash prepare.sh --image devcksgur/ai-study-backend:1.0.1 [--domain api.your-domain.com]
Creates .env and server.env only when absent; existing secrets are preserved.
Fill SMTP values in server.env before starting Compose. AI is disabled by default.
TEXT
}

while (($#)); do
  case "$1" in
    --image|--domain)
      if (($# < 2)); then printf 'Missing value for %s\n' "$1" >&2; exit 1; fi
      if [[ "$1" == '--image' ]]; then image="$2"; else domain="$2"; fi
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done

# Explicit tag/digest, no whitespace, shell expansion or interpolated secrets.
image_pattern='^(docker\.io/)?[a-z0-9][a-z0-9_-]*/[a-z0-9]+([._-][a-z0-9]+)*(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})$'
if [[ ! "$image" =~ $image_pattern ]]; then
  printf 'Use a Docker Hub image with an explicit version tag or SHA-256 digest.\n' >&2
  exit 1
fi
if [[ -n "$domain" ]]; then
  domain_pattern='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  if [[ ! "$domain" =~ $domain_pattern ]]; then
    printf 'Use a lowercase API hostname without https:// or a path.\n' >&2; exit 1
  fi
fi

for name in .env server.env; do
  if [[ -L "$deploy_dir/$name" || ( -e "$deploy_dir/$name" && ! -f "$deploy_dir/$name" ) ]]; then
    printf 'Expected a regular file: %s\n' "$name" >&2; exit 1
  fi
done

if [[ ! -e "$deploy_dir/.env" ]]; then
  (
    set -o noclobber
    printf 'BACKEND_IMAGE=%s\nAPI_PORT=3000\nAPP_DOMAIN=%s\nDOCKER_SUBNET=172.30.26.0/24\nCADDY_PROXY_IP=172.30.26.2\n' "$image" "$domain" > "$deploy_dir/.env"
  )
  printf 'Created deployment .env\n'
else
  printf 'Preserved deployment .env; edit BACKEND_IMAGE manually when upgrading.\n'
fi

if [[ ! -e "$deploy_dir/server.env" ]]; then
  command -v openssl >/dev/null || { printf 'openssl is required to create AUTH_SECRET.\n' >&2; exit 1; }
  deploy_auth_secret="$(openssl rand -hex 32)"
  (
    set -o noclobber
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == 'AUTH_SECRET=' ]]; then printf 'AUTH_SECRET=%s\n' "$deploy_auth_secret";
      else printf '%s\n' "$line"; fi
    done < "$deploy_dir/server.env.example" > "$deploy_dir/server.env"
  )
  unset deploy_auth_secret
  printf 'Created server.env with a new AUTH_SECRET (not printed).\n'
else
  printf 'Preserved existing server.env and AUTH_SECRET.\n'
fi
printf 'Fill SMTP settings in server.env. AI_FEATURES_ENABLED=false needs no AI key. Never commit or upload this file.\n'
