"""add extra_lives to users

Revision ID: a1b2c3d4e5f6
Revises: 5d022416d673
Create Date: 2026-03-24 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '5d022416d673'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('extra_lives', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    op.drop_column('users', 'extra_lives')
