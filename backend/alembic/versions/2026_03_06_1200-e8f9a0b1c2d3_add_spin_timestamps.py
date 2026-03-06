"""add spin timestamp fields to users

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-03-06 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = 'e8f9a0b1c2d3'
down_revision = 'd7e8f9a0b1c2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('last_spin_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('spin_retry_used_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'spin_retry_used_at')
    op.drop_column('users', 'last_spin_at')
