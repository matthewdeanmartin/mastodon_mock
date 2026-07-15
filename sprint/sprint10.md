# Sprint 10 — (handoff draft; not started)

Target: **Mockingbird**. Written at the end of sprint09 so the next session can
pick up cold. Standing constraints: client-side only, must work against real
mastodon.social; Bluesky spoken directly over XRPC (CORS `*`); prefs in
localStorage via ClientPrefs. Bluesky test account: mistersql.bsky.social, app
password in gitignored `.env` as `BSK_APP_PASSWORD` (needed only for live
verification, not for unit tests or builds).

## First: verify sprint09 live

Sprint09 shipped on unit tests + builds only — no runtime pass. Use the `verify`
skill / Playwright against the mock server, and bsky.social for the Bluesky legs:

1. Compose target picker (Settings → Connections → link Bluesky first):
   - default is 🦣 Fedi; picker hidden when not linked and on reply/quote composers.
   - `bsky` target: post goes to the PDS (check via `com.atproto.repo.listRecords`
     — AppView reads lag writes by seconds), card appears locally, **delete the
     test post from the account afterwards**.
   - `both`: Fedi post + bsky record; kill the network mid-flight to see the
     cross-post error banner.
2. Profile toggles on a busy account (Boosts/Replies/Pinned), incl. an account
   with >20 filtered-out posts so the fetch-until-20 loop actually pages.
3. Notifications: mention with an image shows thumbs; no hover underline.
4. Hover a name/avatar in the feed → card after ~half a second, doesn't block clicks.
5. Blue-check radios in Settings → Mockingbird Blue; "everyone" should check
   every card instantly.
6. Undo-send: enable only "wait 30 seconds" → no confirm dialog, countdown with
   Publish now + Cancel.
7. House ads: all three render in the right rail — **window must be ≥1240px wide**
   (below that `shell.css` hides `.rail-right`). They were invisible to
   ad-blocker users because the old `.ad-*` class names matched EasyList
   cosmetic filters; now `.spotlight-*`. Verify WITH uBlock enabled.

## Candidate scope (from roadmap Phase 4 + sprint09 leftovers)

- **Bluesky notifications** merged into the notifications page
  (`app.bsky.notification.listNotifications` → MastodonNotification shapes;
  polling, no streaming). This is the biggest remaining Phase 4 item.
- **Bluesky thread view**: `getPostThread` → Mastodon `Context` so the existing
  thread page + reader mode work on bsky posts (planned in phase 3, still absent).
- **Cross-post dedupe**: same text from the same human on two networks within a
  window → collapse into one card with both badges.
- **Smarter RSS mixing** (per-source weights, catch-up grouping).
- **OPML import/export** for RSS; export/import of all connection settings.
- **House ads below 1240px**: decide whether ads should appear somewhere (feed
  card? footer?) on narrow viewports, or stay desktop-only.
- **Hover card reach**: currently only on StatusCard avatar/name. Consider the
  notifications page and account list dialogs. Also consider fetching fresh
  account data on hover for stale embedded accounts (adds requests; debate).
- **Media on Bluesky compose**: uploading blobs (com.atproto.repo.uploadBlob)
  would lift the text-only restriction on the bsky/both targets.

## Gotchas carried forward

- `ng test` (vitest builder) is the only way to run specs — raw `npx vitest run`
  fails with JIT/localStorage errors (no Angular setup). Full suite:
  `npm run test:ci` in `ui/`. Targeted runs aren't supported; run the suite.
- Suite is slow on this machine (~1 min); shell.spec switching tests carry
  `{ timeout: 20_000 }` for that reason.
- Mastodon filters account statuses per page → short pages; that's why
  Profile.loadStatuses loops (cap: 8 pages of 20).
- AppView reads (getPostThread/getLikes) lag PDS writes by seconds; verify
  writes via listRecords on the PDS (sprint08 note, still true).
- Legacy `undoSend` localStorage key migrates to `confirmBeforePost` +
  `delayedSend` on ClientPrefs load; don't reintroduce the old key.

## Status log
- 2026-07-15: drafted at sprint09 close. Nothing implemented yet.
