"""Add ad_reward_intents table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-01 15:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ad_reward_intents" in tables:
        return

    op.create_table(
        "ad_reward_intents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("intent_id", sa.String(64), nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("placement", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("session_id", sa.String(64), nullable=True),
        sa.Column("level_number", sa.Integer(), nullable=True),
        sa.Column("failure_code", sa.String(64), nullable=True),
        sa.Column("coins", sa.Integer(), nullable=True),
        sa.Column("hint_balance", sa.Integer(), nullable=True),
        sa.Column("revive_granted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("used_today", sa.Integer(), nullable=True),
        sa.Column("limit_today", sa.Integer(), nullable=True),
        sa.Column("resets_at", sa.DateTime(), nullable=True),
        sa.Column("claim_day_msk", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("fulfilled_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("intent_id", name="uq_ad_reward_intents_intent_id"),
    )
    op.create_index("ix_ad_reward_intents_intent_id", "ad_reward_intents", ["intent_id"], unique=True)
    op.create_index("ix_ad_reward_intents_user_id", "ad_reward_intents", ["user_id"], unique=False)
    op.create_index("ix_ad_reward_intents_placement", "ad_reward_intents", ["placement"], unique=False)
    op.create_index("ix_ad_reward_intents_status", "ad_reward_intents", ["status"], unique=False)
    op.create_index("ix_ad_reward_intents_expires_at", "ad_reward_intents", ["expires_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "ad_reward_intents" not in tables:
        return

    op.drop_index("ix_ad_reward_intents_expires_at", table_name="ad_reward_intents")
    op.drop_index("ix_ad_reward_intents_status", table_name="ad_reward_intents")
    op.drop_index("ix_ad_reward_intents_placement", table_name="ad_reward_intents")
    op.drop_index("ix_ad_reward_intents_user_id", table_name="ad_reward_intents")
    op.drop_index("ix_ad_reward_intents_intent_id", table_name="ad_reward_intents")
    op.drop_table("ad_reward_intents")
