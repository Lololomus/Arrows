"""add daily fields to user_stats

Revision ID: b1c2d3e4f5a6
Revises: a9b2c3d4e5f6
Create Date: 2026-03-04 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b1c2d3e4f5a6'
down_revision = 'a9b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_stats', sa.Column('last_daily_date', sa.Date(), nullable=True))
    op.add_column('user_stats', sa.Column('daily_streak', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    op.drop_column('user_stats', 'daily_streak')
    op.drop_column('user_stats', 'last_daily_date')
