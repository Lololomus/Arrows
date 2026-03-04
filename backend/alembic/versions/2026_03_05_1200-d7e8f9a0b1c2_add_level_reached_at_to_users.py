"""add level_reached_at to users

Revision ID: d7e8f9a0b1c2
Revises: c2d3e4f5a6b7
Create Date: 2026-03-05 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'd7e8f9a0b1c2'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('level_reached_at', sa.DateTime(), nullable=True))

    op.execute(
        """
        UPDATE users
        SET level_reached_at = COALESCE(
            (
                SELECT MIN(la.created_at)
                FROM level_attempts AS la
                WHERE la.user_id = users.id
                  AND la.result = 'win'
                  AND la.level_number = users.current_level - 1
            ),
            users.created_at
        )
        WHERE users.current_level > 1
        """
    )


def downgrade() -> None:
    op.drop_column('users', 'level_reached_at')
