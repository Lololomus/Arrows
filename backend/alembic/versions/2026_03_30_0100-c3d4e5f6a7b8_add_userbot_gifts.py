"""add userbot gift queue tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-30 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'userbot_gift_orders',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('recipient_telegram_id', sa.BigInteger(), nullable=False),
        sa.Column('operation_type', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('telegram_gift_id', sa.BigInteger(), nullable=True),
        sa.Column('owned_gift_slug', sa.String(length=128), nullable=True),
        sa.Column('star_cost_estimate', sa.Integer(), nullable=True),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='5'),
        sa.Column('retry_after', sa.DateTime(), nullable=True),
        sa.Column('failure_reason', sa.String(length=256), nullable=True),
        sa.Column('source_kind', sa.String(length=64), nullable=False),
        sa.Column('source_ref', sa.String(length=256), nullable=False),
        sa.Column('telegram_result_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('processing_started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('failed_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_userbot_gift_orders_user_id', 'userbot_gift_orders', ['user_id'])
    op.create_index('ix_userbot_gift_orders_recipient_telegram_id', 'userbot_gift_orders', ['recipient_telegram_id'])
    op.create_index('ix_userbot_gift_orders_operation_type', 'userbot_gift_orders', ['operation_type'])
    op.create_index('ix_userbot_gift_orders_status', 'userbot_gift_orders', ['status'])
    op.create_index('ix_userbot_gift_orders_priority', 'userbot_gift_orders', ['priority'])
    op.create_index('ix_userbot_gift_orders_retry_after', 'userbot_gift_orders', ['retry_after'])
    op.create_index('ix_userbot_gift_orders_created_at', 'userbot_gift_orders', ['created_at'])
    op.create_index('ix_userbot_gift_orders_processing_started_at', 'userbot_gift_orders', ['processing_started_at'])

    op.create_table(
        'userbot_stars_ledger',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('event_type', sa.String(length=32), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('balance_after', sa.Integer(), nullable=True),
        sa.Column('gift_order_id', sa.Integer(), sa.ForeignKey('userbot_gift_orders.id'), nullable=True),
        sa.Column('note', sa.String(length=256), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index('ix_userbot_stars_ledger_gift_order_id', 'userbot_stars_ledger', ['gift_order_id'])


def downgrade() -> None:
    op.drop_index('ix_userbot_stars_ledger_gift_order_id', table_name='userbot_stars_ledger')
    op.drop_table('userbot_stars_ledger')

    op.drop_index('ix_userbot_gift_orders_processing_started_at', table_name='userbot_gift_orders')
    op.drop_index('ix_userbot_gift_orders_created_at', table_name='userbot_gift_orders')
    op.drop_index('ix_userbot_gift_orders_retry_after', table_name='userbot_gift_orders')
    op.drop_index('ix_userbot_gift_orders_priority', table_name='userbot_gift_orders')
    op.drop_index('ix_userbot_gift_orders_status', table_name='userbot_gift_orders')
    op.drop_index('ix_userbot_gift_orders_operation_type', table_name='userbot_gift_orders')
    op.drop_index('ix_userbot_gift_orders_recipient_telegram_id', table_name='userbot_gift_orders')
    op.drop_index('ix_userbot_gift_orders_user_id', table_name='userbot_gift_orders')
    op.drop_table('userbot_gift_orders')
