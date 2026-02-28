# ============================================
# ARROW PUZZLE - BACKEND DOCKERFILE
# ============================================

FROM python:3.11-slim

# Метаданные
LABEL maintainer="ArrowReward Team"
LABEL description="ArrowReward Backend - FastAPI + PostgreSQL"

# Рабочая директория
WORKDIR /app

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Копируем requirements
COPY requirements.txt .

# Устанавливаем Python зависимости
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Копируем код приложения
COPY . .

# Backup level files inside image so entrypoint can restore host-mounted levels dir if empty.
RUN mkdir -p /app/app/levels_seed && \
    cp -a /app/app/levels/. /app/app/levels_seed/

# Создаём непривилегированного пользователя
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app && \
    chmod +x /app/entrypoint.prod.sh
USER appuser

# Открываем порт
EXPOSE 8000

# Health check
# HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
#     CMD python -c "import requests; requests.get('http://localhost:8000/health')"

# Команда запуска
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
