# Kindle — Epic overview: the reader page

Status: Sprints 1-2 **COMPLETE** (2026-09-04). Sprint 3 planned.
Owner: matthewdeanmartin

Builds on [[project-mimb-readability]] and `sprint/reader-1-article-expansion.md`
(the fetch → extract → quality-gate → markdown pipeline) and on
`sprint/rss-3-read-tracking-and-filters.md` (read/star state, pagination).
This epic does not rebuild any of that.

## Product premise

**A Kindle app for tweetstorms and long tweets.**

That framing decides more than it looks like it does. A Kindle is not a browser
with the chrome hidden — it is a device with three properties the current reader
does not have:

1. **The book is the whole screen.** No rails, no top bar, no footer. The only
   persistent UI is a tool bar that belongs to the reading, not to the app.
2. **It remembers what you are reading**, across documents and across sessions,
   and it will tell you how far in you are.
3. **The tools are reading tools** — look up a word, search inside, highlight a
   passage, keep a note — not social tools with reading bolted on.

Today reader mode is a *variant of the thread page*: `?reader=1` flips a signal
inside `pages/thread/thread.ts` (~1200 lines), the rails hide via a
`ReadingZen` hold, and the article renders below the post. That worked while the
reader was a toggle. It stops working the moment reading has state of its own —
a library, a position, notes, highlights — because all of it would have to live
inside a component whose actual job is rendering a conversation.

**So: reader gets a page.** The thread page keeps a Reader *button*, but the
button navigates rather than toggles.

## What stays where

The user's constraint, taken literally: **do not create a third reading surface.**
There are two today (thread reader-mode and `pages/rss/rss-article`) and this
epic ends with two — a feed-side widget and one reader page.

| Surface | Today | After |
| --- | --- | --- |
| **Feed reader widget** — Home, lists, tag feeds | `reader-toolbar` + `prefs.feedReader` typography applied in place | Unchanged. This is the "make the timeline readable" feature and it is not a document reader. |
| **Thread reader mode** — `?reader=1` in `thread.ts` | Full inline reader: chain, article expansion, comments, actions | Becomes a *link*. `?reader=1` redirects to `/read/:id`. The inline block and its toolbar are deleted. |
| **RSS split-pane article** — `pages/rss/rss-article` | Its own fetch + pagination + share inside the right pane | Re-hosted on the shared reader core. The split pane keeps its pane; what renders inside it is the same component the reader page uses. |
| **Reader page** — new | — | `/read/:id`. Zen by default, page-flip by default, library, progress, vocab, search, highlight, notes. |

## Route identity

One id scheme, the one `thread.ts` already understands, so nothing has to learn
a second one:

```
/read/109384...          a tweetstorm or a long single post
/read/rss:ab12cd         an RSS item
/thread/:id?reader=1  →  redirect to /read/:id
```

`?reader=0` on an RSS link keeps its current meaning (open the thread, not the
reader) and simply does not redirect.

## What is already built (and is not re-done here)

Surveyed 2026-09-03. The epic is smaller than it looks because most of the
engine exists:

- `providers/article/*` — fetch, extract, quality gate, markdown render,
  diagnosis, quota, reading tally. Every failure already has a named reason.
- `providers/article/article-diagnosis.ts:29` — `UNLIKELY_HOSTS`, already
  carrying nytimes/wsj/ft/economist/bloomberg/newyorker/theatlantic plus the
  login-wall hosts, each with a `why`. Sprint 3 extends this; it does not
  invent it.
- `pages/rss/article-pages.ts` — page-flip pagination, 500-word target,
  block-boundary splits, fenced-code aware. **Page flip is already implemented**;
  Sprint 1 promotes it from RSS-only to the reader's default.
- `reading-zen.ts` — counted hold that hides the rails without writing the zen
  preference. Exactly what a zen-by-default page needs, already correct.
- `share-dialog/share-selection.ts` — selection capture scoped to a container,
  with the two traps (read-before-open, wrong-card) already solved. Sprint 3's
  highlight tool is built on it rather than beside it.
- `providers/rss/rss-read-state.ts` — timestamped maps, 90-day age cap, 20k
  entry cap, tolerant load. **The library's data model is this model**, per the
  operator's instruction.

Genuinely new: the library store, the reader page shell, progress display,
vocabulary lookup, in-document search, notes, and the observed-failure LRU.

## Design rules for this epic

Three, stated once so the sprints can stop restating them.

**Zen is the default and the top bar does not come back.** The page takes a
`ReadingZen` hold on activate and releases on destroy. There is no "show the
chrome" toggle — the way out is Exit, which is a toolbar button.

**Every reader control is a compact toolbar button.** The rounded `.btn` /
`.btn-outline` pill is for actions in the app; the reader's own controls follow
the home-feed filter treatment (`home.css:74` — zero border, 5px radius,
transparent background, 13px, `.active` fills with `--accent-soft`). Library and
Exit are compact buttons like the rest. No exceptions, including Exit.

**The toolbar may be wider than the text.** The measure is ~65-75ch for prose;
the toolbar is not prose and is not constrained by it. It spans the reading
column's container, not the column.

## Sprints

1. **[[kindle-1-page-and-shell]]** — DONE. The route, the shell, zen, the
   compact toolbar, page flip as default, and the redirect from thread
   reader-mode. The old inline reader is deleted and RSS is re-hosted on the
   shared core. Also extracted `ThreadLoader` and `ArticleExpansion`, and fixed
   a pre-existing `ngSrc`/data-URI crash on RSS status cards. Net −1416 lines.
2. **[[kindle-2-library-and-progress]]** — DONE. The library store (three
   shelves, `rss-read-state`-shaped, Plus-sync seam), the library panel wearing
   the RSS rail's look, position memory, and the progress indicator. The
   "save without opening" entry point is built in the store but has no UI yet —
   it collides with Bookmarks and RSS's Read later, which is a product call.
3. **[[kindle-3-reading-tools]]** — vocabulary lookup, in-document search,
   highlights with notes, the notes right rail, and the observed-failure LRU
   on top of `UNLIKELY_HOSTS`.

## What this epic does not do

- **No server-side library sync.** Sprint 2 leaves a seam shaped like
  `article-reading-tally.ts`'s, and stops there.
- **No proxy-side failing-host reporting.** Sprint 3's LRU is local and
  exportable; teaching `mawkingbird_cors_proxy` to collect it is future work.
- **No annotation of the original page.** Highlights anchor to the extracted
  markdown, which is what we control. Re-anchoring into a live remote DOM is a
  different, much harder feature.
- **No offline download.** The article cache already exists; making the library
  work aeroplane-style is a plausible follow-on, not this.
