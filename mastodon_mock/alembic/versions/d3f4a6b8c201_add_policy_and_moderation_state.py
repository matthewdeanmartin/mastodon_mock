"""add policy and moderation state

Revision ID: d3f4a6b8c201
Revises: 51ee74b06b22
Create Date: 2026-06-20 18:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3f4a6b8c201"
down_revision: str | None = "51ee74b06b22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_policies",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("for_not_following", sa.String(), nullable=False),
        sa.Column("for_not_followers", sa.String(), nullable=False),
        sa.Column("for_new_accounts", sa.String(), nullable=False),
        sa.Column("for_private_mentions", sa.String(), nullable=False),
        sa.Column("for_limited_accounts", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id"),
    )
    op.create_index("ix_notification_policies_account_id", "notification_policies", ["account_id"], unique=True)
    op.create_table(
        "notification_requests",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("from_account_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["from_account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "from_account_id", name="uq_notification_request_accounts"),
    )
    op.create_index("ix_notification_requests_account_id", "notification_requests", ["account_id"], unique=False)
    op.create_index(
        "ix_notification_requests_from_account_id", "notification_requests", ["from_account_id"], unique=False
    )
    op.create_table(
        "notification_policy_overrides",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("from_account_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["from_account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "from_account_id", name="uq_notification_policy_override_accounts"),
    )
    op.create_index(
        "ix_notification_policy_overrides_account_id",
        "notification_policy_overrides",
        ["account_id"],
        unique=False,
    )
    op.create_index(
        "ix_notification_policy_overrides_from_account_id",
        "notification_policy_overrides",
        ["from_account_id"],
        unique=False,
    )
    with op.batch_alter_table("notifications") as batch_op:
        batch_op.add_column(sa.Column("request_id", sa.BigInteger(), nullable=True))
        batch_op.create_foreign_key(
            "fk_notifications_request_id_notification_requests",
            "notification_requests",
            ["request_id"],
            ["id"],
        )
        batch_op.create_index("ix_notifications_request_id", ["request_id"], unique=False)
    op.create_table(
        "suggestion_dismissals",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("target_account_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["target_account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "target_account_id", name="uq_suggestion_dismissal_accounts"),
    )
    op.create_index("ix_suggestion_dismissals_account_id", "suggestion_dismissals", ["account_id"], unique=False)
    op.create_index(
        "ix_suggestion_dismissals_target_account_id",
        "suggestion_dismissals",
        ["target_account_id"],
        unique=False,
    )
    op.create_table(
        "trend_reviews",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("approved", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("updated_by_account_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["updated_by_account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "key", name="uq_trend_review_kind_key"),
    )
    op.create_index("ix_trend_reviews_kind", "trend_reviews", ["kind"], unique=False)
    op.create_index("ix_trend_reviews_key", "trend_reviews", ["key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_trend_reviews_key", table_name="trend_reviews")
    op.drop_index("ix_trend_reviews_kind", table_name="trend_reviews")
    op.drop_table("trend_reviews")
    op.drop_index("ix_suggestion_dismissals_target_account_id", table_name="suggestion_dismissals")
    op.drop_index("ix_suggestion_dismissals_account_id", table_name="suggestion_dismissals")
    op.drop_table("suggestion_dismissals")
    with op.batch_alter_table("notifications") as batch_op:
        batch_op.drop_index("ix_notifications_request_id")
        batch_op.drop_constraint("fk_notifications_request_id_notification_requests", type_="foreignkey")
        batch_op.drop_column("request_id")
    op.drop_index("ix_notification_policy_overrides_from_account_id", table_name="notification_policy_overrides")
    op.drop_index("ix_notification_policy_overrides_account_id", table_name="notification_policy_overrides")
    op.drop_table("notification_policy_overrides")
    op.drop_index("ix_notification_requests_from_account_id", table_name="notification_requests")
    op.drop_index("ix_notification_requests_account_id", table_name="notification_requests")
    op.drop_table("notification_requests")
    op.drop_index("ix_notification_policies_account_id", table_name="notification_policies")
    op.drop_table("notification_policies")
