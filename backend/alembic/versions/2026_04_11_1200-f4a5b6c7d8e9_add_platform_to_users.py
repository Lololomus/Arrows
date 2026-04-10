"""Add platform column to users

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-04-11 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "f4a5b6c7d8e9"
down_revision = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = {c["name"] for c in inspector.get_columns("users")}

    if "platform" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("platform", sa.String(32), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("users", "platform")
