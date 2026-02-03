"""
Arrow Puzzle - Database Setup

SQLAlchemy async configuration.
"""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from redis import asyncio as aioredis

from .config import settings


# ============================================
# POSTGRESQL
# ============================================

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

Base = declarative_base()


async def get_db() -> AsyncSession:
    """Dependency для получения сессии БД."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """Инициализация БД (создание таблиц)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ============================================
# REDIS
# ============================================

redis_pool = None


async def get_redis():
    """Dependency для получения Redis клиента."""
    global redis_pool
    
    if redis_pool is None:
        redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    
    return redis_pool


async def close_redis():
    """Закрытие Redis соединения."""
    global redis_pool
    
    if redis_pool:
        await redis_pool.close()
        redis_pool = None