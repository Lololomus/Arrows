"""Add user_platform_logins table

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-04-11 13:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "a5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if "user_platform_logins" not in existing_tables:
        op.create_table(
            "user_platform_logins",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("platform", sa.String(32), nullable=False),
            sa.Column("first_seen_at", sa.DateTime(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("user_id", "platform", name="uq_user_platform"),
        )


def downgrade() -> None:
    op.drop_table("user_platform_logins")
