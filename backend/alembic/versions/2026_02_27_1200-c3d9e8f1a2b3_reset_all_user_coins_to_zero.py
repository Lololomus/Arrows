"""Reset all user coin balances to zero

Revision ID: c3d9e8f1a2b3
Revises: a1f4b6c7d8e9
Create Date: 2026-02-27 12:00:00.000000

"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "c3d9e8f1a2b3"
down_revision = "a1f4b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE users SET coins = 0")


def downgrade() -> None:
    # One-time normalization. No rollback needed.
    pass
