"""Season 1 reset: levels, coins, hints, tasks, fragments

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-04-01 17:00:00.000000

"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Сбросить уровни на 1
    op.execute("UPDATE users SET current_level = 1, level_reached_at = NULL")

    # Монеты -50%
    op.execute("UPDATE users SET coins = coins / 2")

    # Подсказки и возрождения в ноль (extra_lives НЕ трогаем — платная фишка)
    op.execute("UPDATE users SET hint_balance = 0, revive_balance = 0")

    # Удалить задания (кроме подписки на канал)
    op.execute("DELETE FROM task_claims WHERE claim_id != 'official_channel_subscribe'")

    # Деактивировать старые фрагменты
    op.execute("UPDATE fragment_drops SET is_active = false")


def downgrade() -> None:
    # Season reset is irreversible
    pass
