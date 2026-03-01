Контекст
Проект Arrows — Telegram Mini App игра-головоломка со стрелками. Fullstack: FastAPI (Python) + React (TypeScript). Нужен CLAUDE.md, чтобы Claude Code понимал проект с первой секунды каждой сессии.

Рекомендуемое содержимое CLAUDE.md
Создать файл CLAUDE.md в корне проекта (c:\Users\IliaI\Desktop\ALL_CODE\В работе\Arrows\CLAUDE.md):


# Arrows — Telegram Mini App Puzzle Game

Игра-головоломка со стрелками. Игрок убирает стрелки с поля в правильной последовательности (DAG-логика). Telegram Mini App с реферальной системой, магазином скинов и лидербордами.

## Стек

- **Backend:** Python 3.11, FastAPI, SQLAlchemy 2.0 (async), Alembic, aiogram 3, PostgreSQL 16, Redis 7
- **Frontend:** React 18, TypeScript, Vite 7, Zustand, Tailwind CSS, Framer Motion, Canvas 2D
- **Инфра:** Docker Compose, Nginx (TLS/tunnel), Cloudflare Tunnel

## Структура проекта

backend/           # FastAPI API + Telegram бот
app/
main.py        # Точка входа FastAPI, роутеры
config.py      # Pydantic Settings (env vars)
database.py    # SQLAlchemy engine, Redis
models.py      # ORM модели (users, referrals, inventory, transactions, leaderboard)
schemas.py     # Pydantic схемы запросов/ответов
api/           # Роутеры: auth, game, shop, social, webhooks
services/      # Бизнес-логика: anticheat, generator, level_loader, referrals
middleware/     # Rate limiting, security headers
bot.py           # Telegram бот (aiogram, polling)
alembic/         # Миграции БД
frontend/          # React SPA
src/
App.tsx        # Роутинг по табам (home, game, shop, friends, tasks, leaderboard)
api/client.ts  # API-клиент с авторизацией и нормализацией snake_case → camelCase
game/          # Игровой движок: engine.ts, spatialIndex.ts, generator.ts, skins/
stores/store.ts # Zustand: useAppStore (навигация, юзер) + useGameStore (игровое состояние)
screens/       # Экраны: GameScreen, HomeScreen, ShopScreen, FriendsScreen и др.
components/    # UI компоненты, CanvasBoard, FXOverlay
config/constants.ts # Игровые константы
nginx/             # Конфиги Nginx (TLS и tunnel)
scripts/           # Деплой-скрипты



## Команды

### Backend
```bash
# Dev запуск
docker compose up -d postgres redis
cd backend && uvicorn app.main:app --reload --env-file .env.development

# Миграции
cd backend && alembic upgrade head
cd backend && alembic revision --autogenerate -m "описание"
Frontend

cd frontend && npm run dev      # Dev сервер (порт 3000)
cd frontend && npm run build    # Продакшн сборка
cd frontend && npm run lint     # ESLint
Деплой

./scripts/deploy-prod.sh tls     # VPS с TLS
./scripts/deploy-prod.sh tunnel  # Cloudflare Tunnel
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
API
Все эндпоинты под /api/v1:

POST /auth/telegram — авторизация через Telegram initData
GET /game/level/{n}, POST /game/complete, POST /game/complete-and-next — игра
GET /game/energy, POST /game/hint — энергия и подсказки
GET /shop/catalog, POST /shop/purchase — магазин
GET /social/referral/*, GET /social/leaderboard/{type} — соцфункции
POST /webhooks/telegram/payment, /ton/payment, /adsgram/reward — вебхуки оплаты
Ключевые паттерны
Авторизация: JWT (7 дней), валидация Telegram initData через HMAC-SHA256. Dev-режим: заголовок X-Dev-User-Id
Навигация (frontend): Без react-router, состояние activeTab в Zustand, lazy-loading экранов
Игровой движок: Canvas 2D с immortal render loop, ref-based state (не React re-render). Spatial index (O(1) поиск стрелок)
Генерация уровней: Процедурная по seed (детерминированная). Один seed = один уровень. Валидация на сервере без хранения файлов
Античит: Серверная валидация последовательности ходов через dependency graph, проверка времени и паттернов
Реферальная система: Код в Redis с TTL 72ч (EC-16 fallback), подтверждение на уровне 50
Энергия: 5 очков, восстановление 1/30мин, расчёт on-demand (без фоновых задач)
API-клиент: Нормализация snake_case (сервер) → camelCase (клиент)
Стили: Tailwind + кастомные анимации в index.css, safe area для iOS/Telegram
Типы стрелок
normal, ice (замораживает), plus_life, minus_life, bomb (удаляет соседние), electric (убирает блокирующую)

Конфигурация
Backend: .env.development / .env.production → app/config.py (Pydantic Settings)
Frontend: .env.* с префиксом VITE_ → доступ через import.meta.env
Игровые константы: frontend/src/config/constants.ts
Соглашения по коду
Backend: async/await всюду, asyncpg для PostgreSQL, HTTPException для ошибок
Frontend: Функциональные компоненты, кастомные хуки, PascalCase компоненты, camelCase функции
Без react-router — навигация через Zustand store
Без any в TypeScript (кроме Window)
Коммиты: на русском или английском, краткое описание изменения