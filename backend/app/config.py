"""
Arrow Puzzle - Backend Configuration

Настройки приложения через environment variables.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    """Настройки приложения."""
    
    # App
    APP_NAME: str = "Arrow Puzzle"
    DEBUG: bool = True
    API_PREFIX: str = "/api/v1"
    ENVIRONMENT: str = "development"
    
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
    MAX_ENERGY: int = 5
    ENERGY_REGEN_SECONDS: int = 30 * 60  # 30 minutes
    INITIAL_LIVES: int = 3
    MAX_LIVES: int = 5
    HINTS_PER_LEVEL: int = 3
    
    # Rewards
    BASE_COINS_PER_LEVEL: int = 10
    REFERRAL_REWARD_INVITER: int = 200
    REFERRAL_REWARD_INVITEE: int = 100
    
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