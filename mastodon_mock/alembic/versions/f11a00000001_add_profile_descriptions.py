"""Persist avatar and header descriptions for Mastodon API 11."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "f11a00000001"
down_revision: str = "e7a91c5b3d42"
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    """Add empty descriptions without changing existing profiles."""
    op.add_column("accounts", sa.Column("avatar_description", sa.Text(), nullable=False, server_default=""))
    op.add_column("accounts", sa.Column("header_description", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    """Remove profile descriptions."""
    op.drop_column("accounts", "header_description")
    op.drop_column("accounts", "avatar_description")
