#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${POSTGRES_HOST:-postgres}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-arrow_user}"
DB_NAME="${POSTGRES_DB:-arrowpuzzle}"

LEVELS_DIR="${LEVELS_DIR:-/app/app/levels}"
SEED_LEVELS_DIR="${SEED_LEVELS_DIR:-/app/app/levels_seed}"

echo "==> Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}/${DB_NAME}"
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 1
done

echo "==> Running Alembic migrations"
alembic upgrade head

echo "==> Ensuring levels directory is populated"
mkdir -p "$LEVELS_DIR"

if [[ -z "$(ls -A "$LEVELS_DIR" 2>/dev/null)" ]]; then
  if [[ -d "$SEED_LEVELS_DIR" ]] && [[ -n "$(ls -A "$SEED_LEVELS_DIR" 2>/dev/null)" ]]; then
    cp -a "${SEED_LEVELS_DIR}/." "$LEVELS_DIR/"
    echo "==> Levels restored from image seed directory"
  else
    echo "WARN: Seed levels directory is empty: $SEED_LEVELS_DIR" >&2
  fi
fi

echo "==> Starting backend"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
