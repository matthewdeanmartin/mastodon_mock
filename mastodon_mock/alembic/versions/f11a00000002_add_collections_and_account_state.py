"""Persist collections and stable account lifecycle state."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "f11a00000002"
down_revision: str = "f11a00000001"
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    """Add collection tables and account visibility fields."""
    op.add_column("accounts", sa.Column("invalid_handle", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("accounts", sa.Column("requested_deletion_at", sa.DateTime(), nullable=True))
    op.create_table(
        "collections",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("account_id", sa.BigInteger(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("language", sa.String(), nullable=True),
        sa.Column("sensitive", sa.Boolean(), nullable=False),
        sa.Column("discoverable", sa.Boolean(), nullable=False),
        sa.Column("tag_name", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_collections_account_id", "collections", ["account_id"])
    op.create_table(
        "collection_items",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("collection_id", sa.BigInteger(), sa.ForeignKey("collections.id"), nullable=False),
        sa.Column("account_id", sa.BigInteger(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("collection_id", "account_id", name="uq_collection_account"),
    )
    op.create_index("ix_collection_items_collection_id", "collection_items", ["collection_id"])
    op.create_index("ix_collection_items_account_id", "collection_items", ["account_id"])
    with op.batch_alter_table("notifications") as batch:
        batch.add_column(sa.Column("collection_id", sa.BigInteger(), nullable=True))
        batch.create_foreign_key("fk_notifications_collection", "collections", ["collection_id"], ["id"])


def downgrade() -> None:
    """Remove the collection feature and account lifecycle fields."""
    with op.batch_alter_table("notifications") as batch:
        batch.drop_constraint("fk_notifications_collection", type_="foreignkey")
        batch.drop_column("collection_id")
    op.drop_table("collection_items")
    op.drop_table("collections")
    op.drop_column("accounts", "requested_deletion_at")
    op.drop_column("accounts", "invalid_handle")
