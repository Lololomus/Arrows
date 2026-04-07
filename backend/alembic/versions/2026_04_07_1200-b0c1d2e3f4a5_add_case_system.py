"""Add case system: stars_balance, case_pity_counter, case_openings table

Revision ID: b0c1d2e3f4a5
Revises: 9a1b2c3d4e5f
Create Date: 2026-04-07 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = 'b0c1d2e3f4a5'
down_revision = '9a1b2c3d4e5f'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}

    if "stars_balance" not in user_columns:
        op.add_column(
            "users",
            sa.Column("stars_balance", sa.Integer(), server_default="0", nullable=False),
        )

    if "case_pity_counter" not in user_columns:
        op.add_column(
            "users",
            sa.Column("case_pity_counter", sa.Integer(), server_default="0", nullable=False),
        )

    if not inspector.has_table("case_openings"):
        op.create_table(
            "case_openings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "transaction_id",
                sa.Integer(),
                sa.ForeignKey("transactions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("rarity", sa.String(16), nullable=False),
            sa.Column("hints_given", sa.Integer(), nullable=False),
            sa.Column("revives_given", sa.Integer(), nullable=False),
            sa.Column("coins_given", sa.Integer(), nullable=False),
            sa.Column("stars_given", sa.Integer(), nullable=False),
            sa.Column("payment_currency", sa.String(8), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        )
    else:
        case_opening_columns = {column["name"] for column in inspector.get_columns("case_openings")}
        if "transaction_id" not in case_opening_columns:
            op.add_column(
                "case_openings",
                sa.Column(
                    "transaction_id",
                    sa.Integer(),
                    sa.ForeignKey("transactions.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )

    case_opening_indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("case_openings")
    }
    if "ix_case_openings_user_id" not in case_opening_indexes:
        op.create_index(
            "ix_case_openings_user_id", "case_openings", ["user_id"], unique=False
        )
    if "ix_case_openings_transaction_id" not in case_opening_indexes:
        op.create_index(
            "ix_case_openings_transaction_id", "case_openings", ["transaction_id"], unique=False
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("case_openings"):
        case_opening_indexes = {
            index["name"] for index in inspector.get_indexes("case_openings")
        }
        if "ix_case_openings_transaction_id" in case_opening_indexes:
            op.drop_index("ix_case_openings_transaction_id", table_name="case_openings")
        op.drop_table("case_openings")

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "case_pity_counter" in user_columns:
        op.drop_column("users", "case_pity_counter")
    if "stars_balance" in user_columns:
        op.drop_column("users", "stars_balance")
