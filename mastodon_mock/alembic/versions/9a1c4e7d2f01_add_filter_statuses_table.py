"""add filter_statuses table

Revision ID: 9a1c4e7d2f01
Revises: 81d660ce78b7
Create Date: 2026-06-16 19:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a1c4e7d2f01"
down_revision: str | None = "81d660ce78b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "filter_statuses",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("filter_id", sa.BigInteger(), nullable=False),
        sa.Column("status_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["filter_id"],
            ["filters.id"],
        ),
        sa.ForeignKeyConstraint(
            ["status_id"],
            ["statuses.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("filter_statuses", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_filter_statuses_filter_id"), ["filter_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_filter_statuses_status_id"), ["status_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("filter_statuses", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_filter_statuses_status_id"))
        batch_op.drop_index(batch_op.f("ix_filter_statuses_filter_id"))

    op.drop_table("filter_statuses")
