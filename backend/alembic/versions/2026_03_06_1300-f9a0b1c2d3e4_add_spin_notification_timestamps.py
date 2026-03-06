"""add spin notification timestamp fields to users

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-03-06 13:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = 'f9a0b1c2d3e4'
down_revision = 'e8f9a0b1c2d3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('spin_ready_notified_for_spin_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('streak_warning_notified_for_spin_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('streak_reset_notified_for_spin_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'streak_reset_notified_for_spin_at')
    op.drop_column('users', 'streak_warning_notified_for_spin_at')
    op.drop_column('users', 'spin_ready_notified_for_spin_at')
