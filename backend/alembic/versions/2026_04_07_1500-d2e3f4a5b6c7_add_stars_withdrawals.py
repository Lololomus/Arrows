"""Add stars_withdrawals table

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-04-07 15:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "stars_withdrawals" not in existing_tables:
        op.create_table(
            "stars_withdrawals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("telegram_id", sa.BigInteger(), nullable=False),
            sa.Column("username", sa.String(64), nullable=True),
            sa.Column("amount", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
            sa.Column("admin_note", sa.String(256), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
        )

    existing_indexes = {idx["name"] for idx in inspector.get_indexes("stars_withdrawals")}
    if "ix_stars_withdrawals_user_id" not in existing_indexes:
        op.create_index("ix_stars_withdrawals_user_id", "stars_withdrawals", ["user_id"])
    if "ix_stars_withdrawals_status" not in existing_indexes:
        op.create_index("ix_stars_withdrawals_status", "stars_withdrawals", ["status"])


def downgrade() -> None:
    op.drop_index("ix_stars_withdrawals_status", "stars_withdrawals")
    op.drop_index("ix_stars_withdrawals_user_id", "stars_withdrawals")
    op.drop_table("stars_withdrawals")
