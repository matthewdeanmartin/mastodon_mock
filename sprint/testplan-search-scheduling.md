# Test plan — search upgrades + scheduled posts (handoff for next bot)

No tests were written for this change set (by request). This is the plan.

## What changed

- **Search page** (`ui/src/app/pages/search/`):
  - Idle state (no query) now shows **trending posts** when type=Posts and
    **trending hashtags** when type=Hashtags (reuses `/api/v1/trends/*`,
    fetched once lazily). Accounts idle state unchanged (find-people embed).
  - New **Advanced ▾** panel: date pickers for `before:` / `after:` /
    `during:` — `applyAdvanced()` strips any hand-typed date operators from
    the query, appends picked ones, forces type to `statuses`, and searches.
    These are mastodon.social full-text-search operators (server-side).
  - Trending post cards use separate `onTrendChanged/onTrendDeleted` handlers
    (results handlers only touch `results()`).
- **Scheduling** (new everywhere):
  - `models.ts`: `ComposeOptions.scheduledAt`, new `ScheduledStatus`.
  - `api.ts`: `postStatus` serializes `scheduled_at`; new
    `scheduledStatuses()` (GET) and `cancelScheduledStatus(id)` (DELETE)
    against `/api/v1/scheduled_statuses`.
  - Compose (`compose/`): 🕒 toolbar button (hidden for replies/quotes) opens
    a `datetime-local` row; `scheduleActive` blocks threads and Bluesky
    targets via `canSubmit`; submit button reads "Schedule"; success resets
    the composer and flashes "Scheduled for …". Warning hint when the time is
    < ~6 min out (server publishes immediately under ~5 min —
    `SCHEDULE_THRESHOLD` in `mastodon_mock/routers/statuses.py`).
  - Drafts page (`pages/drafts/`): new "Scheduled" group under drafts —
    lists server-side scheduled posts with badges (CW/poll/media), cancel
    with confirm dialog. Anonymous/demo: fetch error → empty state.
  - Nav link renamed to "Drafts & scheduled" (`shell/shell.html`).

`npm run build` passes. `npm run test:ci` was NOT run (only runner that
works — see memory: raw vitest fails, no targeted runs).

## First: run the existing suite

`cd ui && npm run test:ci`. Watch for:

- `search.spec.ts` — component now fires two trend GETs on empty-query init.
  No `httpMock.verify()` exists today so it should pass, but if you add
  specs with `verify()`, flush/expect `/api/v1/trends/statuses` and
  `/api/v1/trends/tags`.
- `compose.spec.ts` / `api.spec.ts` — should be unaffected; confirm.

## Unit tests to add

Search (`search.spec.ts`):
1. Empty query + type=statuses → trend requests fire; flushed posts render
   as status cards; switching type to hashtags renders tag links without
   refetching (single-fetch guard `trendsRequested`).
2. `applyAdvanced()` with query `cats before:2020-01-01` and pickers
   after=2024-01-01: hand-typed `before:` stripped, `after:2024-01-01`
   appended, type forced to `statuses`, navigation triggered.
3. `applyAdvanced()` with empty query and no dates → no navigation.
4. Trend card `deleted` event removes from `trendingPosts`, leaves
   `results` null.

Compose (`compose.spec.ts`):
5. Schedule set (>10 min out) → body includes ISO `scheduled_at`; on flush,
   composer resets and `posted` does NOT emit.
6. Schedule set + thread box with text → `canSubmit()` false.
7. `toggleSchedule()` off clears `scheduleAt`.
8. `scheduleTooSoon()` true for +2 min, false for +30 min.

Drafts page (new spec):
9. GET scheduled flushed with one row → renders under "Scheduled" with
   time + badges; cancel → confirm → DELETE fired → row removed.
10. GET errors (401) → "Nothing scheduled" state, page still shows drafts.

## Runtime verification (use the `verify` skill; no screenshots needed)

Against the mock server:
1. /search: with empty box flip the type select through all three — Posts
   shows trending posts (seed data dependent), Hashtags shows trending tags,
   Accounts shows find-people.
2. Advanced panel: pick dates, Apply & search — query box shows the
   operators, type select flips to Posts. NOTE: verify what the mock
   server's `/api/v2/search` does with `before:`-style tokens (it may treat
   them as literal text and return nothing — that's acceptable; the real
   target is mastodon.social).
3. Compose 🕒: schedule a post 15 min out → "Schedule" button, success
   flash, post appears on /drafts under Scheduled; cancel it (DELETE 200,
   row gone). Schedule 2 min out → warning hint shows, and on submit the
   server publishes immediately (returns a Status) — confirm the composer
   still resets cleanly and the flash message doesn't lie too badly (known
   soft spot).
4. Backend auto-publish: schedule ~6 min out, wait, reload /drafts —
   `list_scheduled` publishes due rows; the item should move to the home
   timeline.
5. Reply/quote composers: 🕒 button absent. Conversations (compact)
   composer: 🕒 present and row fits.
6. Demo/anonymous mode: /drafts must not error — scheduled section shows
   the empty state.

Against mastodon.social (careful — real account @mistersql, token in .env):
7. Search `before:`/`after:` operators on a common word — confirm operators
   filter (full-text search requires the account to be opted in; results
   are limited to own/interacted posts for statuses type).
8. OPTIONAL, invasive: schedule a real post far in the future, verify it
   lists via GET, then DELETE it immediately. Prefer read-only GET
   /api/v1/scheduled_statuses if hesitant.

## Decisions made (were open questions)

- "Too soon" schedule: compose now detects the response shape (`params` in
  it → ScheduledStatus, else a published Status), emits `posted` and says it
  posted immediately. Test both branches (unit test #5 covers the scheduled
  branch; add one for the immediate branch).
- Scheduling with media/polls stays allowed in the UI — still untested
  end-to-end, verify per runtime step 3.
- Nav label reverted to plain "Drafts".
- Advanced ▾ button and panel only render when search type = Posts.

## Also added since: tweet terminology pref

`ClientPrefs.postNoun` ('post' | 'tweet', default 'post'), radio in
Settings → Mockingbird Blue next to stars/hearts. `Terminology` service
(`src/app/terminology.ts`) exposes a `words()` computed consumed by
status-card, compose (submit button), thread reader, profile, left-rail,
account-list dialog. Tests to add: pref persists/loads; flipping it live
swaps "Boost"→"Retweet" titles and "Post"→"Tweet" submit label; unknown
stored value falls back to 'post'.
