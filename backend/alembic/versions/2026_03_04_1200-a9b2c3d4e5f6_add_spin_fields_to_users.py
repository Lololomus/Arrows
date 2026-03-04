"""add spin fields to users

Revision ID: a9b2c3d4e5f6
Revises: e66b33325585
Create Date: 2026-03-04 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a9b2c3d4e5f6'
down_revision = 'e66b33325585'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('login_streak', sa.Integer(), server_default='0', nullable=False))
    op.add_column('users', sa.Column('last_spin_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'last_spin_date')
    op.drop_column('users', 'login_streak')
