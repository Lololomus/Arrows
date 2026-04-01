"""Add locale_manually_set to users

Revision ID: 9a1b2c3d4e5f
Revises: f7a8b9c0d1e2
Create Date: 2026-04-02 12:45:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "9a1b2c3d4e5f"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("locale_manually_set", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "locale_manually_set")
