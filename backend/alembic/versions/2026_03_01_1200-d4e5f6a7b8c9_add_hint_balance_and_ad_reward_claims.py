"""Add hint_balance to users, add ad_reward_claims table

Revision ID: d4e5f6a7b8c9
Revises: b7e1c2d4f6a8
Create Date: 2026-03-01 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d4e5f6a7b8c9"
down_revision = "b7e1c2d4f6a8"
branch_labels = None
depends_on = None


def _get_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. Add hint_balance to users
    if "users" in tables:
        user_columns = _get_columns(inspector, "users")
        if "hint_balance" not in user_columns:
            op.add_column(
                "users",
                sa.Column(
                    "hint_balance",
                    sa.Integer(),
                    nullable=False,
                    server_default="5",
                ),
            )

    # 2. Create ad_reward_claims table
    if "ad_reward_claims" not in tables:
        op.create_table(
            "ad_reward_claims",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("placement", sa.String(32), nullable=False),
            sa.Column("ad_reference", sa.String(256), nullable=True),
            sa.Column("session_id", sa.String(64), nullable=True),
            sa.Column("level_number", sa.Integer(), nullable=True),
            sa.Column("reward_amount", sa.Integer(), nullable=True),
            sa.Column("claim_day_msk", sa.Date(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(),
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "user_id",
                "placement",
                "session_id",
                name="uq_revive_per_session",
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ad_reward_claims" in tables:
        op.drop_table("ad_reward_claims")

    if "users" in tables:
        user_columns = _get_columns(inspector, "users")
        if "hint_balance" in user_columns:
            op.drop_column("users", "hint_balance")
