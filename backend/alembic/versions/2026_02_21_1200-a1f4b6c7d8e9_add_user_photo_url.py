"""Add photo_url to users

Revision ID: a1f4b6c7d8e9
Revises: 58bf604dc1d6
Create Date: 2026-02-21 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a1f4b6c7d8e9"
down_revision = "58bf604dc1d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("photo_url", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "photo_url")

