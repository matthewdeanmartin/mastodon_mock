# Kindle 2 — The library, position, and progress

Status: **COMPLETE** (2026-09-04)
Epic: [[kindle-0-overview]]
Depends on: [[kindle-1-page-and-shell]]

Goal: the reader remembers. Three shelves, a position per document, and a
visible sense of how far through you are.

## 2a. The data model

Per the operator's instruction, this **resembles `providers/rss/rss-read-state.ts`**
and does not invent a new shape. That file's decisions are already the right
ones and are adopted wholesale: a plain `Record` keyed by document id, tolerant
`load()` that drops malformed entries rather than losing the store, a 90-day age
cap, and an entry cap so a heavy reader cannot silently exhaust the ~5MB
`localStorage` budget shared with every other key.

`providers/read/reader-library.ts`:

```ts
/** One document the reader has picked up. */
interface LibraryEntry {
  /** Where it came from, for the row and for re-opening. */
  url: string;
  title: string;
  siteName: string | null;
  /** Which shelf. Derived, but stored, so an override survives. */
  shelf: 'intend' | 'reading' | 'read';
  /** True when the reader filed it by hand; automation stops moving it. */
  pinnedShelf: boolean;
  /** Furthest page reached, and the page count it was measured against. */
  page: number;
  pages: number;
  /** Added, and last opened. Both drive pruning and sorting. */
  addedAt: number;
  openedAt: number;
}

type LibraryMap = Record<string, LibraryEntry>;
```

Key: `mockingbird_reader_library`, account-scoped via `scopedKey()`, registered
in `storage-registry.ts` as `cache` retention. **The `make storage` gate fails
the build if this is skipped**, which is the intended behaviour.

Caps, mirroring `rss-read-state`'s reasoning but not its numbers: entries are
richer here (~150 bytes vs. 8), and a library is a smaller collection than a
read-mark set by nature.

```ts
export const LIBRARY_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // a year
export const LIBRARY_MAX_ENTRIES = 2_000;
```

A year rather than 90 days because forgetting a read mark shows one stale item
as unread, while forgetting a library entry loses something the reader
deliberately kept. Pruning drops oldest-`openedAt` first, and **never prunes the
`intend` shelf before the `read` shelf** — a finished book is a receipt, an
unread one is an intention, and losing the intention is the worse failure.

### The Plus-sync seam

Local is authoritative and Sprint 2 ships nothing over the network. But the
shape is chosen so a later sync is an addition rather than a migration, the way
`article-reading-tally.ts` did it:

- Every entry carries `addedAt`/`openedAt`, so a merge across devices is
  last-write-wins per document without a server clock.
- The store exposes `snapshot()` and `merge(remote: LibraryMap)` from day one,
  both pure and both tested. Nothing calls `merge` yet.
- No sequence numbers, no tombstones. Deleting on one device and having it
  reappear from another is an acceptable v1 outcome; building a CRDT for a
  reading list is not.

## 2b. What gets shelved, and what never does

The operator's rule, implemented literally: **ordinary tweets that are short or
never viewed are never tracked.** An entry is written only when *both*:

1. The document qualifies under `DOCUMENT_MIN_CHARS` / multi-post chain / RSS
   item / expanded article (defined in [[kindle-1-page-and-shell]] 1c), **and**
2. The reader actually opened the reader on it.

Explicitly excluded, and asserted in tests:

- A single post under 500 characters, even opened in the reader.
- Anything read in a *feed* — Home, lists, tag feeds. The feed reader widget is
  a typography setting, not a reading session, and it writes nothing.
- Anything in the RSS split pane? **No — this one is included.** Reading an
  article in the pane is reading it. The pane already tracks read/unread
  separately (`rss-read-state`), and the two stores answer different questions:
  "have I seen this headline" versus "is this on my shelf". They coexist.

## 2c. Shelf transitions

Automatic, with a manual override that sticks:

| Event | Shelf |
| --- | --- |
| Saved without opening (from a status card menu) | `intend` |
| Reader opened, progress under the read threshold | `reading` |
| Progress reaches 95% of pages | `read` |
| Reader filed it by hand | whatever they said, `pinnedShelf = true` |

95% rather than 100% because the last page is often notes, comments, or a
footer, and a reader who never technically lands on it should not have a shelf
full of nearly-finished documents.

Once `pinnedShelf` is true, automation stops moving that entry. Un-pinning is
available from the same row menu.

## 2d. The library panel

Off by default, per the brief. `Library` is a compact toolbar button that
toggles a panel; the panel is a sheet over the reading column rather than a
navigation, so dismissing it returns you exactly where you were mid-page.

**It looks like the RSS left rail, deliberately.** The operator's call:
consistency is worth more here than a bespoke design, and RSS already solved
this exact problem — a narrow, sticky, scrollable list of things to read, with
group headers and a selected row that reads as "you are here". So the library
adopts `rss-page.css`'s rail treatment rather than inventing one:

- `.rail-row` — full width, left-aligned, borderless, `8px 14px`, hover fills
  with `--bg`.
- `.rail-row.active` — `color-mix(in srgb, var(--accent) 16%, transparent)` and
  `font-weight: 700`. The document you are reading is the active row.
- `.rail-folder` / `.rail-feed.nested` — the shelf headings are folders and the
  documents nest under them at `padding-left: 26px`.
- The `290px` sticky column with `max-height: calc(100dvh - 90px)`, the `dvh`
  fallback ordering included.

Those rules move out of `rss-page.css` into a shared stylesheet both pages
import; they are copied verbatim rather than re-derived, and the comments
explaining *why* (the header-grid register, the dvh-before-vh order) travel with
them. Neither page gets to drift from the other by accident.

Three sections in fixed order — Intend to read, Still reading, Read — each
collapsible, each showing count. Rows show title, site, and a progress figure;
sorted by `openedAt` descending within a shelf. A row menu offers: open, move to
shelf, remove.

### The overlap with RSS, named

RSS read/unread (`rss-read-state.ts`) and the library are genuinely overlapping
and stay separate, because they answer different questions: *have I seen this
headline* versus *is this on my shelf*. An RSS item read in the pane marks read
in one and lands on `reading` in the other. What they now share is the data
model's shape (2a) and the rail's look — which is the useful half of the overlap
without merging two stores that mean different things.

State of the panel itself (open/closed, which sections are collapsed) is a UI
preference in `ClientPrefs`, not in the library store — mixing view state into a
synced document store is how sync conflicts become confusing.

## 2e. Position memory

`page` and `pages` are stored together on purpose. Re-fetching an article can
change the pagination — a different extraction, a changed page-size preference —
and "you were on page 7" is meaningless against a different total. On open:

- Same `pages` as stored: restore `page` exactly.
- Different `pages`: restore proportionally (`round(page / pages * newPages)`),
  and say so once, quietly, in the toolbar's position readout.

Never restore silently to a wrong place; a reader who cannot trust the resume
will stop using it.

## 2f. Progress

Two displays, both fed by the same computed fraction.

**A hairline bar** pinned under the toolbar, full container width, filling
left-to-right. Zero chrome, no numbers — it is peripheral information and should
read at a glance without being looked at.

**A position readout** in the toolbar between the pager arrows: `3 / 12`, with
the estimated minutes remaining beside it when the document is long enough for
that to be meaningful (over ~5 minutes). Reading speed: a fixed 240 wpm. Not
measured per-reader — that requires tracking how long someone dwells on each
page, which is exactly the reading-history surveillance the tally provider
already declined to build.

In continuous-scroll mode the fraction comes from scroll position rather than
page index; the bar and readout are otherwise identical.

## Acceptance

- Opening a qualifying document in the reader creates an entry on `reading`;
  reaching the end moves it to `read`; a saved-but-unopened document sits on
  `intend`.
- A 200-character post opened in the reader creates **no** entry.
- Reading through Home's feed reader widget creates **no** entry.
- Closing and re-opening a document restores the page; changing font size
  (thus pagination) restores proportionally and says so.
- The library panel is closed on first visit and its open/closed state persists.
- `merge()` of two snapshots keeps the later `openedAt` per document, and is
  tested; nothing calls it in the app.
- `make storage` passes with the new key classified.
- Pruning at the entry cap drops `read` before `intend`, and is tested.

## Traps

- **Account scope.** `scopedKey()` or two personas share a shelf. `rss-read-state`
  already gets this right; copy it rather than re-deriving it.
- **Writing on every page turn.** A `localStorage` write per arrow press is a
  synchronous serialization of the whole map on the main thread. Debounce, and
  flush on `visibilitychange` — a reader who closes the tab mid-article must not
  lose their position, which is the one thing this feature promises.
- **The panel over the pane.** In `layout="pane"` the library sheet must not
  cover the RSS left rail; scope it to the pane, or suppress the Library button
  there entirely and reach the library from the reader page only.


## Outcome (2026-09-04)

Shipped. 5771 tests pass; `make check` green apart from one transient npm-audit
503 from the registry.

### What landed as planned

The store (`providers/read/reader-library.ts`) is shaped after
`rss-read-state.ts` exactly as instructed — tolerant `load()`, pure exported
`pruneLibrary`, a startup prune whose drop count is visible for diagnostics.
`snapshot()`/`merge()` are pure, tested and called by nothing. Shelves move
automatically with a sticky manual override. Position memory restores exactly
when the pagination matches and proportionally when it does not, saying so
either way. The panel wears the RSS rail's `.rail-row` treatment.

### Decisions taken while building

**Eviction order, not eviction age.** The plan said "never prunes `intend`
before `read`". Implemented as a strict shelf order — `read`, then `reading`,
then `intend`, least-recently-opened first within each — and a pinned entry is
*not* exempt from the cap. Pinning promises that automation will not move a
shelf, not that `localStorage` has no ceiling; pretending otherwise would just
relocate the overrun to whatever writes next.

**Position saving is debounced *and* flushed twice.** Every 2s while paging, on
`visibilitychange` when the tab hides, and on destroy. The plan named the first
two; destroy is the one that catches an in-app navigation away, which is the
common case and which `visibilitychange` does not fire for.

**`recordPosition` keeps the furthest page, not the last.** Paging back to
re-read something earlier must not un-finish a document. Only resets when the
page *count* changes, since a position measured against a different pagination
is not comparable.

**The pane shelves but does not position.** As planned, reading an RSS item in
the split pane puts it on a shelf. It deliberately neither restores nor saves a
page: the pane is a preview strip beside a list, and dropping someone into page
7 of an article there is disorienting rather than helpful.

**Titles for things that have none.** A tweetstorm has no headline, so the
library takes its first sentence (trimmed to 90 chars). A placeholder title is
also allowed to improve on a later visit — a post whose linked article gets
fetched suddenly has a real headline, and the row should show it.

### The "save for later" entry point — built (2026-09-04)

**Resolved as a separate control with its own icon**, per the operator. The
three gestures stay three, because they answer three different questions:

- **Bookmark** is a *server* record on your Mastodon account. It syncs to every
  client you own, reaches none of your other feeds, and holds **posts**.
- **Read later** stars an *RSS item within its feed* — `rss-read-state`, beside
  the read marks, scoped to the RSS page, deliberately never pruned.
- **The library** is the reading device's shelf: documents from every source
  together, with how far through each one you are. It is the only one of the
  three that can answer "what am I in the middle of".

`pages/read/save-to-library/` is one small component so there is one
implementation of the gesture. It renders **nothing at all** unless the row is a
document, which is what keeps it from being a third button on every post in the
timeline — the objection that deferred it. On the cards where it does appear it
sits beside the bookmark and wears the card's own action geometry.

**It is on the status card and not on the RSS headline row.** That is a
deliberate narrowing of the decision. On an RSS row "Read later" already means
"save this article for later" and the star is two centimetres away; a book icon
beside it saying nearly the same thing is precisely the collision this section
was written about. On a status card there is no competitor — a bookmark holds a
post, not a document. An RSS item still reaches the library the moment it is
opened, through `open()`.

**What it will not offer to save, and why that is right.** `isDocument()` is
asked with what a feed row actually knows: this post, and no thread around it.
So an RSS item and an obviously long post qualify; a tweetstorm's *first* post
does not, because the chain that makes it a document is not loaded in a
timeline. Rather than guess, the control stays away and `open()` shelves the
storm correctly when it is read — it does see the chain.

One shared fix fell out: `fallbackTitle` moved from `reader-core` to
`reader-document.ts` as `documentTitle`, since the control needs the same title
from a feed row where the reader is not running. Two implementations of "what do
we call this" would drift and the shelf would then disagree with the reader
about a document's name. It now goes through `plainText`, so entities decode
(`&amp;` no longer shows raw in a title) and the title agrees with
`chainTextLength` about what counts as text.

Six tests in `save-to-library.spec.ts`.

### Two fixes from the operator's testing

**The toolbar was flung to the corners.** Corrected to a centred band —
`width: min(100%, 52rem)`, `justify-content: center`, with a hairline rule
between the "act on the text" cluster and the "stop reading" cluster. This
matches the app's own top bar (`shell.css .topbar-inner`), which puts its tab
nav in the middle column rather than spreading brand and account to opposite
edges. On a 1400px screen the old layout made the eye travel the full width to
get from "next page" to "exit", and read as browser chrome rather than as part
of the page.

**`readerChain` showed one post where a storm belonged.** A real bug, found
while the operator was testing. The chain was anchored on `thread[0]` — the
*conversation root* — so a storm written as a reply to someone else produced a
one-post "article" consisting of that other person's post, because every
subsequent post failed the same-author test. It also lost the beginning of a
storm whenever the reader arrived on post four of nine, which is the normal
case for a link shared from the middle.

Now anchored on the post the reader actually opened: take *that* author, walk
back through their own replies to where they started, then forward. Walking
back stops at the first post that is not theirs, so a storm that genuinely
begins as a reply starts at the author's own first line. Seven tests.

This also turned up a latent reactivity bug: `thread.ts` held `currentId` as a
plain field, and passing it into a `computed` would have meant the Reader
link's post count never updated. Now a signal.

### Round two of the operator's testing — five reports, five fixes

**Library was on the right; RSS puts it on the left.** Moved. Two reading
surfaces in one app should not mirror each other.

**The library sat in a beige column.** The paper colour was set on `.read-page`,
so opening the library painted 290px of sepia behind app furniture. Paper now
belongs to the reading surface only; the panel declares the site theme
explicitly.

**A two-post thread showed one post.** Root cause was not the reader:
`adaptAnonymousStatus` namespaced `Status.id` but left `in_reply_to_id` raw, so
no post in a remotely-read thread could ever be matched to its parent. Reply
threading was broken everywhere those posts appear — the reader just made it
visible. Fixed at the adapter.

**Library links 404'd.** There are two ids for the same post: the feed's
`anonymous-mastodon:<host>:<rawId>` and the route's base64
`anonymous-status.<blob>`. Only the second resolves, and the library stored the
first. Now goes through `pages/read/reader-route-id.ts`; `ThreadLoader` also
learned to accept the feed form so entries already written resolve.

**"Why does it say I'm anonymous? I'm logged in."** The important one, written
up as [[kindle-anonymous-fetch-finding]] and now **fixed** for the reader path.
`anonymous-mastodon` names *the post's origin*, not the session — but the
operator's real complaint was correct: remote posts were fetched with no
credentials even when signed in, which is precisely how followers-only and
unlisted posts go unseen. The reader now resolves them through the home server
first (`resolve=true`), falling back to the public read when that fails. The
profile page still has the same gap and is flagged there.

I deferred this twice on bad reasoning before the operator pushed back — once on
request cost (we economize against paid third-party APIs, not our own server),
once on shared links (they carry the origin permalink, never these ids), and
once by calling it a "federation change" when it is one existing method on an
endpoint we already use.

### One trap worth recording

`vi.useFakeTimers()` in the position-saving spec leaked into the rest of the
run: fake timers are global, so every later spec file saw a clock that never
advanced, and it surfaced as an unrelated `bulk-actions` retry test failing.
Fixed with an `afterEach(() => vi.useRealTimers())`. Worth knowing because the
symptom points at entirely the wrong file.

### Numbers

| | |
| --- | --- |
| New tests | 82 (40 store, 12 core integration, 10 panel, 7 chain, 6 route id, 7 resolve) |
| Total | 5792 passing |
