# P1 — Overview: the feed stops lying about itself

Status: **4 sprints DONE** (2026-08-29)

Worked against the P1 backlog in `mockingbird_remaining_work.md`. The boss's constraints,
which shaped every decision below:

> "no layout work, nothing that requires playwright or actual eyeballs."

So: vitest only, no responsive/device matrix, no runtime verification against a deployed
build. Where a fix genuinely needs an eyeball to confirm, that is said plainly in the
sprint doc rather than papered over.

| Sprint | Closes | Doc |
|---|---|---|
| 1 | A58 — followers/following stop at one page | [[p1-1-people-paging]] |
| 2 | A62 — the feed ends and nobody knows why | [[p1-2-end-of-feed-honesty]] |
| 3 | The bookmark tail nobody ever saw | [[p1-3-bookmark-buttons]] |
| 4 | C23/C42 — two servers, one badge | below |

RSS Sprint 7 followed and is also done — [[rss-7-read-state-lifecycle]] (read-state prune,
same-content-different-format collapse, and read-later resolved as a rename of Starred).

## Sprint 4 — two-server badges (C23, C42)

Mostly a **verification** sprint: nearly everything the audit listed as missing was
already built, and the audit's "Partial" was pessimistic in every case but one.

Already done, found by reading the code rather than trusting the audit:

- **Both servers' rules and ToS on Docs** — `docs.html` renders a second pair of rows with
  `?server=search`, and `pages/server-rules` / `pages/terms` both honour that param.
- **The `…` re-probing fix (C42)** — `search-server-about.ts` caches rules and terms in
  `localStorage` keyed by base URL, and distinguishes "this server publishes none" (404)
  from "we could not find out" (anything else), so it never re-asks needlessly.
- **The search-server donate link** — in the rail, deliberately anonymous-only: a
  signed-in user already sees their own server's donate block, and this targets the
  anonymous case of leaning on a stranger's search index. Left as-is.
- **The search page's own server chip and picker** — present, with a note naming both
  servers.

The one real gap: **the rail's server card named one server as *the* server** while every
search quietly went elsewhere, leaving "why are my results from a different place?"
unanswered anywhere in the UI. Added `.server-roles` — two stacked rows naming each host
*and the job it does*, shown only when a second server is configured. Roles rather than
bare hostnames, because which server does what is not inferable from a domain.

Tests: 2 added to `right-rail.spec.ts` (both servers named with their jobs; nothing shown
when one server does everything). 367 passed across right-rail, docs, search, server-rules
and terms.

## The one bug, three times

These were filed as three unrelated complaints. They are the same defect wearing different
clothes: **the app hits a limit, stops, and reports the stop as a fact about the world.**

| Where | What it said | What was true |
|---|---|---|
| Followers list | "End of the list." | No `Link` header reached us, cause still unknown |
| Home, filtered | "Find friends to follow" | Calm hid every post that arrived |
| Home, windowed | (nothing) | 800 older posts were never fetched |
| Feed Doctor | "No one is dominating your feed" | It had no data about why the feed ended |
| Bookmark tail | (nothing) | It needed three conditions to coincide, so it never fired |

Each one is individually defensible in the code that produced it — and that is the
interesting part. Every single case has a comment nearby explaining why the honest-looking
thing was done. The `Link` fallback was written off as "the same behaviour as before". The
Doctor omitted a verdict "rather than faked" it. None of them was careless; they were
locally correct decisions that added up to an app that could not answer "why did this
stop?".

**The rule that came out of it:** when a limit stops something, name the limit. A terminal
state should say which of its possible causes actually happened, and offer the undo when
there is one. `hiddenByFilters` in `home.ts` already did this correctly and became the
template for everything else.

## What was explicitly NOT done

- **Anti-flood.** On hold — the boss has not settled its shape. Distinct from the
  cooldown: anti-flood is "this person posts every 2 seconds", cooldown is "you have been
  scrolling 2 hours". Do not build one under the other's name.
- **Layout fixes** (A39, A57, A59, A61 — wrapping metadata grids, narrow-screen popup
  geometry, mobile menus). Out of scope by instruction.
- **`from:user` returning 2 results** (A16). The boss's read is that this is
  mastodon.social's search index being poor rather than a client bug, and that is
  consistent with what `search-capability.ts` already documents about anonymous full-text
  search. Left alone deliberately.
- **The performance contract** (C65) — ETag/`If-None-Match`, navigation cancellation.
  Dedupe already exists; the rest does not. Deprioritised by the boss: "Not sure if the
  ETag biz is important right now."
- **RSS expansion** (C58) — mostly done in [[rss-7-read-state-lifecycle]]. Still open
  there: comments on articles (undecided), and annotations (explicitly not chosen).
- **Multi-page status search** (A16) — see above; judged to be the upstream index rather
  than a client bug.

## Verification

Full suite green at the end of Sprint 3: **5483 tests, 0 failures**, coverage above all
four thresholds, lint/format/storage/subpath gates clean, manifest updated.

`make check` in full (which adds the production build and `npm audit`) was **not** run.
That is the right gate before any of this ships.

## The single highest-value follow-up

**Find out why `Link` is actually missing on the boss's account** — because the first
answer was wrong, and the real one is not yet known.

Sprint 1 originally recorded the cause as "a CORS proxy that does not forward
`Access-Control-Expose-Headers: Link`", and recommended adding that header to
`mawkingbird_cors_proxy`. **That recommendation does not apply.** Checking
`mawkingbird_cors_proxy/src/config.ts` afterwards shows its route table covers RSS feeds,
reader articles, webmention, Twitter, shorteners, paste services and Mataroa —
**there is no Mastodon route**. Mastodon API calls go browser-direct, so this proxy is not
in the path and cannot be what truncated the list. (The proxy *does* already expose `link`
on both webmention routes, which is why the mechanism looked so plausible.)

The general rule is still true — `Link` is not CORS-safelisted, and a browser hides it
unless the response names it in `Access-Control-Expose-Headers` — and Sprint 1's fallback
is worth keeping for any path where that happens. But Mastodon sends the expose header,
and nothing is in between, so **the observed truncation has an unidentified cause.**

Still to check, in rough order of likelihood:

1. **Is it still happening?** Sprint 1 shipped an honest terminal state; if the list now
   reads "Stopped at 80 of 3000 — this server did not send the rest of its paging
   information", the header really is absent and the question is why. If it walks past 80,
   the fallback is carrying it and `source` will say `account-id-fallback`.
2. **The actual response headers**, from devtools on a `/followers` request against the
   boss's own server. This is a five-second check that settles it, and needs eyeballs —
   which is why it was out of scope here.
3. **A reverse proxy in front of that particular instance** (nginx/Cloudflare in front of
   Mastodon) stripping or not forwarding the header. Same class of bug, different owner.
4. **A different code path.** `PeopleBrowser` is fixed and tested, but confirm the screen
   the boss was actually on is the one using it.
