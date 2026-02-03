"""
Arrow Puzzle - FastAPI Application

Главная точка входа backend (PRODUCTION READY!).
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from .config import settings
from .database import init_db, close_redis
from .api import auth, game, shop, social, webhooks
from .middleware.security import (
    limiter, 
    add_security_headers,
    _rate_limit_exceeded_handler as rate_limit_handler
)


# ============================================
# LIFESPAN
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle events."""
    # Startup
    print(f"🚀 Starting {settings.APP_NAME}...")
    print(f"🌍 Environment: {settings.ENVIRONMENT}")
    print(f"🐛 Debug mode: {settings.DEBUG}")
    
    await init_db()
    print("✅ Database initialized")
    
    yield
    
    # Shutdown
    print("🛑 Shutting down...")
    await close_redis()
    print("✅ Redis closed")


# ============================================
# APP
# ============================================

app = FastAPI(
    title=settings.APP_NAME,
    description="Arrow Puzzle API - Telegram Mini App Game",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

# Rate limiter state
app.state.limiter = limiter


# ============================================
# MIDDLEWARE
# ============================================

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security headers
app.middleware("http")(add_security_headers)


# ============================================
# ERROR HANDLERS
# ============================================

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """Handler для rate limit ошибок."""
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please try again later."}
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Глобальный обработчик ошибок."""
    # В production не показываем детали ошибок
    if settings.DEBUG:
        detail = str(exc)
    else:
        detail = "Internal server error"
        # TODO: Отправить в Sentry
        print(f"❌ [Error] {exc}")
    
    return JSONResponse(
        status_code=500,
        content={"detail": detail}
    )


# ============================================
# ROUTES (ВСЕ АКТИВНЫ!)
# ============================================

# API prefix
api_prefix = settings.API_PREFIX

app.include_router(auth.router, prefix=api_prefix)
app.include_router(game.router, prefix=api_prefix)
app.include_router(shop.router, prefix=api_prefix)
app.include_router(social.router, prefix=api_prefix)
app.include_router(webhooks.router, prefix=api_prefix)

print(f"✅ All routers activated: {api_prefix}")


# ============================================
# HEALTH CHECK
# ============================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "environment": settings.ENVIRONMENT,
        "version": "1.0.0"
    }


@app.get(f"{api_prefix}/health")
async def api_health_check():
    """API health check."""
    return {
        "status": "ok",
        "version": "1.0.0",
        "debug": settings.DEBUG,
        "anticheat": settings.ANTICHEAT_ENABLED,
    }


# ============================================
# ROOT
# ============================================

@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": settings.APP_NAME,
        "version": "1.0.0",
        "docs": "/docs" if settings.DEBUG else None,
        "health": "/health",
    }


# ============================================
# RUN
# ============================================

if __name__ == "__main__":
    import uvicorn
    print(f"🚀 Starting {settings.APP_NAME}...")
    print(f"📍 http://localhost:8000")
    print(f"📖 Docs: http://localhost:8000/docs" if settings.DEBUG else "")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )