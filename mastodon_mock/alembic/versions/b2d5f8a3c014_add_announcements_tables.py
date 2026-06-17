"""add announcements tables

Revision ID: b2d5f8a3c014
Revises: 9a1c4e7d2f01
Create Date: 2026-06-16 20:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d5f8a3c014"
down_revision: str | None = "9a1c4e7d2f01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "announcements",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("all_day", sa.Boolean(), nullable=False),
        sa.Column("published", sa.Boolean(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "announcement_dismissals",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("announcement_id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("announcement_id", "account_id", name="uq_announcement_dismissal"),
    )
    with op.batch_alter_table("announcement_dismissals", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_announcement_dismissals_account_id"), ["account_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_announcement_dismissals_announcement_id"), ["announcement_id"], unique=False
        )

    op.create_table(
        "announcement_reactions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("announcement_id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("announcement_id", "account_id", "name", name="uq_announcement_reaction"),
    )
    with op.batch_alter_table("announcement_reactions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_announcement_reactions_account_id"), ["account_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_announcement_reactions_announcement_id"), ["announcement_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("announcement_reactions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_announcement_reactions_announcement_id"))
        batch_op.drop_index(batch_op.f("ix_announcement_reactions_account_id"))
    op.drop_table("announcement_reactions")

    with op.batch_alter_table("announcement_dismissals", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_announcement_dismissals_announcement_id"))
        batch_op.drop_index(batch_op.f("ix_announcement_dismissals_account_id"))
    op.drop_table("announcement_dismissals")

    op.drop_table("announcements")
