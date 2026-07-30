# Roadmap — making the read-only experience the good one

Status: COMPLETE (2026-07-29). All three sprints shipped.
Decisions below are answered — see "Decisions taken".

## The pitch

Mawkingbird already lets you read Mastodon without an account: public timelines, profiles,
threads, hashtags, browser-local follows, browser-local lists (`anonymous-mastodon-sprint01`
through `08`). The reading works. What is missing is the part that makes a reader *stay*:

- **An anonymous visitor's Home feed starts empty**, and the only way out is to find
  twenty interesting accounts one at a time. Meanwhile every interesting account you land
  on is already carrying a curated list of interesting accounts — the people they follow.
- **When search doesn't work, we say "No results."** That is not a smaller version of the
  truth, it is a different claim. Plenty of instances disable anonymous search, and plenty
  more run without Elasticsearch, where account search works fine and post search returns
  `[]` forever. Both look identical to "nobody has ever posted about this".
- **Anonymous visitors cannot translate anything.** `POST /statuses/:id/translate` needs a
  token, so `canUseServerActions` takes the 🌐 button away — and a reader hitting a
  language they don't speak is exactly the reader we are trying to keep.

Each of these three is fixed by something the app already owns most of: `AnonymousFollows`
does browser-local follows, `probeSearchServer` already knows how to tell a live search
index from a dead one, and the OpenRouter connection landed last sprint.

The spillover to signed-in users is not a side effect, it is the reason the ordering works:

| Sprint | Anonymous gets | Signed-in gets |
|---|---|---|
| 1 | An honest search page and a way to find a search server that works | The same honest search page — the no-Elasticsearch case hits authenticated users identically |
| 2 | A one-click path from an empty Home feed to twenty good follows | Nothing (deliberately — see decision 3) |
| 3 | Translation at all | A choice of translator, and AI translation of posts the server won't translate |

## Non-goals

- **No server-side bulk following, ever.** Sprint 2 is anonymous-only for exactly this
  reason. See decision 3 — this is the sharpest constraint in the roadmap.
- **No new backend.** Everything stays client-side + localStorage, as always.
- **No crowd-sourced search-server registry.** The rejected-server list in sprint 1 is
  per-browser. Publishing "servers that let you search" as a shared list would be building
  a scraping target with our users' names on it.
- **No translation of anything the user wrote.** Translation is read-side only. The
  composer does not get an AI button; that is content generation, still out of scope
  (`openrouter-0-overview.md` non-goals).
- **No automatic translation of whole timelines.** Per-post, on click. A feed that
  silently rewrote every post through an LLM would be a different app.

## Decisions taken (from Matthew, 2026-07-29)

1. **Search truth ships first**, ahead of the more exciting clone-follows work. It is the
   only one of the three that is a *correctness* bug rather than a missing feature: the app
   currently makes a false statement to the user. It is also the cheapest — `probeSearchServer`
   already exists — and it makes the other two easier to demo, since search is how you find
   accounts to clone and posts to translate.
2. **"Clone friends list" copies the viewed account's follows**, from
   `GET /api/v1/accounts/:id/following`. Not a friends-of-friends ranking across your own
   graph. The plain reading of the feature name is also the cheap one: you liked this
   person's taste, so you adopt their follows.
2a. **Candidates are quality-gated, and the gate is why it pages.** An anonymous follow slot
   is expensive in a way a server-side follow is not: the home feed is assembled by one API
   call *per followed account* (`AnonymousMastodonProvider.createFollowFeed`), so following
   somebody who last posted eleven months ago spends a call on every feed refresh forever,
   to return nothing. `ANONYMOUS_FOLLOW_LIMIT` is 50 for the same reason. So we filter, and
   because filtering removes candidates we page `/following` until we have enough survivors
   or run out — one page of eighty follows can easily yield fewer than twenty keepers.
   **The primary signal is post frequency: do they post enough, and did they post recently.**
   Both are free — `/following` returns full `Account` objects, and `statuses_count` and
   `last_status_at` are already on them (`models.ts:46-47`), so scoring costs zero extra
   requests. The scorer is written as a list of named signals with post-frequency as the
   first, not as one hardcoded predicate, because Matthew expects more signals later.
3. **"Clone friends list" is suppressed when signed in, and this is a safety decision, not
   a scoping one.** Anonymous follows are rows in `localStorage` — cloning twenty of them
   sends *zero* write requests to anybody's server. The same button for a signed-in user
   would fire twenty `POST /accounts/:id/follow` calls in a row, which is indistinguishable
   from a follow-bot and is how people get suspended. The feature is safe *because* it is
   anonymous-only. Do not "improve" this later by adding a rate limiter and turning it on
   for authenticated users.
4. **The search-capability probe is lazy: it runs when a search returns zero results**, not
   on page load. Zero is the only moment the answer changes what we display, and probing
   eagerly would spend a call on every visit to the search page to answer a question that
   almost always has the boring answer.
5. **Account search and post search are probed separately, because they fail separately.**
   A Mastodon server without Elasticsearch answers `type=accounts` correctly and returns
   `[]` for `type=statuses` permanently. One "search is disabled" flag would be wrong on
   the most common broken configuration there is. Two canaries, two answers, and the UI can
   say "account search works here; post search is not available on this server".
6. **Rejected search servers are remembered, and there is a button to forget them.**
   Discovery never re-probes a domain that already failed — that is the whole point, the
   directory is ~1000 servers and most of them 401. But a server that turns search on
   should become findable again, so the list is clearable and shows what it is holding.
7. **The translate default for signed-in users is "always use the server".** The server
   translation is already there, costs the user nothing, and is what they have today.
   AI translation is opt-in. The three states are ask / always-AI / always-server.
8. **The 🤖🌐 translate button is visible for anonymous users even when OpenRouter is not
   connected**, showing an upsell instead of doing nothing. This is a deliberate exception
   to `openrouter-0-overview.md` decision 9 ("helper buttons are hidden when OpenRouter
   isn't connected — no upsell, no teaser"). The reasoning that justified that rule does
   not hold here: the search and tag helpers are *additions* to surfaces that work without
   them, so hiding them costs a power user nothing. For an anonymous reader there is no
   other translate button at all, so hiding it makes the capability invisible rather than
   merely unavailable. One exception, written down, with the rule it breaks named.

## Sprints

| # | File | Theme | Ships | Risk |
|---|---|---|---|---|
| 1 | `anonymous-great-1-search-truth.md` | `SearchCapability` probe; "search disabled" ≠ "no results"; search-server discovery; persistent reject list | ✅ **DONE** 2026-07-29 | Low. Extends an existing probe; one extra API call, only on a zero-result search |
| 2 | `anonymous-great-2-clone-friends.md` | Profile `•••` menu reorder; clone the viewed account's follows into `AnonymousFollows` | ✅ **DONE** 2026-07-29 | The bulk-follow blast radius, contained by decision 3 (anonymous-only, zero writes) |
| 3 | `anonymous-great-3-ai-translation.md` | `OpenRouterChat.complete()` text path; third prompt template; 🤖🌐 on every post; ask/always-AI/always-server | ✅ **DONE** 2026-07-29 | First non-JSON LLM call in the app — no schema to hide behind |

Sprints 2 and 3 are independent of each other and of 1.

## Files that will change (map for all sprints)

**Sprint 1**

- `ui/src/app/search-server-probe.ts` — gains a statuses canary and a reusable capability shape.
- **New:** `ui/src/app/search-capability.ts` (+ spec) — per-host probe results, cached; the
  "is search actually on here" question, asked through `Api` so it works authed and anonymous.
- **New:** `ui/src/app/search-server-rejects.ts` (+ spec) — the persistent skip list.
- **New:** `ui/src/app/search-server-discovery/` — the random-walk finder, a sibling of
  `server-discovery/` and mounted the same two-places way.
- `ui/src/app/pages/search/search.{ts,html}` — the zero-result branch stops lying.
- `ui/src/app/pages/settings/server/settings-server.{ts,html}` — a "Search server" section.
- `ui/src/app/storage-registry.ts` — the reject-list key.

**Sprint 2**

- **New:** `ui/src/app/pages/profile/clone-friends.ts` (+ spec) — score, filter, bound and
  dedupe an account's follows against what you already follow. Pure; no HTTP in the unit.
- **New:** `ui/src/app/follow-quality.ts` (+ spec) — the named quality signals, post
  frequency first. Pure, and deliberately separate: "is this account worth a feed call"
  is a question the starter kits and the follow-suggestion surfaces will want too.
- **New:** `ui/src/app/pages/profile/clone-friends-dialog/` — the confirm-and-report dialog.
- `ui/src/app/pages/profile/profile.{ts,html}` — menu reorder + the new entry.

**Sprint 3**

- `ui/src/app/providers/openrouter/openrouter-chat.ts` — a `complete()` path returning text.
- `ui/src/app/providers/openrouter/prompt-templates.ts` — a third template, `translate`.
- **New:** `ui/src/app/translation-preference.ts` (+ spec) — the three-state choice.
- **New:** `ui/src/app/ai-translate.ts` (+ spec) — prose in, translated prose out.
- `ui/src/app/status-card/status-card.{ts,html}` — 🤖🌐 and the ask-dialog.
- `ui/src/app/storage-registry.ts` — the preference key.

## Testing

Specs run only via `npm run test:ci` (or `npx ng test --no-watch`) from `ui/`. **Bare
`npx vitest` does not work** — it misses Angular's test setup and fails ~157 files with
`localStorage is not defined` and `Need to call TestBed.initTestEnvironment() first`. Spec
files share a single jsdom realm; see `ui/docs/shared-jsdom-realm-in-tests.md` before
writing anything that touches a global.

The testable core of each sprint is deliberately pure:

- Sprint 1: the probe's status classification (which HTTP outcome means `auth-required` vs
  `no-results` vs `unreachable`), and the reject list's add/skip/clear/persist logic.
- Sprint 2: `follow-quality.ts` — the frequency signal's boundaries (a year-dormant account
  with 40k posts is still dormant), and `clone-friends.ts` — given an account's follows, the
  viewer's existing follows and the follow limit, which accounts get adopted and when paging
  should stop. No HTTP in either unit under test.
- Sprint 3: the preference state machine, and the response guard on a text completion,
  which has no JSON schema to lean on.

`npm run check:storage` must pass — every new localStorage key needs a `storage-registry.ts`
entry or the build fails. `npm run lint` runs with `--max-warnings 0`.

## The standing constraint

Everything here must work against real mastodon.social with no Mawkingbird server. And the
sharper one, for this roadmap specifically: **an anonymous user's actions stay in their
browser.** Sprint 2 is the test of that principle — the moment "clone twenty follows"
becomes twenty requests to someone else's server, it is a different feature with a different
risk profile, and it is not this one.
