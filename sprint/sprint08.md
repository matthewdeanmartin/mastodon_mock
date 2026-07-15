# Sprint 08 — Bluesky as a Connection (read + reply/like/repost)

Target: **Mockingbird**. Client-side only; Bluesky's XRPC API sends CORS `*`, so the
browser talks to bsky.social directly. Roadmap Phases 2+3 (`roadmap-providers.md`).
Builds on sprint07's provider layer — Bluesky slots into the existing registry,
chips, badges and aggregator.

## Decisions
- Auth: **app password** (user creates it at bsky.app Settings → App Passwords) via
  `com.atproto.server.createSession`; access/refresh JWTs in localStorage
  (`mockingbird_bsky_session`), auto-refresh on ExpiredToken, re-login on refresh
  failure. atproto OAuth is a later hardening (needs hosted client metadata).
- Linking lives in Settings → Connections (per sprint07 decision). No login-page
  changes.
- Capabilities: Bluesky posts get **reply / like / repost** (routed back to Bluesky)
  plus "Open original". Mastodon-only actions (bookmark, quote, translate, report,
  pin, edit…) stay hidden on foreign posts. RSS stays read-only.
- Replies use a Bluesky-specific inline composer (300 **graphemes**, not chars —
  `Intl.Segmenter`), with outgoing link facets and best-effort mention facets
  (`resolveHandle`). The shared Mastodon Compose is not touched.
- Bluesky thread view, notifications, follow-from-feed, search: NOT this sprint.

## Task board
1. [x] `Status.providerRef` (opaque per-provider handle) + `PROVIDER_CAPS` map.
2. [x] `providers/bluesky/`: session service (login/refresh/profile), XRPC api
       (getTimeline, createRecord/deleteRecord for like/repost/post), facet builder.
3. [x] Adapter: FeedViewPost → Status. Facets→HTML via UTF-8 byte offsets; images
       embed → media_attachments; external embed → link card; record embed → quote;
       reasonRepost → reblog wrapper; viewer.like/repost → favourited/reblogged.
4. [x] `StatusActions` facade (fav/boost routed by provider; Mastodon path identical
       to before); StatusCard actions capability-gated; bsky inline reply box.
5. [x] Connections page: link/unlink Bluesky (handle + app password), linked identity
       shown.
6. [x] Specs + lint + both builds + live verify against bsky.social.

## Handoff notes
- Like/repost undo works by keeping the created record's at-uri in
  `Status.providerRef` (`BskyRef.likeUri` / `repostUri`); the adapter seeds these
  from `viewer.like` / `viewer.repost` on timeline posts.
- Replying keeps `record.reply.root` as the thread root (`BskyRef.replyRoot`), so
  replies-to-replies thread correctly on Bluesky.
- Facet byte offsets are UTF-8 bytes, both directions (render and compose). The
  reply composer counts graphemes via `Intl.Segmenter`.
- Auth: `withRefresh` in bluesky-api retries once through `refreshSession` on
  400 ExpiredToken / 401. A dead refresh token surfaces as a provider error chip
  case (provider swallows into `errors`, feed keeps working) — the user relinks in
  Connections.
- Mastodon-only actions (bookmark/quote/translate/report/thread-reader/edit…) are
  hidden on foreign posts via `PROVIDER_CAPS` + the `foreign` branch, NOT removed —
  Mastodon cards are byte-identical to sprint07.
- NOT done (future): bsky thread view (getPostThread → Context), notifications,
  follow-from-feed, top-level bsky compose / cross-posting, atproto OAuth.

## Status log
- 2026-07-14: sprint created. Verified app password works against the real API
  (createSession 200 for mistersql.bsky.social; timeline shapes sampled for the
  adapter). Credentials in gitignored .env, never committed.
- 2026-07-14: ALL TASKS DONE. 497 tests green (65 files), lint clean, both builds
  pass. Live-verified against bsky.social with Playwright: linked the real account
  in Connections, saw the real timeline merged (11 bsky cards on page 1), replied
  from the feed (reply record confirmed on the PDS with correct reply refs, then
  deleted), liked + unliked (like record created and removed), chip filtering,
  unlink, and bad-password error. Test post + reply deleted afterwards — account
  left untouched. Gotcha for future verifies: AppView reads (getPostThread/getLikes)
  lag writes by seconds; verify via com.atproto.repo.listRecords on the PDS.
