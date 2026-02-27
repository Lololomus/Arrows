"""add referrals table and referral stats to users

Revision ID: 20260227_referrals
Revises: c3d9e8f1a2b3
Create Date: 2026-02-27 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260227_referrals"
down_revision = "c3d9e8f1a2b3"
branch_labels = None
depends_on = None


def _get_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _get_indexes(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _get_unique_constraints(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {constraint["name"] for constraint in inspector.get_unique_constraints(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    user_columns = _get_columns(inspector, "users")

    if "referrals_count" not in user_columns:
        op.add_column(
            "users",
            sa.Column("referrals_count", sa.Integer(), nullable=False, server_default="0"),
        )
    if "referrals_pending" not in user_columns:
        op.add_column(
            "users",
            sa.Column("referrals_pending", sa.Integer(), nullable=False, server_default="0"),
        )
    if "referrals_earnings" not in user_columns:
        op.add_column(
            "users",
            sa.Column("referrals_earnings", sa.Integer(), nullable=False, server_default="0"),
        )

    if "referrals" not in inspector.get_table_names():
        op.create_table(
            "referrals",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("inviter_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("invitee_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
            sa.Column("confirmed_at", sa.DateTime(), nullable=True),
            sa.Column("inviter_bonus_paid", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("invitee_bonus_paid", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )

    inspector = sa.inspect(bind)
    referral_indexes = _get_indexes(inspector, "referrals")
    referral_uniques = _get_unique_constraints(inspector, "referrals")

    if "ix_referrals_inviter_id" not in referral_indexes:
        op.create_index("ix_referrals_inviter_id", "referrals", ["inviter_id"])
    if "ix_referrals_status" not in referral_indexes:
        op.create_index("ix_referrals_status", "referrals", ["status"])
    if "uq_referrals_invitee_id" not in referral_uniques:
        op.create_unique_constraint("uq_referrals_invitee_id", "referrals", ["invitee_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "referrals" in inspector.get_table_names():
        referral_indexes = _get_indexes(inspector, "referrals")
        referral_uniques = _get_unique_constraints(inspector, "referrals")

        if "uq_referrals_invitee_id" in referral_uniques:
            op.drop_constraint("uq_referrals_invitee_id", "referrals", type_="unique")
        if "ix_referrals_status" in referral_indexes:
            op.drop_index("ix_referrals_status", table_name="referrals")
        if "ix_referrals_inviter_id" in referral_indexes:
            op.drop_index("ix_referrals_inviter_id", table_name="referrals")

        op.drop_table("referrals")

    user_columns = _get_columns(inspector, "users")
    if "referrals_earnings" in user_columns:
        op.drop_column("users", "referrals_earnings")
    if "referrals_pending" in user_columns:
        op.drop_column("users", "referrals_pending")
    if "referrals_count" in user_columns:
        op.drop_column("users", "referrals_count")
