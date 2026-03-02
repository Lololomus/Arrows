"""Add task_claims table and extend channel_subscriptions

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-02 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def _get_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _get_unique_constraints(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {constraint["name"] for constraint in inspector.get_unique_constraints(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "channel_subscriptions" in tables:
        channel_columns = _get_columns(inspector, "channel_subscriptions")
        if "channel_username" not in channel_columns:
            op.add_column(
                "channel_subscriptions",
                sa.Column("channel_username", sa.String(length=128), nullable=True),
            )

        unique_constraints = _get_unique_constraints(inspector, "channel_subscriptions")
        if "uq_channel_subscription_user_channel" not in unique_constraints:
            op.create_unique_constraint(
                "uq_channel_subscription_user_channel",
                "channel_subscriptions",
                ["user_id", "channel_id"],
            )

    if "task_claims" not in tables:
        op.create_table(
            "task_claims",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("claim_id", sa.String(length=128), nullable=False),
            sa.Column("task_group", sa.String(length=64), nullable=False),
            sa.Column("reward_coins", sa.Integer(), nullable=False),
            sa.Column("claimed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("user_id", "claim_id", name="uq_task_claim_user_claim"),
        )
        op.create_index("ix_task_claims_user_id", "task_claims", ["user_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "task_claims" in tables:
        op.drop_index("ix_task_claims_user_id", table_name="task_claims")
        op.drop_table("task_claims")

    if "channel_subscriptions" in tables:
        unique_constraints = _get_unique_constraints(inspector, "channel_subscriptions")
        if "uq_channel_subscription_user_channel" in unique_constraints:
            op.drop_constraint(
                "uq_channel_subscription_user_channel",
                "channel_subscriptions",
                type_="unique",
            )

        channel_columns = _get_columns(inspector, "channel_subscriptions")
        if "channel_username" in channel_columns:
            op.drop_column("channel_subscriptions", "channel_username")
