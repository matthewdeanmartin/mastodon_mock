# Roadmap — Multi-provider Mockingbird (Bluesky + RSS/Nitter)

Status: ACCEPTED (2026-07-14). Multi-sprint roadmap; execution starts with sprint07
(Phase 0 + Phase 1). Open questions below are answered — see "Decisions".

## The pitch

Mockingbird is "a social client designed by a user": I don't care about ATProto vs
ActivityPub vs RSS, I want to follow my people and reply to them. My people are split
across mastodon.social, Bluesky, and (via Nitter/RSS) x.com.

Goal: when I sign into Mockingbird with my Mastodon account, it *also* signs into my
linked Bluesky account and pulls my RSS subscriptions, merges everything into one home
timeline, and lets me reply to each post **on the network it came from**. RSS/Nitter
items are read-only ("Open original ↗" instead of reply).

Non-goals (explicitly out of scope):
- Bluesky search, notifications-parity, DMs, profiles beyond a minimal card, admin.
- Cross-posting a single compose to multiple networks (maybe a distant stretch goal).
- Threads (it federates over ActivityPub; if it works via Mastodon, it works already).
- Running any Mockingbird backend. Everything stays client-side + localStorage
  (see the standing constraint: must work against real mastodon.social).

## Reality check: what the browser can and can't do

This is the part that decides the design, so it goes first.

| Provider | Read from browser? | Write from browser? | Auth |
|---|---|---|---|
| Mastodon | yes (today) | yes (today) | OAuth token (today) |
| Bluesky | yes — XRPC endpoints send `Access-Control-Allow-Origin: *` | yes | app password → `com.atproto.server.createSession` (accessJwt ~2h + refreshJwt); full atproto OAuth exists but needs hosted client metadata + DPoP — later |
| RSS (incl. Nitter) | **usually blocked by CORS** — most feeds don't send CORS headers | n/a (read-only by nature) | none |

So, counterintuitively, **RSS is the one with a machinery problem**, not Bluesky:

- **Bluesky**: authenticated `app.bsky.feed.getTimeline` against the user's PDS
  (bsky.social) works directly from the browser. Public reads also work unauthenticated
  via `public.api.bsky.app`. App passwords are created by the user in Bluesky settings —
  fits the "user pastes a token" login pattern Mockingbird already has.
- **RSS**: direct `fetch()` of an arbitrary feed URL fails CORS for many feeds — but
  enough feeds DO send permissive CORS headers to be useful. Decision: **direct fetch
  only, no proxy of any kind**. A feed that blocks browser access gets a clear error
  when the user tries to add it, and that's that.
- **Nitter**: just an RSS URL (`https://<nitter-host>/<user>/rss`). No special code —
  a docs recipe plus, at most, a URL helper in the add-feed form. The public Nitter
  ecosystem is unstable (instances come and go since Twitter closed guest access), so
  treat it as "any RSS" and let the user supply a working instance. This is why
  supporting *any* RSS is the right framing, not Nitter-specific support.

## Architecture: isolation strategy

The whole app speaks Mastodon: `Status`/`Account` models, `StatusCard`, reader mode,
filters, human-time — all of it. We keep it that way. **Foreign providers adapt their
content INTO Mastodon-shaped `Status` objects at the edge**, and the rest of the app
never learns ATProto or RSS exist.

All new code lives under `ui/src/app/providers/`:

```
providers/
  provider.ts          # the contract (interfaces only)
  feed-aggregator.ts   # merges provider pages into one timeline
  status-actions.ts    # routes fav/boost/reply/delete by status.provider
  provider-accounts.ts # linked-account store (localStorage)
  bluesky/
    bluesky-session.ts # createSession / refreshSession, token storage
    bluesky-api.ts     # thin XRPC calls (getTimeline, createRecord, ...)
    bluesky-adapter.ts # app.bsky post view -> Status (facets -> HTML, embeds -> media)
    bluesky-provider.ts
  rss/
    rss-fetch.ts       # direct fetch (no proxy; CORS failure = clear error)
    rss-parser.ts      # DOMParser: RSS 2.0 + Atom -> items
    rss-adapter.ts     # item -> Status (synthetic Account per feed)
    rss-provider.ts
```

### The contract (`provider.ts`)

```ts
export type ProviderId = 'mastodon' | 'bluesky' | 'rss';

export interface ProviderCapabilities {
  reply: boolean; favourite: boolean; reblog: boolean; follow: boolean;
}

export interface TimelinePage { statuses: Status[]; cursor: string | null; }

export interface FeedProvider {
  readonly id: ProviderId;
  readonly label: string;        // 'Bluesky', 'RSS'
  readonly caps: ProviderCapabilities;
  readonly linked: Signal<boolean>;   // account linked / feeds configured
  loadHomePage(cursor: string | null): Observable<TimelinePage>;
  // Write ops only where caps allow; all return Mastodon-shaped Status:
  reply(to: Status, text: string): Observable<Status>;
  favourite(s: Status): Observable<Status>;   unfavourite(...)
  reblog(s: Status): Observable<Status>;      unreblog(...)
}
```

### Minimal touches to existing code (the entire blast radius)

1. **`models.ts`**: `Status` and `Account` gain two optional fields:
   `provider?: ProviderId` (absent = mastodon) and `providerRef?: unknown` (opaque
   handle the owning provider needs later — e.g. Bluesky `{uri, cid, likeUri}`;
   RSS item link). Foreign ids are namespaced (`bsky:at://...`, `rss:<feed>:<guid>`)
   so id-based dedupe/delete in timelines can't collide with real Mastodon ids.
2. **`StatusCard`**: swap direct `inject(Api)` calls for the `StatusActions` facade
   (which defaults to `Api` for Mastodon — behavior identical), and gate action
   buttons on the provider's capabilities. This is the one real refactor.
   RSS cards show "Open original ↗" where reply/boost/fav would be.
3. **`Home` page**: swap `api.homeTimeline()` for `FeedAggregator.loadHome()`.
   With no foreign providers linked, the aggregator delegates straight to
   `api.homeTimeline()` — zero behavior change, zero extra requests.
4. **`CommandBar`**: provider filter chips (see UI below).
5. **`ClientPrefs`**: new persisted keys (provider filter state).
   Bluesky session + RSS subscriptions live in their own localStorage keys owned by
   `providers/` code, not in ClientPrefs.

Everything else — thread page, profile, search, notifications, admin, settings —
stays Mastodon-only and untouched.

### Merging (`feed-aggregator.ts`)

- K-way merge by `created_at`, newest first. Each provider keeps its own cursor
  (Mastodon `max_id`, Bluesky `cursor`, RSS "position in the already-fetched sorted
  item buffer" — feeds have no pagination, so fetch whole feeds once per refresh and
  dole items out as the merge asks for them).
- A provider erroring (bsky down, feed 404) must not break the page: log, show a
  small per-provider error chip, keep merging the rest.
- Flood control: an RSS feed that publishes in bursts could wallpaper the timeline.
  v1 heuristic: max N consecutive items from the same RSS feed per page (start N=3);
  smarter mixing is a later phase, and the filter chips are the real escape hatch.
- Live/streaming stays Mastodon-only (Bluesky/RSS refresh on pull; maybe polling later).

### UI

- Command bar, next to 📖 Reader: **[🦣 Fedi] [🦋 Bsky] [📡 RSS]** toggle chips.
  All on by default; state persisted in ClientPrefs. Chips only render when the
  corresponding provider is linked, so today's UI is unchanged until you opt in.
- Status cards get a small provider badge (🦋 / 📡 + feed title) near the timestamp.
- Reply on a Bluesky status opens the existing inline Compose but routed through the
  Bluesky provider, with a **300-grapheme** limit indicator (vs Mastodon's 500).
- Settings → new "Connections" page: link/unlink Bluesky (handle + app password,
  with a link to bsky.app's app-password settings and copy explaining *why* app
  passwords, not your real password), manage RSS subscriptions (add URL → auto-detect
  title, list with per-feed enable/remove), CORS proxy setting, Nitter recipe blurb.

### Security notes (be honest in the docs)

- Bluesky refreshJwt in localStorage is the same trust level as the Mastodon token we
  already store — acceptable for this app, but say so. Recommend app passwords (they
  are revocable and can't touch account settings/DMs by default).
- RSS content is untrusted HTML from arbitrary origins. It renders via `[innerHTML]`,
  which Angular sanitizes, but the adapter should additionally strip to a tag
  allowlist (like Mastodon HTML: p, br, a, span, strong, em...) so feed garbage can't
  even reach the sanitizer weirdly. Media URLs from feeds load from foreign origins —
  respect the existing images on/off pref.

## Phases

### Phase 0 — Foundation (no visible change)
- `provider.ts` contract, `Status.provider`/`providerRef` fields, namespaced-id helper.
- `StatusActions` facade; migrate `StatusCard` (and inline Compose reply path) to it.
- `FeedAggregator` wrapping the Mastodon home timeline only; `Home` uses it.
- Full spec coverage; both builds green. Exit criterion: diff review shows the app
  behaves byte-identically with no providers linked.

### Phase 1 — RSS, read-only (proves the whole pipeline)
- `rss-parser` (RSS 2.0 + Atom via DOMParser), `rss-fetch` (direct fetch only),
  adapter (synthetic per-feed `Account`), provider, merge.
- Subscriptions UI in Settings → Connections; command-bar chips; provider badge;
  capability-gated cards ("Open original ↗").
- Docs: Nitter recipe; which-feeds-work (CORS) explainer.
- Cheapest provider, and it forces every architectural seam (merge, chips, badges,
  capability gating) to exist before the more expensive Bluesky work.

### Phase 2 — Bluesky, read-only
- Session service: createSession, proactive refreshSession, localStorage persistence,
  re-login flow on invalid refresh token.
- `getTimeline` → adapter: rich-text **facets → HTML** (mentions, links, tags),
  embeds → `media_attachments` (images) / link-card-ish content / `quote` (record
  embeds), repost reason → `reblog`, reply refs → `in_reply_to_id`.
- Merged into home; login page/Connections gets the "link Bluesky" flow.

### Phase 3 — Bluesky interactions ("reply to my peeps")
- Reply: `com.atproto.repo.createRecord` (app.bsky.feed.post) with reply refs
  (root+parent cid/uri from `providerRef`), 300-grapheme counting, mention/link
  facet generation from the compose text.
- Like/unlike, repost/unrepost (create/deleteRecord; keep the returned like/repost
  record uri in `providerRef` so undo works), follow from the feed card.
- Thread view: `getPostThread` mapped to Mastodon `Context` so the existing thread
  page + reader mode work on Bluesky threads.

### Phase 4 — Polish / stretch
- Smarter mixing (per-source weights, "catch-up" grouping of prolific feeds).
- Cross-post dedupe (same human on two networks posting the same text — collapse).
- Bluesky notifications merged into the notifications page; polling "live" for bsky.
- OPML import/export for RSS; export/import of all connection settings.
- atproto OAuth migration (needs a hosted `client-metadata.json` — GitHub Pages works).
- Maybe: top-level compose "also post to Bluesky" checkbox.

## Testing strategy

- Adapters and the merge are pure functions → straight unit tests with fixture JSON
  (real captured getTimeline responses, real gnarly RSS/Atom samples incl. missing
  dates, CDATA, broken HTML).
- Extend the existing `mock-api.mockingbird.ts` pattern with fixture-backed Bluesky
  XRPC and RSS endpoints so e2e-ish specs run offline.
- The Python mock server stays Mastodon-only; it is not growing bsky endpoints.

## Decisions (user-confirmed 2026-07-14)

1. **No CORS proxy at all** — not hosted, not configurable, no fallback code. Direct
   browser fetch only; enough real feeds send CORS headers. Feeds that don't get a
   clear error when the user tries to add them.
2. **No RSS read/unread state.** Mockingbird lives with memory + localStorage only;
   RSS items are timeline posts, not an unread queue.
3. **Bluesky is a "connection", Mastodon is primary.** Linking lives in a new
   Settings → Connections tab (existing 2019-Twitter-style settings shell), not on
   the login page.
