"""Add user_contracts table for fragment contract system

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-04-15 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "d8e9f0a1b2c3"
down_revision = "c7d8e9f0a1b2"
branch_labels = None
depends_on = None


TABLE_NAME = "user_contracts"


def _table_exists() -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(TABLE_NAME)


def _column_names() -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in sa.inspect(bind).get_columns(TABLE_NAME)}


def _index_names() -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(TABLE_NAME)}


def _unique_constraint_names() -> set[str]:
    bind = op.get_bind()
    return {
        constraint["name"]
        for constraint in sa.inspect(bind).get_unique_constraints(TABLE_NAME)
        if constraint.get("name")
    }


def _foreign_key_names() -> set[str]:
    bind = op.get_bind()
    return {
        constraint["name"]
        for constraint in sa.inspect(bind).get_foreign_keys(TABLE_NAME)
        if constraint.get("name")
    }


def _create_user_contracts_table() -> None:
    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("contract_id", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("current_stage_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("activated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("stage_snapshots", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("stages_completed", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("reward_claim", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "contract_id", name="uq_user_contract"),
    )


def _ensure_missing_columns() -> None:
    columns = _column_names()

    if "contract_id" not in columns:
        op.add_column(TABLE_NAME, sa.Column("contract_id", sa.String(64), nullable=True))
    if "status" not in columns:
        op.add_column(TABLE_NAME, sa.Column("status", sa.String(32), nullable=False, server_default="active"))
    if "current_stage_index" not in columns:
        op.add_column(TABLE_NAME, sa.Column("current_stage_index", sa.Integer(), nullable=False, server_default="0"))
    if "activated_at" not in columns:
        op.add_column(TABLE_NAME, sa.Column("activated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    if "completed_at" not in columns:
        op.add_column(TABLE_NAME, sa.Column("completed_at", sa.DateTime(), nullable=True))
    if "stage_snapshots" not in columns:
        op.add_column(TABLE_NAME, sa.Column("stage_snapshots", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")))
    if "stages_completed" not in columns:
        op.add_column(TABLE_NAME, sa.Column("stages_completed", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")))
    if "reward_claim" not in columns:
        op.add_column(TABLE_NAME, sa.Column("reward_claim", sa.JSON(), nullable=True))


def _ensure_constraints_and_indexes() -> None:
    if "uq_user_contract" not in _unique_constraint_names():
        op.create_unique_constraint("uq_user_contract", TABLE_NAME, ["user_id", "contract_id"])

    if not any(name in _foreign_key_names() for name in ("user_contracts_user_id_fkey", "fk_user_contracts_user_id_users")):
        op.create_foreign_key(
            "fk_user_contracts_user_id_users",
            TABLE_NAME,
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )

    indexes = _index_names()
    if "ix_user_contracts_user_id" not in indexes:
        op.create_index("ix_user_contracts_user_id", TABLE_NAME, ["user_id"])
    if "ix_user_contracts_contract_id" not in indexes:
        op.create_index("ix_user_contracts_contract_id", TABLE_NAME, ["contract_id"])


def upgrade() -> None:
    if not _table_exists():
        _create_user_contracts_table()
    else:
        _ensure_missing_columns()

    _ensure_constraints_and_indexes()


def downgrade() -> None:
    if not _table_exists():
        return

    indexes = _index_names()
    if "ix_user_contracts_contract_id" in indexes:
        op.drop_index("ix_user_contracts_contract_id", table_name=TABLE_NAME)
    if "ix_user_contracts_user_id" in indexes:
        op.drop_index("ix_user_contracts_user_id", table_name=TABLE_NAME)
    op.drop_table(TABLE_NAME)
