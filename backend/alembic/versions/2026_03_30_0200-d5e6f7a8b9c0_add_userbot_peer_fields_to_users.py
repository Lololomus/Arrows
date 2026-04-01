"""add userbot peer fields to users

Revision ID: d5e6f7a8b9c0
Revises: c3d4e5f6a7b8
Create Date: 2026-03-30 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd5e6f7a8b9c0'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('userbot_access_hash', sa.BigInteger(), nullable=True))
    op.add_column(
        'users',
        sa.Column('userbot_peer_status', sa.String(length=32), nullable=False, server_default='unknown'),
    )
    op.add_column('users', sa.Column('userbot_peer_verified_at', sa.DateTime(), nullable=True))
    op.create_index('ix_users_userbot_peer_status', 'users', ['userbot_peer_status'])


def downgrade() -> None:
    op.drop_index('ix_users_userbot_peer_status', table_name='users')
    op.drop_column('users', 'userbot_peer_verified_at')
    op.drop_column('users', 'userbot_peer_status')
    op.drop_column('users', 'userbot_access_hash')
