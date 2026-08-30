# P1 Sprint 1 — Followers/following stop pretending to be complete

Status: **DONE** (2026-08-29)

First of three sprints against the P1 backlog in `mockingbird_remaining_work.md`.
This one closes **A58**. Sprint 2 is end-of-feed honesty; Sprint 3 is the bookmark
button pair. Constraints set by the boss for all three: **no layout work, nothing
requiring Playwright or eyeballs.** Vitest only.

## The bug, and why it kept getting misdiagnosed

> "BUG: paging through my own followers terminates early. Paging through everyones
> followers terminates early, I think when it terminates immediately that means some
> sort of privacy thing is in effect." — `MockingBird.md:392`

The note's own guess — a privacy setting — is what makes this bug durable. A walk that
dies on page one is *indistinguishable at the UI* from an account that hides its social
graph, so the symptom argues for its own dismissal.

It had already been diagnosed once, and fixed at the wrong layer. `people-sources.ts`
carries a long comment about walking by `accounts.at(-1).id` being the wrong cursor,
because `/followers` and `/following` paginate by internal *relationship* id, published
only in the `Link` header. That fix was correct and is still in place.

The remaining half is a browser rule, not a Mastodon one:

> `response.headers.get('Link')` returns `null` unless the response carried
> `Access-Control-Expose-Headers: Link`.

`Link` is not one of the six CORS-safelisted response headers, so a browser hides it from
JavaScript unless the response explicitly names it. When that happens the cursor is not
missing — it is *filtered*: Mastodon sent it, the browser received it, and our code is not
permitted to read it. A permissions problem wearing a data problem's clothes, which is
exactly why it reads as "this account is hiding its followers".

> **Correction (same day).** This sprint originally named the cause as
> "a CORS proxy that does not forward the expose header", and recommended adding it to
> `mawkingbird_cors_proxy`. **That is wrong and the recommendation does not apply.**
> `mawkingbird_cors_proxy/src/config.ts` has routes for RSS, reader articles, webmention,
> Twitter, shorteners, pastes and Mataroa — **no Mastodon route**. Mastodon calls go
> browser-direct, so that proxy is not in the path. It already exposes `link` on both
> webmention routes, which is what made the theory look so tidy.
>
> The browser rule above is still true, and the fallback below is still the right
> defensive fix. But **why `Link` was absent on the boss's account is not yet known** —
> see the follow-up list in [[p1-0-overview]]. Do not repeat the proxy claim.

Both call sites had already noticed and written the failure off:

> "when a server does not, `null` degrades to 'one page', which is the same behaviour as
> before rather than a new failure." — the old comment in `anonymous-public-api.ts`

That reasoning is what shipped the bug. Degrading to one page is not "the same behaviour"
when the profile beside it says 3,000 followers — it is a wrong answer presented as a
complete one.

## What changed

**New `src/app/people-cursor.ts`.** Holds `peopleCursorFrom()` and — moved, not rewritten —
`nextMaxIdFrom()`.

`peopleCursorFrom(linkHeader, accounts, limit)` returns `{ nextMaxId, source }` where
`source` is one of `link-header` / `short-page` / `account-id-fallback`. The rules, in
order, and each one is load-bearing:

| Condition | Result | Why |
|---|---|---|
| Header has a `next` | its `max_id`, `link-header` | The server's own cursor always wins. |
| Header present, no `next` | `null`, `link-header` | **The server answered.** Never argue with it, even on a full page. |
| No header, **short** page | `null`, `short-page` | A short page ends the walk with no cursor needed. This is the fence that stops a wrong cursor looping forever. |
| No header, **full** page | last account id, `account-id-fallback` | Better an imperfect walk than a list that stops at 80. |

The guess is defensible only because it is fenced to the case where it cannot make things
worse. Relationship ids and account ids are both time-ascending snowflakes, so for a
follower list accumulated over time the two orders broadly agree; where they disagree the
walk skips or repeats, and `PeopleBrowser` **already** deduped by id and already stopped
when a page added nothing new. That pre-existing safety net is why this is safe — check it
still exists before touching the fallback.

**`nextMaxIdFrom` moved out of `api.ts`.** It is a pure string function, and a test for it
should not have to boot Angular DI — a bare `vitest run` on a spec importing `api.ts` dies
with the JIT-compiler error. `api.ts` re-exports it, so existing importers are untouched.

**Both call sites use it:** `Api.accountFollowersPage` / `accountFollowingPage`, and
`AnonymousPublicApi.getAccountPeople`. Both now return `source` alongside `nextMaxId`. The
anonymous path grew a named `PEOPLE_PAGE_LIMIT = 80`, because the helper needs the same
number to tell a full page from a short one — it was a bare `'80'` string literal before.

**Five other `nextMaxIdFrom` callers were deliberately left alone** (blocks, mutes, and
friends): small lists where stopping early is harmless and the fallback would add risk for
nothing.

**`PeoplePage.approximate`** carries `source === 'account-id-fallback'` to the component.

**The UI stops lying.** `people-browser.html` said "End of the list." in every terminal
case. Now:

- `shortOfReported()` — loaded > 0 and `reportedCount - loaded > 80` — renders
  *"Stopped at 12 of 3000 — this server did not send the rest of its paging information."*
- `approximate()` renders *"End of the list (approximate — paged without the server's cursor)."*
- Otherwise, unchanged.

One page of slack in `shortOfReported` so ordinary drift (a follow removed between the
count and the walk) does not trip it. It requires `loaded > 0`, so a genuinely empty or
privacy-hidden list keeps its own empty state rather than being accused of truncation.

## Tests

`people-cursor.spec.ts` (6, new) — the four rules, an empty page, and a non-default limit,
proving "full page" is measured against the limit *requested*, not a hard-coded 80.

`api.spec.ts` (+2) — through `HttpTestingController`: a full page with no `Link` walks on
the account id; a short page with no `Link` still stops.

`people-browser.spec.ts` (+2) — the money test: `reportedCount=3000`, one short page, and
the component must **not** say "End of the list." The companion asserts a list that agrees
with its count still does.

| Gate | Result |
|---|---|
| `test:subset` — people-cursor, api, people-browser, anonymous-public-api | 47 passed |
| `test:subset` — audience-scan, just-my-server, import-export, profile | 256 passed |
| `tsc -p tsconfig.app.json` / `tsconfig.spec.json` | clean |
| `npm run lint` | clean |
| `npm run test:source-integrity` | 420 spec files, 5387 declarations |

Full `make check` was **not** run (build + audit are slow); it is the right gate before
this ships.

## For the next developer

**The cause is still open.** See the correction at the top: the CORS-proxy theory is dead
(no Mastodon route), so this sprint shipped a robustness fix for a mechanism that is real
in general but is *not* confirmed to be what truncated the boss's list. The fallback is a
mitigation either way; the cure depends on a cause nobody has established yet. The
five-second version is to open devtools on a `/followers` request and look at the response
headers — see [[p1-0-overview]] for the ordered list.

**`source` is plumbed but under-used.** It reaches `PeopleBrowser` and stops. Sprint 2
builds a "why did this end" reporting surface for the *feed*; the same reason belongs in
Feed Doctor for people-lists, and `account-id-fallback` is exactly the kind of thing it
should be able to name. Wire it when that surface exists rather than inventing a second one.

**Do not extend the fallback to timelines.** Statuses page by status id, where `max_id`
*is* the right cursor, so they never had this bug. Adding the guess there would be
cargo-culting.

**Unverified against a live server.** The CORS *rule* is certain and the fallback is
covered by tests, but nobody has watched a real 3,000-follower account walk past 80 — nor
confirmed that `Link` is genuinely absent there. Both need a deployed build and devtools,
which this sprint's constraints excluded. Until then this is a fix for a mechanism, not a
fix confirmed against the reported symptom.
