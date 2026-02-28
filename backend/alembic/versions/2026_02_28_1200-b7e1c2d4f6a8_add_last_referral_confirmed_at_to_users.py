"""Add last_referral_confirmed_at to users

Revision ID: b7e1c2d4f6a8
Revises: 20260227_referrals
Create Date: 2026-02-28 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b7e1c2d4f6a8"
down_revision = "20260227_referrals"
branch_labels = None
depends_on = None


def _get_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "users" not in tables:
        return

    user_columns = _get_columns(inspector, "users")
    if "last_referral_confirmed_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("last_referral_confirmed_at", sa.DateTime(), nullable=True),
        )

    if "referrals" not in tables:
        return

    referral_columns = _get_columns(inspector, "referrals")
    required_referral_columns = {"inviter_id", "status", "confirmed_at"}
    if not required_referral_columns.issubset(referral_columns):
        return

    op.execute(
        """
        UPDATE users AS u
        SET last_referral_confirmed_at = ref_stats.max_confirmed_at
        FROM (
            SELECT inviter_id, MAX(confirmed_at) AS max_confirmed_at
            FROM referrals
            WHERE inviter_id IS NOT NULL
              AND status = 'confirmed'
              AND confirmed_at IS NOT NULL
            GROUP BY inviter_id
        ) AS ref_stats
        WHERE u.id = ref_stats.inviter_id
          AND (
              u.last_referral_confirmed_at IS NULL
              OR u.last_referral_confirmed_at < ref_stats.max_confirmed_at
          )
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "users" not in tables:
        return

    user_columns = _get_columns(inspector, "users")
    if "last_referral_confirmed_at" in user_columns:
        op.drop_column("users", "last_referral_confirmed_at")
