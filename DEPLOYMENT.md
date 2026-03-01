# Production Deployment Guide

This runbook is for a clean VPS deploy with Docker Compose.
It is designed to avoid the exact issues you had: missing TLS certs, broken Telegram auth signatures, and invalid user tokens.

## 1. Choose deployment mode

- `tls` (recommended): Nginx serves HTTPS on `443` using local cert files in `nginx/ssl/`.
- `tunnel`: no local TLS in Nginx, TLS is terminated by your tunnel provider (for example Cloudflare Tunnel).

## 2. One-time server setup

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

Optional firewall (recommended):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 3. Get project on server

```bash
git clone https://github.com/Lololomus/Arrows.git
cd Arrows
```

## 4. Prepare env files (required)

```bash
cp .env.example .env
cp backend/.env.example backend/.env.production
cp frontend/.env.example frontend/.env.production
```

Set these values before first deploy:

- `.env`
  - `POSTGRES_PASSWORD=<long random password, 16+ chars>`
- `backend/.env.production`
  - `ENVIRONMENT=production`
  - `DEBUG=false`
  - `DEV_AUTH_ENABLED=false`
  - `JWT_SECRET=<long random secret, 32+ chars>`
  - `JWT_EXPIRE_HOURS=6`
  - `TELEGRAM_BOT_TOKEN=<real bot token>`
  - `TELEGRAM_BOT_USERNAME=<your bot username>`
  - `WEBAPP_URL=https://<your-domain>`
  - `CORS_ORIGINS=https://<your-domain>,https://t.me`
- `frontend/.env.production`
  - `VITE_ENVIRONMENT=production`
  - `VITE_ENABLE_DEV_AUTH=false`
  - `VITE_DEV_AUTH_USER_ID=`
  - `VITE_API_URL=/api/v1`

## 5. TLS mode (no tunnel)

Create cert files expected by `nginx/nginx.conf`:

```bash
mkdir -p nginx/ssl
```

Place:

- `nginx/ssl/fullchain.pem`
- `nginx/ssl/privkey.pem`

Then deploy:

```bash
chmod +x scripts/deploy-prod.sh
./scripts/deploy-prod.sh tls
```

## 6. Tunnel mode (Cloudflare Tunnel or similar)

Use this if your external TLS is handled outside Nginx.
This mode switches frontend Nginx config to `nginx/nginx.tunnel.conf` (HTTP only).

```bash
chmod +x scripts/deploy-prod.sh
./scripts/deploy-prod.sh tunnel
```

Point your tunnel to:

- origin: `http://127.0.0.1:80`

## 7. Daily update command

After first setup, production update is one command:

```bash
cd ~/Arrows
./scripts/deploy-prod.sh tls
```

or tunnel mode:

```bash
cd ~/Arrows
./scripts/deploy-prod.sh tunnel
```

## 8. Health checks

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -I https://<your-domain>/health
curl -I https://<your-domain>/api/v1/health
```

## 9. Troubleshooting

### `Invalid Telegram authentication data`

Most common cause: `TELEGRAM_BOT_TOKEN` in backend does not match the bot that opened the Mini App.

Check:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 backend
```

### `Invalid or expired token`

If `JWT_SECRET` changed, old JWTs become invalid. The client now tries a silent Telegram re-login first; if that fails, users must re-open Mini App and login again.

### Alembic duplicate column (`photo_url already exists`)

Migration `a1f4b6c7d8e9` is now idempotent, so `alembic upgrade head` can be re-run safely.

### `role "... does not exist"` in Postgres commands

Use the compose credentials from this project:

- user: `arrow_user`
- db: `arrowpuzzle`

## 10. Security defaults in production override

`docker-compose.prod.yml` now closes host-exposed ports for:

- `postgres`
- `redis`
- `backend`

Only frontend stays public.
