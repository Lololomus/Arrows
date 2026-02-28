# ============================================
# ARROW PUZZLE - FRONTEND DOCKERFILE
# Multi-stage build: React Build + Nginx
# ============================================

# ============================================
# STAGE 1: BUILD
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходники
COPY . .

# Build для production
RUN npm run build

# ============================================
# STAGE 2: PRODUCTION (NGINX)
# ============================================
FROM nginx:alpine

# Метаданные
LABEL maintainer="ArrowReward Team"
LABEL description="ArrowReward Frontend - React + Nginx"

# Копируем built файлы из stage 1
COPY --from=builder /app/dist /usr/share/nginx/html

# Создаём непривилегированного пользователя
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

USER nginx

# Открываем порты
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

# Команда запуска
CMD ["nginx", "-g", "daemon off;"]
