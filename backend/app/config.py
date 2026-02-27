"""
Arrow Puzzle - Backend Configuration

Настройки приложения через environment variables.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from functools import lru_cache
from typing import Literal


class Settings(BaseSettings):
    """Настройки приложения."""
    
    # App
    APP_NAME: str = "Arrow Puzzle"
    DEBUG: bool = False
    API_PREFIX: str = "/api/v1"
    ENVIRONMENT: Literal["development", "production"] = "development"
    
    # Dev auth (safe by default)
    DEV_AUTH_ENABLED: bool = False
    DEV_AUTH_ALLOWLIST: str = ""
    DEV_AUTH_AUTO_CREATE: bool | None = None
    DEV_AUTH_DEFAULT_COINS: int = 0
    DEV_AUTH_DEFAULT_ENERGY: int = 5
    
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://arrow:password@localhost:5432/arrowpuzzle"
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    
    # JWT
    JWT_SECRET: str = "your-super-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    JWT_EXPIRE_HOURS: int = 168  # 7 days in hours
    
    # Telegram
    BOT_TOKEN: str = ""
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""
    WEBAPP_URL: str = "https://yourdomain.com"
    
    # TON
    TON_API_KEY: str = ""
    TON_WALLET_ADDRESS: str = ""
    
    # Adsgram
    ADSGRAM_SECRET: str = ""
    
    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,https://t.me"
    
    # Rate Limiting
    RATE_LIMIT_AUTH: int = 10
    RATE_LIMIT_GAME: int = 60
    RATE_LIMIT_SHOP: int = 30
    
    # Anti-cheat
    ANTICHEAT_ENABLED: bool = True
    ANTICHEAT_MIN_LEVEL_TIME: int = 5
    ANTICHEAT_MAX_WINRATE: int = 95
    
    # Game Settings
    INITIAL_COINS: int = 0
    MAX_ENERGY: int = 5
    ENERGY_REGEN_SECONDS: int = 30 * 60  # 30 minutes
    ENERGY_RECOVERY_MINUTES: int = 30
    INITIAL_LIVES: int = 3
    MAX_LIVES: int = 5
    HINTS_PER_LEVEL: int = 3
    COINS_PER_LEVEL: int = 10
    COINS_PER_STAR: int = 5
    COINS_REWARD_EASY: int = 5
    COINS_REWARD_NORMAL: int = 10
    COINS_REWARD_HARD: int = 30
    COINS_REWARD_EXTREME: int = 50
    COINS_REWARD_IMPOSSIBLE: int = 100
    
    # Rewards
    BASE_COINS_PER_LEVEL: int = 10
    REFERRAL_REWARD_INVITER: int = 200
    REFERRAL_REWARD_INVITEE: int = 100
    REFERRAL_BONUS_COINS: int = 100
    REFERRAL_OWNER_BONUS: int = 200
    AD_REWARD_COINS: int = 25
    
    # Admin / security
    ADMIN_API_KEY: str = ""

    @field_validator("DEV_AUTH_ALLOWLIST")
    @classmethod
    def validate_dev_auth_allowlist(cls, value: str) -> str:
        if not value.strip():
            return ""
        for raw in value.split(","):
            token = raw.strip()
            if not token:
                continue
            try:
                parsed = int(token)
            except ValueError as exc:
                raise ValueError(f"DEV_AUTH_ALLOWLIST contains non-integer value: {token}") from exc
            if parsed <= 0:
                raise ValueError(f"DEV_AUTH_ALLOWLIST must contain positive ids, got: {token}")
        return value

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def dev_auth_allowlist_ids(self) -> set[int]:
        if not self.DEV_AUTH_ALLOWLIST.strip():
            return set()
        ids: set[int] = set()
        for raw in self.DEV_AUTH_ALLOWLIST.split(","):
            token = raw.strip()
            if token:
                ids.add(int(token))
        return ids

    @property
    def dev_auth_auto_create_enabled(self) -> bool:
        if self.DEV_AUTH_AUTO_CREATE is None:
            return not self.is_production
        return self.DEV_AUTH_AUTO_CREATE

    @property
    def dev_auth_active(self) -> bool:
        return self.DEV_AUTH_ENABLED and not self.is_production
    
    @property
    def cors_origins_list(self) -> list[str]:
        """Парсит CORS_ORIGINS в список."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]
    
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore"
    )


@lru_cache()
def get_settings() -> Settings:
    """Получить настройки (кэшируется)."""
    return Settings()


settings = get_settings()
