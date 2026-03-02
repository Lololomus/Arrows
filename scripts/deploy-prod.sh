#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-tls}"
if [[ "$MODE" != "tls" && "$MODE" != "tunnel" ]]; then
  echo "Usage: $0 [tls|tunnel]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

warn() {
  echo "WARN: $*" >&2
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || die "Required file is missing: $path"
}

env_value() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || die "Missing key '${key}' in ${file}"

  local raw="${line#*=}"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  echo "$raw"
}

is_true() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

is_rewarded_block_id() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

is_interstitial_block_id() {
  [[ "$1" =~ ^int-[0-9]+$ ]]
}

if ! command -v docker >/dev/null 2>&1; then
  die "docker is not installed"
fi

if ! docker compose version >/dev/null 2>&1; then
  die "docker compose plugin is not available"
fi

require_file ".env"
require_file "backend/.env.production"
require_file "frontend/.env.production"
require_file "docker-compose.yml"
require_file "docker-compose.prod.yml"

if [[ "$MODE" == "tls" ]]; then
  require_file "nginx/ssl/fullchain.pem"
  require_file "nginx/ssl/privkey.pem"
fi

POSTGRES_PASSWORD="$(env_value ".env" "POSTGRES_PASSWORD")"
[[ ${#POSTGRES_PASSWORD} -ge 16 ]] || die "POSTGRES_PASSWORD in .env must be at least 16 characters"
[[ "$POSTGRES_PASSWORD" != "changeme123" ]] || die "POSTGRES_PASSWORD must not be changeme123"

ENVIRONMENT="$(env_value "backend/.env.production" "ENVIRONMENT")"
DEBUG_VALUE="$(env_value "backend/.env.production" "DEBUG")"
DEV_AUTH_ENABLED="$(env_value "backend/.env.production" "DEV_AUTH_ENABLED")"
JWT_SECRET="$(env_value "backend/.env.production" "JWT_SECRET")"
TELEGRAM_BOT_TOKEN="$(env_value "backend/.env.production" "TELEGRAM_BOT_TOKEN")"
WEBAPP_URL="$(env_value "backend/.env.production" "WEBAPP_URL")"
CORS_ORIGINS="$(env_value "backend/.env.production" "CORS_ORIGINS")"

[[ "$ENVIRONMENT" == "production" ]] || die "backend/.env.production: ENVIRONMENT must be production"
is_true "$DEBUG_VALUE" && die "backend/.env.production: DEBUG must be false"
is_true "$DEV_AUTH_ENABLED" && die "backend/.env.production: DEV_AUTH_ENABLED must be false"
[[ ${#JWT_SECRET} -ge 32 ]] || die "backend/.env.production: JWT_SECRET must be at least 32 characters"
[[ "$JWT_SECRET" != "your-super-secret-key-change-in-production" ]] || die "backend/.env.production: JWT_SECRET placeholder is not allowed"
[[ "$JWT_SECRET" != "CHANGE_THIS_TO_RANDOM_STRING_MIN_32_CHARS" ]] || die "backend/.env.production: JWT_SECRET placeholder is not allowed"
[[ -n "$TELEGRAM_BOT_TOKEN" ]] || die "backend/.env.production: TELEGRAM_BOT_TOKEN is empty"
[[ "$TELEGRAM_BOT_TOKEN" != "YOUR_BOT_TOKEN_FROM_BOTFATHER" ]] || die "backend/.env.production: TELEGRAM_BOT_TOKEN placeholder is not allowed"
[[ "$WEBAPP_URL" == https://* ]] || die "backend/.env.production: WEBAPP_URL must start with https://"

if [[ "$CORS_ORIGINS" != *"$WEBAPP_URL"* ]]; then
  warn "CORS_ORIGINS does not contain WEBAPP_URL (${WEBAPP_URL})"
fi

VITE_ENVIRONMENT="$(env_value "frontend/.env.production" "VITE_ENVIRONMENT")"
VITE_ENABLE_DEV_AUTH="$(env_value "frontend/.env.production" "VITE_ENABLE_DEV_AUTH")"
VITE_DEV_AUTH_USER_ID="$(env_value "frontend/.env.production" "VITE_DEV_AUTH_USER_ID")"
VITE_API_URL="$(env_value "frontend/.env.production" "VITE_API_URL")"
VITE_ADS_ENABLED="$(env_value "frontend/.env.production" "VITE_ADS_ENABLED")"
VITE_ADSGRAM_REWARD_DAILY_COINS_BLOCK_ID="$(env_value "frontend/.env.production" "VITE_ADSGRAM_REWARD_DAILY_COINS_BLOCK_ID")"
VITE_ADSGRAM_REWARD_HINT_BLOCK_ID="$(env_value "frontend/.env.production" "VITE_ADSGRAM_REWARD_HINT_BLOCK_ID")"
VITE_ADSGRAM_REWARD_REVIVE_BLOCK_ID="$(env_value "frontend/.env.production" "VITE_ADSGRAM_REWARD_REVIVE_BLOCK_ID")"
VITE_ADSGRAM_INTERSTITIAL_PROGRESS_BLOCK_ID="$(env_value "frontend/.env.production" "VITE_ADSGRAM_INTERSTITIAL_PROGRESS_BLOCK_ID")"
VITE_ADSGRAM_INTERSTITIAL_HARD_BLOCK_ID="$(env_value "frontend/.env.production" "VITE_ADSGRAM_INTERSTITIAL_HARD_BLOCK_ID")"

[[ "$VITE_ENVIRONMENT" == "production" ]] || die "frontend/.env.production: VITE_ENVIRONMENT must be production"
is_true "$VITE_ENABLE_DEV_AUTH" && die "frontend/.env.production: VITE_ENABLE_DEV_AUTH must be false"
[[ -z "$VITE_DEV_AUTH_USER_ID" ]] || die "frontend/.env.production: VITE_DEV_AUTH_USER_ID must be empty"

if [[ "$VITE_API_URL" != "/api/v1" && "$VITE_API_URL" != https://*/api/v1 ]]; then
  die "frontend/.env.production: VITE_API_URL must be /api/v1 or https://<domain>/api/v1"
fi

if is_true "$VITE_ADS_ENABLED"; then
  is_rewarded_block_id "$VITE_ADSGRAM_REWARD_DAILY_COINS_BLOCK_ID" \
    || die "frontend/.env.production: VITE_ADSGRAM_REWARD_DAILY_COINS_BLOCK_ID must be numeric only"
  is_rewarded_block_id "$VITE_ADSGRAM_REWARD_HINT_BLOCK_ID" \
    || die "frontend/.env.production: VITE_ADSGRAM_REWARD_HINT_BLOCK_ID must be numeric only"
  is_rewarded_block_id "$VITE_ADSGRAM_REWARD_REVIVE_BLOCK_ID" \
    || die "frontend/.env.production: VITE_ADSGRAM_REWARD_REVIVE_BLOCK_ID must be numeric only"
fi

if [[ -n "$VITE_ADSGRAM_INTERSTITIAL_PROGRESS_BLOCK_ID" ]] && ! is_interstitial_block_id "$VITE_ADSGRAM_INTERSTITIAL_PROGRESS_BLOCK_ID"; then
  die "frontend/.env.production: VITE_ADSGRAM_INTERSTITIAL_PROGRESS_BLOCK_ID must match int-<digits>"
fi
if [[ -n "$VITE_ADSGRAM_INTERSTITIAL_HARD_BLOCK_ID" ]] && ! is_interstitial_block_id "$VITE_ADSGRAM_INTERSTITIAL_HARD_BLOCK_ID"; then
  die "frontend/.env.production: VITE_ADSGRAM_INTERSTITIAL_HARD_BLOCK_ID must match int-<digits>"
fi

warn "Verify Reward URL is configured in AdsGram cabinet for each rewarded block with userid=[userId]"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
if [[ "$MODE" == "tunnel" ]]; then
  require_file "docker-compose.tunnel.yml"
  require_file "nginx/nginx.tunnel.conf"
  COMPOSE_FILES+=(-f docker-compose.tunnel.yml)
fi

compose() {
  docker compose "${COMPOSE_FILES[@]}" "$@"
}

echo "==> Pulling latest code"
git fetch --all --prune
git pull --ff-only origin main

echo "==> Preparing persistent levels directory"
LEVELS_HOST_DIR="/srv/arrows/levels"
mkdir -p "$LEVELS_HOST_DIR"
if [[ ! -w "$LEVELS_HOST_DIR" ]]; then
  die "Levels directory is not writable: $LEVELS_HOST_DIR"
fi
if [[ -z "$(ls -A "$LEVELS_HOST_DIR" 2>/dev/null)" ]]; then
  cp -a backend/app/levels/. "$LEVELS_HOST_DIR/"
  echo "==> Seeded host levels directory from repository"
fi
chown -R 1000:1000 "$LEVELS_HOST_DIR" 2>/dev/null || warn "Could not chown $LEVELS_HOST_DIR to uid 1000"

echo "==> Building and starting containers (mode: $MODE)"
compose up -d --build

echo "==> Running Alembic migrations"
attempt=1
until compose exec -T backend alembic upgrade head; do
  if [[ $attempt -ge 10 ]]; then
    die "Alembic migration failed after ${attempt} attempts"
  fi
  attempt=$((attempt + 1))
  sleep 3
done

echo "==> Deployment status"
compose ps
compose logs --tail=50 backend frontend bot

echo "Deployment completed successfully."
