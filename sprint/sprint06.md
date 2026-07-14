# Sprint 06 — Logo, house ads config, onboarding (Phase 0/1/2)

Target: **Mockingbird** (standalone client). Everything must work client-side against
BOTH the local mock and real instances (mastodon.social). Prefs/state in localStorage.
The mock server is reference + integration testing.

## Decisions (user-confirmed 2026-07-14)
- House ads: TS config file (`house-ads.ts`), array of ads, ALL rendered stacked in the
  right rail. MIMB (https://github.com/matthewdeanmartin/mastodon_is_my_blog/) is ad #1.
- Phase 0 onboarding: EVOLVE the existing /login page (don't add a landing page).
  Big obvious login area; "Pick a server" section defaulting to mastodon.social with
  education (special-interest servers ≈ forums via local feed; small servers = fewer
  hashtag results + less financially stable); link to the instance's signup.
- Phase 1 import formats: Mastodon CSV export (following_accounts.csv) AND pasted
  plain-text handles/profile URLs. Client-side: parse → resolve via /api/v2/search
  (resolve=true) → follow one at a time with progress + rate-limit backoff.
  Directory links: fedi.directory, fediverse.info.
- Phase 2 "collections": user means Mastodon featured/endorsed accounts
  (GET /api/v1/accounts/:id/endorsements — mock has it; real Mastodon 4.4+ has it).
  Feature feels "secret" today — make it PROMINENT at top of profiles when non-empty,
  with follow buttons and a "Follow all" bulk action.

## Task board
1. [x] Logo: replace the CSS-letter brand mark in the shell header with
       `public/mockigbird_logo.png` (note: filename has no 'n'), circular like feed
       avatars (border-radius 50%, object-fit cover). Relative src, like
       fail-whale's `insufficient_whale.png`.
2. [x] House ads: new `ui/src/app/house-ads.ts` config (title/text/url/cta/emoji);
       right-rail loops over it rendering the existing ad-card style, stacked, at top.
3. [x] Phase 0: rework /login sign-in tab into onboarding: big sign-in CTA, richer
       "Pick a server" section (mastodon.social default + education copy), link to
       `https://<host>/auth/sign_up`. Mock tabs unchanged.
4. [x] Phase 1: new "Find people" page (route /find-people): paste handles or upload
       Mastodon CSV; parse; resolve each via search(resolve); follow sequentially with
       progress UI, skip already-followed, backoff on 429; links to fedi.directory /
       fediverse.info. Plus low-follow nudge banner on home timeline
       (following_count below threshold → link to /find-people).
5. [x] Phase 2: profile featured-accounts section at top (endorsements API), prominent
       when non-empty, per-account Follow buttons + "Follow all"; silent on 404
       (older servers).
6. [x] Specs + lint + BOTH builds (default + mockingbird configuration).

## Handoff notes
- api.ts: `search()` gained optional `resolve` param (needs auth on real servers);
  added `accountEndorsements(id)`.
- Real Mastodon rate limits: 300 req/5min general; follows also have daily caps.
  Importer uses sequential requests + delay; on HTTP 429 it waits using
  X-RateLimit-Reset when present, else exponential backoff, then retries the SAME row.
- Home nudge threshold: following_count < 5, dismissible via ClientPrefs? -> chose
  simple localStorage key `mockingbird_nudge_dismissed`.

## Status log
- 2026-07-14: sprint created; user answered scoping questions (see Decisions).
- 2026-07-14: ALL TASKS DONE. 55 spec files / 429 tests green, lint clean, both
  builds pass. Implementation notes:
  - Logo: shell `.brand-mark` is now `<img src="mockigbird_logo.png">`, circular;
    login card got a matching hero logo.
  - House ads: `ui/src/app/house-ads.ts` exports `HOUSE_ADS` — edit that array to
    add/change ads; right-rail renders all entries stacked at the top of the rail.
  - Login/onboarding: hero (logo + tagline), big "Sign in with <host>" CTA, signup
    link to <host>/auth/sign_up (remote instances only), "Pick a server" section
    with education in a "How do I choose?" disclosure. Mockingbird build now
    defaults to mastodon.social instead of an empty picker. Mock tabs untouched.
  - Find people: /find-people (left-rail link under "Who to follow" + home
    empty-state link + dismissible low-follow banner when following_count < 5,
    localStorage key mockingbird_follow_nudge_dismissed). import-follows.ts:
    parseHandles (CSV "Account address" column, @user@host, profile URLs) +
    ImportFollows service (sequential resolve→follow, 250ms spacing, 429 waits
    X-RateLimit-Reset else exponential backoff and retries the same row, Stop
    button, per-row status + progress bar). Follow POST is idempotent so
    already-followed rows are harmless.
  - Search: handle/URL-shaped account queries now pass resolve=true.
  - Profile: "⭐ Featured by <name>" card (accountEndorsements) above posts, with
    per-account Follow + "Follow all (N)"; viewer's existing follows detected via
    relationships(); card hidden on empty/error (pre-4.4 servers 404).
