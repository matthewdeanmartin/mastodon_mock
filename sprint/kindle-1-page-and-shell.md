# Kindle 1 — The reader page and its shell

Status: **COMPLETE** (2026-09-04)
Epic: [[kindle-0-overview]]

Goal: reader mode stops being a flag on the thread page and becomes a page.
Ends with **one** document-reading component, hosted in two places (the reader
route and the RSS split pane), and the inline reader in `thread.ts` deleted.

## Why the page has to come first

Everything in Sprints 2 and 3 is state that belongs to *a document being read*:
which shelf it is on, how far in you are, what you highlighted. Adding any of it
to `thread.ts` means adding it to a component that also renders a conversation,
handles replies, boosts, bookmarks and comments — and then extracting it later,
with the state already live in people's browsers. The order is not negotiable.

## 1a. The route

`app.routes.ts`, inside the shell's children (so nav state and guards behave),
lazy-loaded like its neighbours:

```ts
{
  path: 'read/:id',
  title: 'Reader',
  loadComponent: () => import('./pages/read/read-page').then((m) => m.ReadPage),
}
```

Not anonymous-guarded. Reading is the thing an anonymous visitor is most likely
to want, and the article pipeline already works without a session.

**The redirect.** `thread.ts` currently computes reader mode from `?reader` in
`applyReaderMode()` (`thread.ts:822`). That method becomes a navigation: when
the param says reader, `router.navigate(['/read', id], { replaceUrl: true })`.
`replaceUrl` matters — without it, Back from the reader lands on the thread URL
that immediately bounces forward again, and the reader is trapped.

`?reader=0` on an `rss:` id keeps its current meaning: stay on the thread.

## 1b. The reader core, extracted

A single component, `pages/read/reader-core/`, that renders **a document**:
title, byline, the paginated body, and the toolbar. It knows nothing about
routes, panes, or where the document came from.

Inputs: the resolved document (see 1c), and a `layout` of `page` or `pane`.
`pane` is what the RSS split pane passes; it constrains the measure to the pane
width and suppresses the Exit button (there is nothing to exit to).

Both current implementations collapse into it:

- `pages/thread/thread.html:118-420` — the `@if (readerMode())` block, its
  header, expansion section, article body, pager and actions. Deleted.
- `pages/rss/rss-article/` — its fetch/expand/pagination/share logic moves into
  the core; the component becomes a thin `<app-reader-core layout="pane">`
  wrapper, or disappears if nothing else is left in it.

**The risk to name up front:** `rss-article` and thread reader-mode have
drifted. `rss-article` paginates, shows a share line, and has no actions; thread
reader-mode has actions, comments, replies, quota chips and an original-source
link, and does *not* paginate. Unifying them is where the bugs will be. The core
must ship with both behaviours available and chosen by `layout`, rather than
picking one and quietly regressing the other surface.

## 1c. Document resolution

One service, `pages/read/read-target.ts`, that turns an id into a document:

| Id shape | Source |
| --- | --- |
| `rss:<hash>` | the RSS cache, then the item's link through `ArticleFetch` |
| a status id | the thread, then `readerChain()` for the author's own chain, then the linked URL through `ArticleFetch` if the chain names exactly one |

`readerChain` (`pages/thread/reader-chain.ts`) moves to `pages/read/` with the
rest — it is a reader concept that happens to live under `thread/` today.

**A tweetstorm is a document, and a short tweet is not.** The distinction is
load-bearing for Sprint 2's library and is defined here so both sprints agree:

```ts
/** Long enough to be worth reading as a document rather than as a post. */
export const DOCUMENT_MIN_CHARS = 500;
```

A document qualifies when it is an RSS item, **or** an expanded article, **or**
a chain of more than one post, **or** a single post over `DOCUMENT_MIN_CHARS`.
500 rather than a Mastodon-derived number because some instances raise the post
limit well past 500 — the threshold is about reading effort, not about any
server's configuration.

Below the threshold the reader still opens if asked (nothing should refuse to
render), but Sprint 2 will not shelve it.

## 1d. Zen, for real

On activate, take a `ReadingZen` hold; release on destroy. That is the entire
mechanism and it already works — `reading-zen.ts` is a counted hold precisely so
overlapping holders cannot turn the rails back on underneath each other.

What is new is that there is no toggle back. The shell must not render a
"leave zen" affordance on this route; the toolbar's Exit is the way out.

Footer: hidden the same way the rails are. Check `shell/` for whether the footer
reads `ReadingZen.active` today — if it only reads `prefs.zenMode`, that is a
one-line fix and belongs here.

## 1e. The compact toolbar

Replace the reader's pills with the home-filter treatment (`home.css:74`: no
border, 5px radius, transparent, 13px, `.active` fills with `--accent-soft`).
The existing `reader-toolbar` component stays as the *feed* widget — Home
imports it at `home.html:163` and that must keep working — so this is a new
`pages/read/read-toolbar/`, not an edit to the shared one.

Sprint 1 ships these buttons:

```
[Aa] [Theme] [< 3/12 >] [Scroll]        [Library] [Exit]
```

- `Aa` opens the typography popover (size, family, weight, line height, align,
  theme) — the controls `reader-toolbar` has today, moved behind one button so
  the bar stays a bar.
- The pager is inline: prev, position, next.
- `Scroll` switches to continuous scroll; **page flip is the default**, which is
  a change from both current surfaces (thread reader-mode has no pager at all).
  The choice persists in `ClientPrefs` as `readerPageFlip: boolean`, default
  `true`.
- `Library` and `Exit` are compact buttons like everything else — the rounded
  ones are out. Exit works in Sprint 1; Library is disabled with a title until
  Sprint 2.

The bar spans the container, not the measure. The measure itself is a
`--reader-measure` custom property, default `68ch`.

## 1f. Keyboard

Page flip wants keys or it is a worse scroll. On the reader route only:

| Key | Action |
| --- | --- |
| Right arrow / space / PageDown | next page |
| Left arrow / shift+space / PageUp | previous page |
| Home / End | first / last page |
| Escape | exit reader |

Registered on the page, not in `hotkeys.ts` — these are per-surface bindings,
the same way `StatusCard`'s per-status keys are. They must stop propagation, or
`j`/`k`/`/` from the global map will fire inside the reader.

## Acceptance

- `/read/109…` and `/read/rss:…` render; `/thread/x?reader=1` lands on
  `/read/x` with one history entry, and Back reaches whatever preceded the
  thread.
- Rails and footer are hidden on the reader route, and a visitor who had zen off
  still has it off after leaving.
- Page flip is on by default; arrows and space page; Escape exits.
- The RSS split pane renders through the same core and keeps its pagination and
  share line.
- Home's feed reader widget is untouched.
- `thread.html` no longer contains a reader block; `thread.ts` loses
  `readerMode`, `setReaderMode`, `applyReaderMode`'s toggle behaviour, the font
  bumpers and the reader action handlers.
- `make check` passes.

## Traps

- **The redirect loop.** `applyReaderMode` runs on both a route-id stream and a
  query-param stream (`thread.ts:794-820`). Navigating from inside a
  subscription that then re-fires is how this becomes an infinite bounce. Guard
  on "already navigating".
- **`ReadingZen` holds leak on abrupt navigation.** The release must be in
  `ngOnDestroy`, not in an Exit handler — a browser Back never calls Exit.
- **Deleting reader mode from `thread.ts` will break `thread.spec.ts`** (782
  lines, with reader assertions throughout). Those tests move to the reader
  page's spec rather than being dropped; a deleted test is not a passing test.


## Outcome (2026-09-04)

Shipped. `make check` green; 5710 tests pass.

### What landed beyond the plan

**`ThreadLoader` (`pages/read/thread-loader.ts`).** Not in the plan, and the
largest single piece of the sprint. Resolving a route id is eight different
loads — Mastodon, Bluesky, RSS, Twitter, Eliza/local, a URL-serialized message,
an anonymous public status — each paying and failing differently, and all of it
lived inside `thread.ts`. The reader page opens the same ids, so the choice was
to copy 275 lines or extract them. Both pages now resolve through one copy;
`thread.ts` keeps its signals as aliases onto the loader's, so every existing
reference reads the same as before.

**`ArticleExpansion` (`pages/read/article-expansion.ts`).** The fetch, the
quota and the twenty diagnosis sentences, extracted from `thread.ts` and shared
with the RSS pane. The drift the plan predicted was real and worse than
expected: the pane rendered `Couldn't read the full article (bot-check)` — the
raw slug, in parentheses — where reader mode had a written sentence for every
one of the twenty diagnoses. One copy now, so a failure reads the same wherever
it is met.

**A pre-existing crash, fixed.** `RSS_AVATAR` is an inline SVG `data:` URI (so a
feed icon costs no external fetch) and `status-card.html` bound it to `ngSrc`,
which throws NG02952 on any data URI. Reachable in production today from the RSS
pane, which renders feed items as status cards; `rss-page.spec.ts` had a comment
documenting it as a known issue and stubbing the card to avoid it. The card now
branches: `NgOptimizedImage` where it applies, a plain `<img>` where it cannot.

**Reading zen grew a depth.** The plan assumed the shell already hid the footer
on a reading hold. It did not — only `WritingZen` hid header and footer, and
`ReadingZen` only hid the rails. Rather than a fourth zen, `ReadingZen.hold()`
takes `'rails' | 'full'`, counted separately, and the shell ORs the full holds
with writing zen into one `chromeHidden`.

**The redirect skips the load.** `?reader=1` used to load the whole thread and
*then* discover it was meant to hand off. The query parameter is now read before
the route id, so the hand-off happens before anything is paid for — on an RSS
item that is a feed fetch saved on every reader open.

### Numbers

| | Before | After |
| --- | --- | --- |
| `thread.ts` | 1219 lines | 395 |
| `thread.html` | 533 lines | 155 |
| Net | | −1416 lines across the change |

### Deferred to Sprint 2

- `?reader=0` is still the only way to see an RSS item as a thread. Fine, but
  undiscoverable — there is no link to it.
- Comments (an RSS item's comment feed) are loaded by `ThreadLoader` and shown
  on the thread page, but the reader page does not render them yet. The reader
  is a document surface and comments are a conversation; where they belong is a
  Sprint 2 question, not an oversight to fix quickly.
