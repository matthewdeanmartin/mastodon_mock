# Sprint 05 — House ads, action-state UX, Mockingbird Blue settings, reader v2, footer

All client-side (works vs mastodon.social); prefs in localStorage via `ClientPrefs`.
Continues sprint04's Blue features based on user feedback (2026-07-14).

## Decisions (user-confirmed)
- Feed reader mode + images toggle: **global prefs, all timelines respect them**.
- Fail whale footer link: **fun demo page** at /fail-whale (no side effects).
- Reader-mode reply button: **inline composer** under the post, stay in reader.
- Footer: **end of the feed column** (scrolls with content, after last post).

## Task board
1. [x] MIMB house ad: move to TOP of right rail (user can't find it below the fold).
2. [x] Action-state UX: rounded accent box around active ⭐/🔁/🔖 etc (.action.on).
3. [x] ClientPrefs v2: reader typography (fontFamily serif|sans|mono, fontWeight,
       lineHeight, letterSpacing, wordSpacing, textAlign left|justify) + feedReader
       + showImages booleans. Exposed as --reader-* CSS vars on <html>.
4. [x] Shared settings widgets: `settings/blue/blue-controls.ts` (theme+accent+undo-send
       + reader typography) used by BOTH the new "Mockingbird Blue" page and Appearance.
5. [x] New settings page + nav item "Mockingbird Blue" (top of Preferences area).
6. [x] Thread reader v2: typography vars applied; compact per-post action bar
       (💬 inline composer / 🔁 / ⭐ / 🔖, same size as feed); comments (non-chain posts)
       at bottom styled like blog comments.
7. [x] Command bar on timelines (home + public): Go Live · Reader · Images(🖼️) · A−/A+
       (font size, shown in reader). StatusCard reads prefs directly → all feeds respect.
8. [x] Images off / feed reader: media replaced by "🖼️ N" chip that opens the lightbox.
9. [x] Right rail: refetch instance info + donate host when account/server changes (effect).
10. [x] Footer at end of feed column: instance rules/ToS link, Mockingbird source
       (github.com/matthewdeanmartin/mastodon_mock), fail whale.
11. [x] /fail-whale demo route (art on demand, no side effects).
12. [x] Go Live: investigate; force timeline refresh when toggled on. (Was real but
       silent-failed vs mastodon.social; now refreshes feed on enable.)
13. [x] Specs + lint + both builds. (All 52 spec files green; shell.spec/status-card
       timeout flakes still occur under load — rerun before blaming a change.)

## Status log
- 2026-07-14: created after user feedback; questions answered (see Decisions).
- 2026-07-14: ALL TASKS DONE. Committed. 52 spec files green, lint clean, both builds pass.
  Go Live findings: the client streams via SSE EventSource at /api/v1/streaming/* which the
  mock serves, but real Mastodon only offers WebSocket streaming (wss://streaming.<host>) —
  so Go Live silently does nothing against mastodon.social (EventSource errors are swallowed).
  Now at least it refetches on enable. A follow-up could add a WebSocket fallback.
- 2026-07-14: follow-up done — streaming.ts rewritten WebSocket-only (no fallback chain:
  the mock already serves the real WS wire format at /api/v1/streaming, so one code path
  covers both mock and real instances; real Mastodon dropped SSE in 4.2). WS host is
  discovered from /api/v2/instance configuration.urls.streaming (mastodon.social streams
  from wss://streaming.mastodon.social, a separate subdomain); the mock uses the UI origin
  since its instance payload advertises the configured domain, which the browser may not
  reach. Adds reconnect-with-backoff (WebSocket, unlike EventSource, never auto-reconnects).
  User-confirmed decisions: WebSocket-only; no polling fallback; URL from instance API.
