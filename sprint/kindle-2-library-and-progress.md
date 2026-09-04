# Kindle 2 — The library, position, and progress

Status: PLANNED
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
