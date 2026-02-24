# Arrow Puzzle

## Runtime modes

This project now separates development and production behavior via env files:

- Backend: `backend/.env.development`, `backend/.env.production`
- Frontend: `frontend/.env.development`, `frontend/.env.production`

`DEV_AUTH` is allowed only when explicitly enabled and allowlisted.

## Local development

1. Start dependencies:

```bash
docker compose up -d postgres redis
```

2. Start backend:

```bash
uvicorn app.main:app --reload --env-file backend/.env.development
```

3. Start frontend:

```bash
cd frontend && npm run dev -- --mode development
```

## Production deployment (VPS + Docker Compose)

Use base compose + production override:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

For a full production runbook (TLS mode, tunnel mode, env checklist, one-command deploy script), see `DEPLOYMENT.md`.

Production safety guard:

- if `ENVIRONMENT=production` and (`DEBUG=true` or `DEV_AUTH_ENABLED=true`) backend startup fails.
