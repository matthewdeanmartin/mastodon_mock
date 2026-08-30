# RSS Sprint 8 — Comment parity with modern threads

Status: **DONE** (2026-08-30). Written first, approved, then executed — the plan below
stands as written, with the outcome recorded inline.

Follows [[rss-7-read-state-lifecycle]]. Closes the last deferred item from
[[rss-0-overview]]: RSS comments, which that doc parked as "low value density; deferred
rather than dropped".

The boss's brief:

> "RSS 2.0 supports comments, we want the RSS experience to have parity with modern feeds
> and threads, so let's do it"

Constraints inherited from the P1 sprints ([[p1-0-overview]]): **no layout work, nothing
requiring Playwright or eyeballs.** Vitest only.

## Read this first: most of it is already built

Checking before building, as the last three sprints all had cause to. **RSS comments are
implemented end to end.** Not partly — the whole path:

| Layer | State |
|---|---|
| `rss-parser.ts` | Parses `wfw:commentRss` / `wfw:commentRSS`, Atom RFC 4685 `rel="replies"`, and `slash:comments` counts. Handles the RSS 2.0 gotcha that core `<comments>` (a URL) and `slash:comments` (an integer) share a local name, by matching on prefix. |
| `rss-provider.ts` | `getComments()` fetches the comment feed, attributes each entry to its own `dc:creator`, marks them `isComment`, sorts oldest-first. Falls back to the parent feed's proxy setting when hosts match, so comments work on feeds the user already fixed. |
| `rss-adapter.ts` | `commentAccount()` builds a per-commenter synthetic account. |
| `thread.ts` | `loadRssComments()` runs automatically when an item declares a feed, with distinct copy for "loading", "declared but wouldn't load", and "this feed publishes none". |
| `thread.html` | Renders them as thread descendants — the same component real replies use. |
| Tests | `rss-provider.spec.ts` covers the adaptation; `rss-adapter.spec.ts` covers `isComment`. |

So this sprint is **not** "build RSS comments". It is a **parity** sprint: the discussion
renders once you are inside a thread, and is invisible everywhere else.

## The actual gap

Two things, and the first is a one-line bug.

### 1. `replies_count` is hardcoded to 0 — `rss-adapter.ts:249` — FIXED

`itemToStatus` sets `replies_count: 0` unconditionally, while `ParsedItem.commentCount`
sits right there carrying the publisher's declared figure (`slash:comments`, or Atom
`thr:total`). `rss-provider.ts:197` even passes `commentCount` through to its own view
model — and then the adapter throws it away.

Consequence: an RSS item with 47 comments renders **"0 replies"** on its card, in the
headline row, in Home, and anywhere else a status card appears. That is worse than showing
nothing, because it is a confident wrong number. It is also precisely the parity the brief
asks for: a Mastodon post shows its reply count, and an RSS item should too.

**Shipped:** `replies_count: options.inReplyToId ? 0 : (item.commentCount ?? 0)`.

The `inReplyToId` guard was not in the original one-liner and is needed: a comment feed
declares no reply count for its own entries, so a comment inherits `0` rather than
whatever its entry happened to carry.

**The caveat that must be written into the code:** this count is the *publisher's claim*,
not something counted. It can disagree with the number of comments the feed actually
serves — a moderated comment, a count cached at publish time, a feed truncated to the
latest 10. The two numbers coming from different places is normal and neither is a bug.
Do not "fix" a mismatch by recounting; the count is what the publisher says and the thread
is what the feed served.

### 2. Headline-row indicator — NOT BUILT, and correctly so

`commentsFeedUrl` is known at parse time, so the reader could see which items have a
discussion attached while scanning. Today the only way to find out is to open each one.

**Scope this narrowly.** The obvious version — a comment count on every RSS card — is what
(1) already delivers via the standard status-card reply count, at zero layout cost. This
item is only about the *headline row* in the split pane, which is the dense scanning
surface and currently shows nothing.

**Recommendation: do (1), then stop and look.** Once `replies_count` is populated, the
normal card affordance may already be enough, and adding a second indicator would be
duplicate information. Sprint 7's lesson stands: check whether the thing is already handled
before building a parallel path.

**Outcome: stopped, as recommended.** Two findings on looking:

1. `rss-page.html` renders `app-status-card` at full density, and `status-card.html`
   already shows `replies_count` with a 💬. So the count surfaces on the reading page for
   free the moment (1) lands — no new component, no new binding.
2. The headline row has no slot for one. `headline-row.css` is a four-column grid
   (`auto minmax(0,1fr) auto auto`) that **already drops to three columns** at narrow
   widths. Adding a fifth is layout work — out of scope by standing instruction — and
   would be squeezed out on exactly the screens where the dense row matters most.

So the parity the brief asked for is delivered by the one-line fix, and the second item
would have been duplicate information in a row with no room for it.

### 3. Non-goals, stated so they do not creep in

- **Posting a comment.** Impossible by design, not by omission. [[posse-0-overview]] and
  [[hugo-0-overview]] both establish it: *receiving* anything needs a listening server,
  and this app is a static client that will never have one. RSS comments are strictly
  read-only. If a reader wants to join in, the existing copy already sends them to the
  original site, which is the honest answer.
- **`<comments>` (the RSS 2.0 core element).** It is a URL to an HTML comments *page*, not
  content. The thread already offers "read the discussion on the original site"; a second
  link to roughly the same place is noise. Skip unless it turns out publishers set it where
  they set no `wfw:commentRss`, which is worth a look but not worth assuming.
- **Comment counts as a filter or sort.** `slash:comments` would support "busiest first",
  and the overview even floats it as a ranking signal. Out of scope: it is a new filter
  concept on a page that already has All / Read later / density, and nobody asked for it.

## Order of work

1. **Fix `replies_count`.** One line, plus the comment explaining why the number can
   disagree with the thread beneath it.
2. **Test it**, including the disagreement case explicitly — a count of 47 with 3 items in
   the feed must not be treated as an error.
3. **Look at a populated card**, then decide whether the headline row needs anything at
   all. Do not build (2) speculatively.

## Tests

`rss-adapter.spec.ts`:

- A declared `commentCount` reaches `replies_count`.
- A null `commentCount` yields `0`, not `null` — `Status.replies_count` is a number and
  cards render it directly.
- A count that disagrees with the number of comments the feed serves is preserved as
  declared. This is the test that documents the rule; without it the next person
  "corrects" the mismatch.
- A comment status (`isComment: true`) still gets `0`, since a comment feed does not
  declare counts for its own entries.

`rss-provider.spec.ts` already covers `getComments`; extend only if the count changes
shape there.

## Traps

**The RSS 2.0 name collision.** `<comments>` (a URL) and `<slash:comments>` (an integer)
share a local name, and the parser resolves it by prefix. If anything in this sprint
touches that code, keep the prefix check — reading the wrong one yields `NaN` or a URL
string in a numeric field, silently.

**A declared comment feed that will not load is normal**, not an error worth surfacing
loudly. CORS and 404s are common here, `thread.ts` already handles it with its own copy,
and that copy should not become an error state.

**Do not let the count drive fetching.** A non-zero `slash:comments` is not a reason to
fetch a comment feed on the reading page — that is a request per item on a list that may
hold hundreds. Comments load when a thread is opened, which is what `thread.ts` already
does.

**Test-suite traps**, both of which cost real time in the P1 sprints
([[p1-3-bookmark-buttons]]): spec files share one jsdom realm, so every `describe` needs
`TestBed.resetTestingModule()` in its `beforeEach`; and root-provided singletons keep state
between tests, so seed `localStorage` rather than expecting a fresh service.

## Expected size

Small — one line of production code, four tests, and a decision that may well be "nothing
further needed". The sprint is mostly the check that established most of it was already
built, which is the part worth having written down.

**Actual: exactly that.** One line changed in `rss-adapter.ts`, four tests added to
`rss-adapter.spec.ts`, and item (2) declined on inspection.

| Gate | Result |
|---|---|
| Full suite (`npm run test:ci`) | **5508 tests, 0 failures**, exit 0 |
| Coverage | 70.18 / 64.95 / 73.45 — above thresholds |
| `tsc` app + spec, lint, format | clean |
| `check:storage` | 118 keys classified |
| Manifest | updated, 4 added, 0 missing |

## What this closes, and what it does not

**Closes:** the RSS-comments deferral from [[rss-0-overview]], and the "comments if still
desired" line in the P1 audit's RSS bullet.

**Still open** (unchanged by this sprint): annotations — the large read-later — explicitly
not chosen in [[rss-7-read-state-lifecycle]] and still needing its own overview doc if it
ever comes back.
