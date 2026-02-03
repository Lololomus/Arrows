#!/bin/bash

# ============================================
# ARROW PUZZLE - DATABASE INITIALIZATION
# ============================================

set -e

echo "🗄️  Initializing database..."

# Ждём пока PostgreSQL будет готов
echo "⏳ Waiting for PostgreSQL..."
while ! pg_isready -h ${POSTGRES_HOST:-localhost} -p ${POSTGRES_PORT:-5432} -U ${POSTGRES_USER:-arrow_user} > /dev/null 2>&1; do
    sleep 1
done
echo "✅ PostgreSQL is ready"

# Создаём начальную миграцию (если нет)
if [ ! -d "alembic/versions" ] || [ -z "$(ls -A alembic/versions)" ]; then
    echo "📝 Creating initial migration..."
    alembic revision --autogenerate -m "Initial migration"
fi

# Применяем миграции
echo "🔄 Running migrations..."
alembic upgrade head

echo "✅ Database initialized successfully!"