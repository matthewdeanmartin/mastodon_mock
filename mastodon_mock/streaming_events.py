"""Translate write-path side effects into streaming events.

Sits between the routers and the :mod:`mastodon_mock.streaming` bus: given a
freshly written ``Status`` (or notification), it works out the channel keys the
event belongs to — following Mastodon's visibility rules — serializes the entity
once, and publishes it. See spec/streaming.md "Event sources".

All functions are no-ops when streaming is disabled (no bus on the app), so
routers can call them unconditionally.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import (
    Account,
    Notification,
    Relationship,
    Status,
    StatusMention,
    StatusTag,
    UserListAccount,
)
from mastodon_mock.streaming import (
    direct_channel,
    get_bus,
    hashtag_channel,
    list_channel,
    publish,
    user_channel,
)

_PUBLIC_VISIBILITIES = {"public", "unlisted"}
# Visibilities that reach a follower's home timeline.
_HOME_VISIBILITIES = {"public", "unlisted", "private"}


def _status_channels(session: Session, status: Status) -> set[str]:
    """Channel keys an ``update``/``status_update``/``delete`` for ``status`` reaches."""
    channels: set[str] = set()
    author = session.get(Account, status.account_id)
    visibility = status.visibility or "public"

    # Author always sees their own post on their user stream.
    channels.add(user_channel(status.account_id))

    if visibility in _HOME_VISIBILITIES:
        followers = session.scalars(
            select(Relationship.source_account_id).where(
                Relationship.target_account_id == status.account_id,
                Relationship.following.is_(True),
            )
        ).all()
        for follower_id in followers:
            channels.add(user_channel(follower_id))
            for list_id in _lists_containing(session, owner_id=follower_id, member_id=status.account_id):
                channels.add(list_channel(list_id))

    if visibility in _PUBLIC_VISIBILITIES:
        channels.add("public")
        channels.add("public:remote" if author and author.domain else "public:local")
        for name in _tag_names(session, status.id):
            channels.add(hashtag_channel(name))
            if not (author and author.domain):
                channels.add(hashtag_channel(name, local=True))

    return channels


def _lists_containing(session: Session, *, owner_id: int, member_id: int) -> list[int]:
    """List ids owned by ``owner_id`` that contain ``member_id``.

    ``UserListAccount`` has no owner column, but ``user_lists`` does; we join via the
    list's owner so a subscriber only gets streamed posts for *their* lists.
    """
    from mastodon_mock.db.models import UserList

    rows = session.execute(
        select(UserListAccount.list_id)
        .join(UserList, UserList.id == UserListAccount.list_id)
        .where(UserList.account_id == owner_id, UserListAccount.account_id == member_id)
    ).all()
    return [r[0] for r in rows]


def _tag_names(session: Session, status_id: int) -> list[str]:
    """Lowercased hashtag names attached to a status."""
    return list(session.scalars(select(StatusTag.name).where(StatusTag.status_id == status_id)).all())


def _direct_recipients(session: Session, status: Status) -> set[int]:
    """Accounts that should receive a ``direct``-visibility status as a conversation."""
    recipients = set(
        session.scalars(select(StatusMention.account_id).where(StatusMention.status_id == status.id)).all()
    )
    recipients.add(status.account_id)
    return recipients


def emit_status_event(
    app: FastAPI,
    session: Session,
    status: Status,
    config: MastodonMockConfig,
    *,
    name: str,
) -> None:
    """Publish a status ``update`` or ``status_update`` to its channels.

    ``direct`` statuses are delivered as ``conversation`` events on the ``direct``
    channel instead (matching ``stream_direct``).
    """
    if get_bus(app) is None:
        return

    if (status.visibility or "public") == "direct":
        _emit_conversation(app, session, status, config)
        return

    from mastodon_mock.serializers.statuses import serialize_status

    payload = serialize_status(session, status, config, None)
    publish(app, name, payload, _status_channels(session, status))


def emit_status_delete(app: FastAPI, session: Session, status: Status) -> None:
    """Publish a ``delete`` event (payload is the bare status id string)."""
    if get_bus(app) is None:
        return
    from mastodon_mock.serializers.common import sid

    publish(app, "delete", sid(status.id), _status_channels(session, status))


def _emit_conversation(app: FastAPI, session: Session, status: Status, config: MastodonMockConfig) -> None:
    """Publish a ``conversation`` event for a direct status to each recipient."""
    from mastodon_mock.serializers.common import sid
    from mastodon_mock.serializers.statuses import serialize_status

    last_status = serialize_status(session, status, config, None)
    for account_id in _direct_recipients(session, status):
        payload: dict[str, Any] = {
            "id": sid(status.id),
            "unread": True,
            "accounts": [last_status["account"]],
            "last_status": last_status,
        }
        publish(app, "conversation", payload, {direct_channel(account_id)})


def emit_notification(
    app: FastAPI,
    session: Session,
    notification: Notification,
    config: MastodonMockConfig,
) -> None:
    """Publish a ``notification`` event to the recipient's user stream."""
    if get_bus(app) is None:
        return
    from mastodon_mock.serializers.notifications import serialize_notification

    recipient = session.get(Account, notification.account_id)
    payload = serialize_notification(session, notification, config, recipient)
    publish(app, "notification", payload, {user_channel(notification.account_id)})


def flush_stream_notifications(app: FastAPI, session: Session, config: MastodonMockConfig) -> None:
    """Stream and clear any notifications buffered on the session by ``add_notification``.

    Call once *after* ``db.commit()`` so the rows have their ids and the serialized
    payload is complete. A no-op when streaming is disabled or nothing was buffered.
    """
    buffered: list[Notification] = session.info.pop("stream_notifications", [])
    if get_bus(app) is None or not buffered:
        return
    for notification in buffered:
        emit_notification(app, session, notification, config)
