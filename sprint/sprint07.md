# Sprint 07 — Providers foundation + RSS in the home feed

Target: **Mockingbird** (standalone client). Client-side only, works against
mastodon.social; all state in localStorage. See `roadmap-providers.md` for the full
multi-provider plan — this sprint is **Phase 0 (foundation) + Phase 1 (RSS read-only)**.
All previous sprints are ON HOLD.

## Decisions (user-confirmed 2026-07-14)
- **No proxy, ever.** Direct browser fetch only. Enough feeds send CORS headers to be
  useful; feeds that don't get a clear error at add time. No proxy setting, no proxy
  fallback code.
- **No read/unread state for RSS.** Mockingbird lives with memory + localStorage,
  period. RSS items are timeline posts, not an unread queue.
- **Mastodon is primary; Bluesky is a "connection".** Bluesky linking goes in a new
  Settings → **Connections** tab (existing 2019-Twitter-style settings shell). This
  sprint ships the Connections page with RSS management + a Bluesky coming-soon card;
  actual Bluesky is the next sprint.
- Nitter = just an RSS URL (`https://<nitter-host>/<user>/rss`); docs recipe only.

## Task board
1. [x] Foundation: `ProviderId` + optional `Status.provider` in models; provider
       contract in `providers/provider.ts`; `EXTERNAL_FETCH` HttpContext token;
       auth interceptor must NOT send the Mastodon token to feed hosts; health
       interceptor must NOT fail-whale on feed errors.
2. [x] RSS provider under `providers/rss/`: parser (RSS 2.0 + Atom, DOMParser),
       adapter (item → Mastodon-shaped Status; HTML sanitized to an allowlist;
       images extracted to media_attachments; synthetic per-feed account with inline
       SVG avatar), subscriptions store (localStorage), fetch + provider services.
3. [x] `FeedAggregator`: merges Mastodon home pages with the RSS buffer newest-first,
       per-feed flood cap per page; Home uses it (behavior identical when no feeds).
4. [x] Command bar: [🦣 Fedi] [📡 RSS] filter chips on home when feeds are linked;
       persisted in ClientPrefs; display-filter only (no refetch on toggle).
5. [x] StatusCard: provider badge; foreign statuses get no account/thread links and
       an "Open original ↗" action instead of reply/boost/fav.
6. [x] Settings → Connections: add/list/enable/remove RSS feeds (validated by
       fetching; friendly CORS error), Nitter tip, Bluesky coming-soon.
7. [x] Specs for all of the above + lint + test + BOTH builds green.

## Handoff notes
- All foreign-provider code lives in `ui/src/app/providers/`. Blast radius on existing
  code: `models.ts` (+`ProviderId`, `Status.provider?`), the two interceptors (early
  return on `EXTERNAL_FETCH`), `ClientPrefs` (+`hiddenProviders`), `CommandBar`
  (+`providerChips` input), `Home` (aggregator instead of `api.homeTimeline`,
  `visible()` filter), `StatusCard` (foreign branch), settings shell/routes (+1 page).
- Merge correctness rule in `FeedAggregator`: while Mastodon has unfetched pages,
  foreign items older than the oldest buffered Mastodon item stay buffered. Flood cap:
  max 5 items per RSS feed per page (excess deferred to later pages).
- RSS ids are namespaced: account `rss:<feedUrl>`, status `rss:<feedUrl>::<guid>`.
- Feed HTML is reduced to a Mastodon-like tag allowlist; `<img>` are pulled out into
  `media_attachments` so the Images/Reader toggles apply; only http(s) `href` survives.
- Bluesky next sprint: registry is ready (`ProviderRegistry.all`), chips/badges/gating
  are generic; needs a `StatusActions` facade before write ops (see roadmap Phase 2/3).
- Chips are display-only filters; the aggregator always fetches all linked providers.

## Status log
- 2026-07-14: sprint created from roadmap; decisions recorded; work started.
- 2026-07-14: ALL TASKS DONE. 466 tests green (61 spec files), lint clean, both builds
  pass. Verified end-to-end with Playwright against the served mock (see
  `.claude/skills/verify/SKILL.md` for the recipe): added a local CORS feed via
  Settings → Connections, saw items merged into home with badge + "Open original",
  chips filtered per provider, no-CORS feed got the friendly error, no Authorization
  header ever reached the feed host, no fail whale on feed failure. 18/18 checks.
