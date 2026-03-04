"""add spin pending and retry fields to users

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-03-04 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('pending_spin_prize_type', sa.String(length=16), nullable=True))
    op.add_column('users', sa.Column('pending_spin_prize_amount', sa.Integer(), nullable=True))
    op.add_column('users', sa.Column('spin_retry_used_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'spin_retry_used_date')
    op.drop_column('users', 'pending_spin_prize_amount')
    op.drop_column('users', 'pending_spin_prize_type')
