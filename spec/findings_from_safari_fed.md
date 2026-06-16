# Findings from proving the mock against `safari_fed`

Date: 2026-06-14. Context: `safari_fed` is the Mastodon client inside the
`safari_writer` retro TUI suite — a keyboard-first fediverse reader/poster with
both read and write features. It was pointed at this mock (booted as a local
HTTP server) to add integration coverage and to surface mock gaps. Because the
mock is local-only and stateful, the write surface is safe to exercise here.

## Result: no mock bugs found

`safari_fed` drove a broad slice of the API and every surface behaved
faithfully. Verified working:

**Read / sync aggregation** (`SafariFedClient.fetch_sync_result`):

- `account_verify_credentials`, `timeline_home`, `bookmarks`, `notifications`
  all return the shapes the client normalizes.
- Hashtags render (`tags` populated from seeded `#…` text).
- `@mention` notifications carry `type="mention"` + a `status`, so they're
  flagged correctly; the summary counter matches.
- Boosts render: a reblog row in the home timeline has the nested `reblog`
  payload the client uses to produce its "Boosted by @…" prefix.

**Write** (`send_post`, `favourite`, `reblog`, `bookmark`, `unbookmark`):

- `status_post` with `visibility`, `in_reply_to_id`, and `spoiler_text` —
  replies thread, visibility is honored, CW renders.
- `direct`/`private` visibility flow through and flag the post.
- favourite / reblog / bookmark / unbookmark all succeed; a bookmarked status
  appears in `/api/v1/bookmarks` on the next sync and disappears after
  unbookmark (the stateful guarantee).

**Media** (probed, works):

- `POST /api/v2/media` accepts an upload and returns an id; posting with
  `media_ids[]` attaches it; the attachment serializes with `type` +
  `description`, which the client renders as `[IMAGE] <desc>`.

## Takeaway

This is the cleanest consumer so far: a full read+write TUI client exercised the
mock's timeline, notification, status-write, social-action, and media surfaces
with zero divergences. Contrast `activist` (found a status-validation gap on the
write path — see `findings_from_activist.md`) and `mastodon-finder` (no mock
bugs, but surfaced the Mastodon.py `MaybeSnowflakeIdType` id gotcha — see
`findings_from_mastodon_finder.md`).
