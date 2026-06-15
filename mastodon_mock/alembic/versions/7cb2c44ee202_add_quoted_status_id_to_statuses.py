"""add quoted_status_id to statuses

Revision ID: 7cb2c44ee202
Revises: 7afb4f53fee4
Create Date: 2026-06-14 17:10:59.705536
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "7cb2c44ee202"
down_revision: str | None = "7afb4f53fee4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # SQLite needs a named constraint for batch-mode FK creation.
    with op.batch_alter_table("statuses", schema=None) as batch_op:
        batch_op.add_column(sa.Column("quoted_status_id", sa.BigInteger(), nullable=True))
        batch_op.create_foreign_key("fk_statuses_quoted_status_id_statuses", "statuses", ["quoted_status_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("statuses", schema=None) as batch_op:
        batch_op.drop_constraint("fk_statuses_quoted_status_id_statuses", type_="foreignkey")
        batch_op.drop_column("quoted_status_id")
