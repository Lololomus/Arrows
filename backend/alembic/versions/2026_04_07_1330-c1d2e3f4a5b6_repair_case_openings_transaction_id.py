"""Repair case_openings.transaction_id for databases already at case-system head

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-04-07 13:30:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "c1d2e3f4a5b6"
down_revision = "b0c1d2e3f4a5"
branch_labels = None
depends_on = None

FK_NAME = "fk_case_openings_transaction_id_transactions"
INDEX_NAME = "ix_case_openings_transaction_id"


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("case_openings"):
        return

    case_opening_columns = {column["name"] for column in inspector.get_columns("case_openings")}
    if "transaction_id" not in case_opening_columns:
        op.add_column(
            "case_openings",
            sa.Column("transaction_id", sa.Integer(), nullable=True),
        )

    inspector = sa.inspect(bind)
    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("case_openings") if fk.get("name")}
    if FK_NAME not in foreign_keys:
        op.create_foreign_key(
            FK_NAME,
            "case_openings",
            "transactions",
            ["transaction_id"],
            ["id"],
            ondelete="SET NULL",
        )

    indexes = {index["name"] for index in inspector.get_indexes("case_openings")}
    if INDEX_NAME not in indexes:
        op.create_index(INDEX_NAME, "case_openings", ["transaction_id"], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("case_openings"):
        return

    indexes = {index["name"] for index in inspector.get_indexes("case_openings")}
    if INDEX_NAME in indexes:
        op.drop_index(INDEX_NAME, table_name="case_openings")

    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("case_openings") if fk.get("name")}
    if FK_NAME in foreign_keys:
        op.drop_constraint(FK_NAME, "case_openings", type_="foreignkey")

    case_opening_columns = {column["name"] for column in inspector.get_columns("case_openings")}
    if "transaction_id" in case_opening_columns:
        op.drop_column("case_openings", "transaction_id")
