"""add fragment drops tables

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-25 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'fragment_drops',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('slug', sa.String(64), unique=True, nullable=False, index=True),
        sa.Column('title', sa.String(256), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('emoji', sa.String(16), nullable=False, server_default='🎁'),
        sa.Column('telegram_gift_id', sa.String(128), nullable=False),
        sa.Column('gift_star_cost', sa.Integer(), nullable=False),
        sa.Column('condition_type', sa.String(32), nullable=False),
        sa.Column('condition_target', sa.Integer(), nullable=False),
        sa.Column('total_stock', sa.Integer(), nullable=False),
        sa.Column('reserved_stock', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('delivered_stock', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        'fragment_claims',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('drop_id', sa.Integer(), sa.ForeignKey('fragment_drops.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending', index=True),
        sa.Column('telegram_gift_id', sa.String(128), nullable=False),
        sa.Column('stars_cost', sa.Integer(), nullable=False),
        sa.Column('failure_reason', sa.String(256), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_attempt_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('delivered_at', sa.DateTime(), nullable=True),
        sa.Column('failed_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('drop_id', 'user_id', name='uq_fragment_claim_drop_user'),
    )

    op.create_table(
        'bot_stars_ledger',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('event_type', sa.String(32), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('balance_after', sa.Integer(), nullable=True),
        sa.Column('fragment_claim_id', sa.Integer(), sa.ForeignKey('fragment_claims.id'), nullable=True),
        sa.Column('note', sa.String(256), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('bot_stars_ledger')
    op.drop_table('fragment_claims')
    op.drop_table('fragment_drops')
