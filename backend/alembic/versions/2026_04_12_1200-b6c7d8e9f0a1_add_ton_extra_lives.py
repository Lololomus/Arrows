"""Add ton_extra_lives column to users

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-04-12 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "b6c7d8e9f0a1"
down_revision = "a5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("users")]

    if "ton_extra_lives" not in columns:
        op.add_column(
            "users",
            sa.Column(
                "ton_extra_lives",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )
        # Backfill: existing extra_lives came from TON purchases only
        op.execute("UPDATE users SET ton_extra_lives = extra_lives")


def downgrade() -> None:
    op.drop_column("users", "ton_extra_lives")
