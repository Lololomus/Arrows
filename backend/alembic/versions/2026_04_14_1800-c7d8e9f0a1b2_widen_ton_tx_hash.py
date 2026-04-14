"""Widen ton_tx_hash from varchar(128) to varchar(256)

Telegram charge IDs can exceed 128 chars, causing payment processing to fail.

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-04-14 18:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "c7d8e9f0a1b2"
down_revision = "b6c7d8e9f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "transactions",
        "ton_tx_hash",
        type_=sa.String(256),
        existing_type=sa.String(128),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "transactions",
        "ton_tx_hash",
        type_=sa.String(128),
        existing_type=sa.String(256),
        existing_nullable=True,
    )
