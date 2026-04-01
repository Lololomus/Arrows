"""Add user locale and fragment translation fields

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-04-01 19:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("locale", sa.String(length=8), nullable=False, server_default="en"))
    op.add_column("fragment_drops", sa.Column("title_translations", sa.JSON(), nullable=True))
    op.add_column("fragment_drops", sa.Column("description_translations", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("fragment_drops", "description_translations")
    op.drop_column("fragment_drops", "title_translations")
    op.drop_column("users", "locale")
