"""
Arrow Puzzle - Backend Configuration

Настройки приложения через environment variables.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator, model_validator
from functools import lru_cache
from typing import Literal, Self


class Settings(BaseSettings):
    """Настройки приложения."""
    
    # App
    APP_NAME: str = "ArrowReward"
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
    REDIS_URL: str = "redis://:password@localhost:6379/0"
    
    # JWT
    JWT_SECRET: str = "your-super-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 6  # 6 hours
    JWT_EXPIRE_HOURS: int = 6
    
    # Telegram
    BOT_TOKEN: str = ""
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = "ArrowReward_bot"
    WEBAPP_URL: str = "https://arrowreward.ru.tuna.am/"
    OFFICIAL_CHANNEL_ID: str = ""
    OFFICIAL_CHANNEL_USERNAME: str = ""
    OFFICIAL_CHANNEL_URL: str = ""
    OFFICIAL_CHANNEL_NAME: str = "Официальный канал"
    OFFICIAL_CHANNEL_REWARD: int = 50
    PARTNER_CHANNEL_ID: str = ""
    PARTNER_CHANNEL_USERNAME: str = ""
    PARTNER_CHANNEL_URL: str = ""
    PARTNER_CHANNEL_NAME: str = "Партнёрский канал"
    PARTNER_CHANNEL_REWARD: int = 50
    
    # TON
    TON_PAYMENTS_ENABLED: bool = False
    TON_API_KEY: str = ""
    TON_WALLET_ADDRESS: str = ""

    # TON Connect
    TON_CONNECT_PROOF_TTL: int = 300
    TON_CONNECT_ALLOWED_DOMAINS: str = "arrowreward.ru.tuna.am"
    TON_CONNECT_PAYLOAD_TTL: int = 600
    
    # Adsgram
    ADSGRAM_SECRET: str = ""
    ADSGRAM_WEBHOOK_REQUIRE_SIGNATURE: bool = False
    
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
    COINS_REWARD_EASY: int = 1
    COINS_REWARD_NORMAL: int = 3
    COINS_REWARD_HARD: int = 5
    COINS_REWARD_EXTREME: int = 25
    COINS_REWARD_IMPOSSIBLE: int = 50
    # Rewards
    BASE_COINS_PER_LEVEL: int = 10
    REFERRAL_REWARD_INVITER: int = 50     # inviter получает, когда invitee достигнет уровня подтверждения
    REFERRAL_REWARD_INVITEE: int = 100    # invitee получает СРАЗУ при переходе по ссылке
    REFERRAL_CONFIRM_LEVEL: int = 50      # уровень для подтверждения реферала. ВЕРНУТЬ НА 50 НА ПРОДЕ
    REFERRAL_GRACE_PERIOD_HOURS: int = 72 # окно привязки для существующих аккаунтов
    REFERRAL_BONUS_COINS: int = 100
    REFERRAL_OWNER_BONUS: int = 200
    AD_REWARD_COINS: int = 25

    # Ads & economy
    AD_FIRST_ELIGIBLE_LEVEL: int = 15
    AD_DAILY_COINS_REWARD: int = 20
    AD_DAILY_COINS_LIMIT: int = 5
    AD_HINT_REWARD: int = 3
    AD_RESET_TIMEZONE: str = "Europe/Moscow"
    AD_INTERSTITIAL_EASY_NORMAL_INTERVAL: int = 5
    AD_INTERSTITIAL_EASY_NORMAL_MIN_LEVEL_SECONDS: int = 20
    AD_INTERSTITIAL_EASY_NORMAL_MIN_GAP_SECONDS: int = 90
    AD_INTERSTITIAL_HARD_MIN_LEVEL_SECONDS: int = 35
    AD_INTERSTITIAL_HARD_MIN_GAP_SECONDS: int = 120
    INITIAL_HINT_BALANCE: int = 5
    AD_REWARD_INTENT_TTL_SECONDS: int = 30 * 60
    AD_REWARD_POLL_WINDOW_SECONDS: int = 45

    # Rate Limiting - Ads
    RATE_LIMIT_ADS: int = 10

    # Season
    SEASON_START_DATE: str = "2020-01-01T00:00:00"  # UTC datetime; referrals before this date are excluded from tasks

    # Admin / security
    ADMIN_API_KEY: str = ""
    ADMIN_ALERT_CHAT_ID: str = ""
    ADMIN_TELEGRAM_ID: str = ""
    TELEGRAM_PROXY: str = ""  # SOCKS5/HTTP proxy for Telegram API, e.g. socks5://127.0.0.1:40000

    # Fragment Drops (Telegram Gifts)
    FRAGMENT_DROPS_ENABLED: bool = False
    FRAGMENT_GIFT_SEND_TIMEOUT: int = 30
    FRAGMENT_MAX_CLAIM_ATTEMPTS: int = 5
    FRAGMENT_SENDING_TIMEOUT: int = 300
    FRAGMENT_STARS_LOW_THRESHOLD: int = 100

    # Stars Withdrawal
    STARS_WITHDRAWAL_MIN: int = 50

    # Telegram Userbot Gifts (MTProto)
    USERBOT_ENABLED: bool = False
    USERBOT_API_ID: int = 0
    USERBOT_API_HASH: str = ""
    USERBOT_SESSION_PATH: str = "/app/sessions/userbot.session"
    USERBOT_PROCESSOR_INTERVAL: int = 30
    USERBOT_MAX_ORDER_ATTEMPTS: int = 5
    USERBOT_PROCESSING_TIMEOUT: int = 300
    USERBOT_MAX_GIFTS_PER_MINUTE: int = 3
    USERBOT_STARS_LOW_THRESHOLD: int = 50

    @model_validator(mode="after")
    def validate_ton_settings(self) -> Self:
        if self.TON_PAYMENTS_ENABLED and self.ENVIRONMENT == "production":
            if not self.TON_API_KEY:
                raise ValueError("TON_API_KEY is required when TON_PAYMENTS_ENABLED=True in production")
            if not self.TON_WALLET_ADDRESS:
                raise ValueError("TON_WALLET_ADDRESS is required when TON_PAYMENTS_ENABLED=True in production")
        if self.USERBOT_ENABLED:
            if self.USERBOT_API_ID <= 0:
                raise ValueError("USERBOT_API_ID must be set when USERBOT_ENABLED=True")
            if not self.USERBOT_API_HASH:
                raise ValueError("USERBOT_API_HASH is required when USERBOT_ENABLED=True")
        return self

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
