# Bulk translation & better lists — grounded plan & sprint index

Two independent tracks, planned together because both were specified in one sitting and
both land on pages that already exist (`pages/settings/i18n/`, `pages/lists/`).

- **Track A — Bulk / learner translation.** Turn translation from a per-post button into
  a reading mode, with a real spend guard, aimed at language learners.
- **Track B — Better lists.** Client-side lists for everyone (not just Anonymous), and
  bundles of hashtags as feeds.

---

# Track A — Bulk translation & learner mode

## The problem this starts from

`Api.translate()` (`api.ts:343`) is a bare `POST /api/v1/statuses/{id}/translate` with
**no counter, no cap, and no throttle**. `RateLimitCoordinator`
(`rate-limit.interceptor.ts:16`) only reacts *after* a 429 comes back. Today that is
harmless because translation is one click on one post. The moment translation fires
automatically on every post that scrolls past, the app becomes a bad net citizen against
mastodon.social — or, on the AI path, quietly spends an OpenRouter balance.

**So the spend guard is sprint 1, before any bulk trigger exists.** Nothing in the bulk
feature ships before the thing that limits it.

## The learner model (the core idea)

Today `ClientPrefs` has one language list, `knownLanguages` (`client-prefs.ts:461`), and
`KnownLanguages` (`trend-language-filter.ts:33`) aggregates it with the UI language and
the browser locale chain. That list answers "what do I read fluently".

We add a **second, orthogonal list: `learningLanguages`.** They are not the same thing
and must not be merged:

| | known (`en`) | learning (`is`, `eo`) | unknown | undetermined |
|---|---|---|---|---|
| Shown in feed | always | **always — never hidden** | per `hideForeignLangPosts` | always (existing rule) |
| Auto-translated | **never** | **yes** | only if bulk-all is on | **never** (probably English) |
| Presentation | — | **append** below original | replace | — |

Three rules fall out, and they are the whole feature:

1. **Never translate what you already read.** A known language is skipped, always.
2. **Never hide what you're learning.** A learning language is exempt from
   `FeedLanguageFilter.hideReason()` regardless of the toggle's state. This is the narrow
   reading of "stop hiding foreign" — the filter stays intact for everything else.
3. **Undetermined stays untranslated.** `FeedLanguageFilter` already refuses to guess
   (`confidentTextLanguage()` returns null below `MIN_TEXT_FOR_DETECTION` /
   `CONFIDENT_SHARE`). Bulk translation inherits that refusal: no confident language means
   no translation, because it is probably English and we would be spending a call to
   translate English into English.

### Append, not replace — and the Rosetta triplet

Learner mode shows the **original and the translation together**, stacked. `status-card`
today swaps content out: `translation()?.content ?? this.display.content`
(`status-card.ts:346`). Learner mode does not touch that path; it renders additional
blocks beneath.

Someone learning two languages may want a post rendered in *both*. So the i18n screen
lists each learning language with **its own append checkbox**, rather than a single global
"append" switch:

```
Languages I'm learning
  [×] Icelandic (is)   [✓] append translation
  [×] Esperanto  (eo)  [✓] append translation
```

With both checked, an Icelandic post renders original → Esperanto → English-side-by-side
as configured. That is the triplet, and it is opt-in per language because it is N× the
spend.

## Decisions taken (from Matthew, 2026-08-03)

1. **Trigger is a user choice**, not a fixed behavior: `off` / `on view` / `on hover`,
   as a radio on the internationalization screen. On-view uses `IntersectionObserver`;
   on-hover works where a mouse exists and costs far less.
2. **Counter and caps, no throttle.** A `TranslationUsage` store modeled on
   `TwitterUsage` (`providers/twitter/twitter-usage.ts`) — local-day boundary, soft limit
   that warns, hard limit that refuses. Default soft **100/day**, matching the "free
   translation service of the server" figure. No request queue or min-gap; deliberately
   deferred as extra machinery for a burst problem the caps already bound.
2a. **Two budgets, held apart on purpose.** The Mastodon endpoint and OpenRouter get
   **separate counters and separate limits** — never one combined total. They are
   different resources with different failure modes: OpenRouter could go out of business,
   and mastodon.social could disable `POST /statuses/{id}/translate`. Either one vanishing
   must leave the other's budget intact and meaningful. This is why sprint 1 is *not* a
   single `Translator` facade with one meter (an earlier draft of this plan had that; it
   was wrong).
2b. **Name the server translator for what it actually is.** The UI says
   **"Mastodon (DeepL/LibreTranslate)"**, not "your server" — those are the engines behind
   the endpoint, and a learner deciding where to spend calls deserves to know which one
   they are about to hit.
3. **Bulk is server-only. AI requires explicit opt-in.** Bulk mode uses
   `POST /statuses/{id}/translate`, ignoring `TranslationPreference` even when that is set
   to `ai`. Using AI for bulk is a separate, explicitly-labelled toggle with the cost
   stated. A reading preference must never sign someone up for an LLM bill —
   the same principle `translation-preference.ts:3-17` already states for the manual
   button.
4. **Learning languages are exempt from hiding; the filter is otherwise untouched.**
   `hideForeignLangPosts` keeps working exactly as it does now for every other language.
5. **Translate-all (every foreign language, not just learning ones) is off by default**
   and sits behind the same counter. It is the `$$$` mode and is labelled as such.

## Sprints

- **[[i18n-1-translation-usage]]** — The guard, alone and first. New `TranslationUsage`
  service holding **two independent budgets** (`mastodon` and `openrouter`), each with a
  local-day counter and its own soft/hard limits: `canSpend(engine)` / `record(engine)`.
  Both the existing 🌐 button's server path and the AI path are metered, each against its
  own budget. Usage lines + limit editors on the i18n settings screen. Ships with unit
  tests as the contract; no behavior change to the manual button beyond metering.
- **[[i18n-2-learning-languages]]** — `ClientPrefs.learningLanguages` + per-language append
  flags; "Languages I'm learning" picker on the i18n screen, modeled on the existing
  known-languages picker (`settings-i18n.ts:105-115`); `FeedLanguageFilter` exemption
  (rule 2). No automatic translation yet — this sprint makes learning languages *visible*
  and configurable, which is independently useful.
- **[[i18n-3-bulk-trigger]]** — The reading mode: trigger radio (off/view/hover),
  `IntersectionObserver` wiring in `status-card`, the append-rendering blocks, and the
  eligibility rule (skip known, skip undetermined, translate learning). Server translator
  only; every call passes the sprint-1 guard. Includes the "translate all foreign
  languages" `$$$` toggle, default off, and the AI-for-bulk opt-in.

## Risks / watch-items

- **Metering the AI path too.** `AiTranslate` (`ai-translate.ts`) goes out through
  OpenRouter, not `Api`. Both call sites must be metered — but against *separate* budgets
  (decision 2a), so this is two small call-site changes rather than one unifying facade.
- **Read-only providers have no server translation.** `status-card.serverCannotTranslate`
  (`status-card.ts:1148`) already knows Twitter/RSS/paste posts must use the autorouter
  ([[readonly-provider-translate]]). Under a server-only bulk rule those posts get **no**
  bulk translation — correct, and it must be visibly explained rather than silently doing
  nothing.
- **IntersectionObserver in specs.** jsdom does not implement it; specs run only via
  `npm run test:ci` ([[ui-test-runner]]). Needs a stub in the test setup, decided in
  sprint 3's doc rather than discovered during it.
- **`translation()` vs `aiTranslation()` are separate signals** in `status-card`
  (`:340`, `:1112`) with different trust levels — `Translation` is server-sanitized HTML
  through `[innerHTML]`, `AiTranslation` is untrusted text through `{{ }}`
  (`ai-translate.ts:7-15`). The append blocks must preserve that split, not unify it.
- **Sprint 1 changes no user-visible behavior**, so it is the easiest to skip under
  pressure and the most important not to.

---

# Track B — Better lists

## What we already have (don't rebuild)

- **`pages/lists/lists.ts`** — already the "Feeds" hub: 13 sections (`FEED_SECTIONS`,
  `:54`) covering lists, saved searches, server feeds, followed/featured hashtags,
  collections, endorsements, RSS, Twitter, Bluesky. Adding a section is a well-worn path.
- **`AnonymousLists`** (`providers/anonymous/anonymous-lists.ts`) — the client-side list
  store. Browser-local, versioned state, `create` / `remove` / `setMember`.
- **`ListSource`** union + **`ListFeedResolver.mergeMemberTimelines()`**
  (`lists/list-feed-resolver.ts`) — client-side fan-out merge with `MERGE_MEMBER_CAP=12`,
  `FEED_PER_MEMBER=20`, `FEED_MAX=40`, per-member failures degrading to empty.
- **`scopedKey()`** account-scoped localStorage ([[account-scoped-client-settings]]).

## Decisions taken (from Matthew, 2026-08-03)

1. **Generalize the store to all sessions.** `AnonymousLists` becomes an account-scoped
   `ClientLists` available signed-in *and* anonymous. Signed-in users get both server
   lists and client-side lists, as separate sections. The point: **client lists don't
   require following anyone** — the server's list API does, and that restriction is the
   reason this exists.
2. **Tag bundles are their own store and their own section**, beside "Followed hashtags".
   A new `ListSource` kind `tag-bundle`; the resolver merges N tag timelines. **Max 10
   tags**, because each is one API call to build the feed.

## Sprints

- **[[lists-4-client-lists-for-all]]** — Generalize `AnonymousLists` → account-scoped
  `ClientLists` keyed by acct handle rather than anonymous follow key; keep the anonymous
  path working (it is the existing consumer, and regressing it is the main risk). New
  "Client lists" section on the Feeds page, available in every session. Feed resolves via
  the existing `mergeMemberTimelines()` — no new merge code.
- **[[lists-5-tag-bundles]]** — `TagBundles` store (account-scoped, 10-tag cap enforced in
  the store, not just the UI), `ListSource` kind `tag-bundle`, resolver branch merging tag
  timelines, "Tag bundles" section, and an "add to bundle" affordance on the tag page
  (`pages/tag/tag.ts`).

## Risks / watch-items

- **No migration — bump the version and drop it.** Existing
  `mockingbird_anonymous_lists` (`STATE_VERSION = 2`) is treated as **ephemeral cache**,
  not durable user data. A version bump busts the local cache and the next render makes
  fresh API calls; that is the intended, cheap path. Do **not** spend sprint time writing
  a v2→v3 migration. The one requirement: **log when the bust happens**
  (`PageDiagnostics`, as `lists.ts` already does) so a user reporting "my lists vanished"
  has a trail rather than a mystery.
- **Member identity changes shape.** `AnonymousList.memberKeys` are anonymous follow keys;
  a cross-session store needs acct handles resolvable to account IDs before
  `mergeMemberTimelines()` (which takes IDs) can run. That resolution step is the real
  work of sprint 4, not the storage rename.
- **10 tags = 10 calls, and the cap must hold on the merge.** `MERGE_MEMBER_CAP=12`
  already guards account fan-out; the tag branch needs its own cap of 10 and the same
  "showing N of M" honesty ([[rich-account-search]] forkJoin latency trap — fast against
  the mock, slow against real mastodon.social).
- **Anonymous tag timelines are open** ([[mastodon-social-anonymous-endpoints]]), so tag
  bundles work anonymously. Client lists of accounts depend on `getAccountStatuses`, which
  does not — sprint 4 must check that rather than assume it.
