"""Add onboarding_shown, welcome_offer fields to users

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-04-09 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "e3f4a5b6c7d8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = {c["name"] for c in inspector.get_columns("users")}

    if "onboarding_shown" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("onboarding_shown", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )

    if "welcome_offer_opened_at" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("welcome_offer_opened_at", sa.DateTime(), nullable=True),
        )

    if "welcome_offer_purchased" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("welcome_offer_purchased", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )

    if "usdt_blast_sent" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("usdt_blast_sent", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )


def downgrade() -> None:
    op.drop_column("users", "usdt_blast_sent")
    op.drop_column("users", "welcome_offer_purchased")
    op.drop_column("users", "welcome_offer_opened_at")
    op.drop_column("users", "onboarding_shown")
