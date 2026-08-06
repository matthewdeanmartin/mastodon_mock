# Hugo — Sprint 2: See your posts, edit one

Status: COMPLETE (implemented 2026-08-05; 3255 tests, lint, prettier and both builds clean;
53 tests added). Roadmap: `hugo-0-overview.md`. Depends on sprint 1.

## What changed during implementation

- **The handoff mechanism already existed, and it is two halves, not one.** The plan said
  "find how a draft is loaded into the composer and reuse that path". It turned out to be
  `Drafts.handoff()` — an in-memory slot that /drafts and /pastes already use for "Edit for
  post", drained once by the composer on seed. That carries the title and body perfectly.
  It cannot carry a path, a sha, a delimiter style or unknown front-matter keys, and
  teaching `DraftSnapshot` about shas would make every other target's storage learn what
  git is. So a second, Hugo-owned slot rides alongside it: `HugoEditSession`. Unlike the
  draft handoff it is deliberately **not** one-shot — the composer needs it again at submit
  time to write back with the right sha.
- **Leaving the Hugo target cancels the edit.** Not in the plan, and a real hazard: a
  parked path and sha that outlived the target would attach to the next thing the user
  wrote and silently overwrite a file they had stopped thinking about. `onTargetChange`
  clears it, and the composer opens *on* the Hugo target when an edit is parked so the
  question mostly does not arise.
- **`HugoEditSession.advance()` exists because saving twice in a row would 409 against our
  own commit.** Not in the plan; found while writing the update path.
- **The composer's Status for an edit is built inline rather than by `HugoPublish`.**
  `publish()` owns slug arithmetic and returns a Status; `update()` deliberately does not,
  because the slug is fixed and the caller already knows the title and body. It returns the
  commit, and the composer calls `hugoStatus()` — which needed a new
  `HugoSettings.permalinkFor(slug)` helper so callers do not each unpack the repo.
- **Hydration is capped and the cap is tested.** As planned (20 per pass, keyed cache), but
  worth restating: `hugo-posts.spec.ts` asserts that a 100-entry directory issues exactly
  20 file reads. That test is the whole reason the ceiling will survive future edits.
- **A spec-hygiene bug bit twice, and is now fixed everywhere.** `vi.restoreAllMocks()`
  restores the original `fetch` but does **not** clear the call log of a spy a previous
  test installed on it. With one `describe` block the leak was invisible; adding a second
  made call counts grow test-over-test and produced 13 confusing failures. Every Hugo spec
  now calls `vi.clearAllMocks()` as well. If a future sprint sees "expected 1, got 9",
  this is why.

Sprint 1 makes the repo write-only from Mawkingbird's point of view: you can add posts and
never see them again. This sprint closes the loop — the repo's posts become a list you can
open, edit and republish.

## Exit criteria

1. `/settings/connections/hugo` lists the Markdown files in the configured content path,
   newest first, with title and date read from front matter.
2. "Edit" opens the composer prefilled with the post's title and body, in an
   unmistakably-editing state.
3. Publishing an edit `PUT`s with the stored `sha` and updates the same file.
4. A stale `sha` (edited elsewhere since the list was loaded) produces "someone changed
   this post since you opened it", not a silent overwrite and not a stack trace.
5. Deleting is **not** in this sprint. See non-goals.

## Why a page under the connector, not the drafts page (decision 6)

A local draft is text that has never left this browser and that only you can lose. A Hugo
post is a file in a git repo with a history, possibly edited from a laptop, possibly
already read by people. Merging them into one list would mean one "delete" button with two
very different meanings. They stay separate.

`/blog` was the other candidate and it is **already the docs hub** (`app.routes.ts:536`,
where the comment explains it cannot be `/docs` because FastAPI serves Swagger there). Do
not repurpose it.

## Listing

`GET /repos/{o}/{r}/contents/{contentPath}?ref={branch}` returns a flat array for the
directory — name, path, sha, size, type. Enough to render a list *except* the title and
date, which live inside each file's front matter.

That is the sprint's one real design decision: **N+1 fetches, or titles from filenames?**

Take the middle: **list from the directory immediately, then lazily hydrate front matter
for the visible rows.** Render each row instantly with its filename-derived title (a slug
un-slugified is a decent guess), then fetch and replace with the real title as each
resolves. Concretely:

- One directory call on page load. Cheap, one request, always.
- Then at most **20** file reads, oldest-first-cancelled — i.e. hydrate the newest 20 by
  filename sort, and hydrate the rest only if the user pages further.
- Cache hydrated front matter in memory for the page's lifetime, keyed by `path+sha`.
  A `sha` change is exactly the signal the cached parse is stale, which is a free
  correctness win — use it.

A repo with 400 posts must not fire 400 requests. State that ceiling in the code, because
the naive version works fine on the author's 12-post test repo and falls over on a real
blog.

**Sorting**: Hugo posts are conventionally named `YYYY-MM-DD-title.md` *or* rely on the
`date` field. Sort by front-matter `date` where hydrated, falling back to a date parsed
from the filename, falling back to filename descending. Say which in a tooltip when it is
the fallback — a list in a surprising order with no explanation reads as broken.

Skip non-`.md`/`.markdown` entries and `_index.md` (Hugo's section index, not a post).

## Editing in the composer

The composer already round-trips title (CW box) and body for blog targets. Editing needs
three things it does not have:

1. **A way to open it prefilled.** The existing drafts flow already does exactly this —
   find how a draft is loaded into the composer and reuse that path rather than inventing
   a second one. Check `drafts.ts` and its composer consumer before designing anything
   here; if the mechanism is a route param plus a store lookup, mirror it.
2. **An editing context that survives the round trip**: `{ path, sha, originalFrontMatter }`.
   The third field matters — a post may carry keys we do not model (`categories`,
   `aliases`, a theme's custom field, YAML instead of TOML). Preserve them verbatim and
   rewrite only `title`, `date`(untouched, actually — keep the original publish date) and
   the body. **An edit must not silently strip a field.** This is what
   `parseFrontMatter`'s round-trip requirement in sprint 1 was for.
3. **Visible editing state.** The composer must say "Editing: <title>" with a cancel, and
   the submit button must read "Update post". A user who thinks they are writing something
   new and instead overwrites a post will not trust this feature again.

`draft = true → false` is a real transition here (publishing a Hugo draft), so the draft
checkbox must reflect the file's current value when loaded, not default to false.

## Concurrency (exit criterion 4)

`PUT` with a `sha` that no longer matches returns **409**. Catch it specifically and say
the true thing: the post changed on GitHub since it was opened, and offer *reload this
post* (re-read, re-prefill, losing the local edit with a confirm) — not a force-overwrite
button. Force-overwrite is a data-loss button wearing a helpful hat.

A 404 on update means the file was deleted or renamed elsewhere; distinguish it.

## Non-goals for this sprint

- **No delete.** Deleting a published post is a destructive, outward-facing action on
  content other people may have linked to. It is one API call (`DELETE contents/{path}`)
  and it will be trivial to add later; it needs a confirmation design that this sprint
  should not rush.
- **No rename/re-slug.** Changing the filename of a live post breaks its URL. If the title
  is edited, the slug stays put. Say so in the UI ("the post's address doesn't change").
- **No creating subdirectories / sections.** One content path, flat.
- **No conflict merging.** See above: reload or cancel.
- **No pagination UI beyond "show more"** unless the list work turns out cheap.

## Test notes

- Front-matter round-trip is the highest-value test surface: parse a file with unknown
  keys and YAML delimiters, edit the title, re-serialize, assert every other key survived
  byte-identically.
- List hydration: assert the request ceiling (a 100-entry directory issues ≤ 20 file
  reads), and that a `sha` change busts the cache.
- Update path: correct `sha` → 200 and a success state; stale `sha` → 409 → the reload
  offer, and specifically *not* a retry-without-sha.
- Filter specs: `_index.md` and a `.png` in the content dir do not appear as posts.

## Handoff note

The list page and the edit flow are cleanly separable. A half-done sprint should ship
**the read-only list** (exit criteria 1 only) — it is independently valuable, it proves the
contents API in both directions, and it leaves no half-wired composer behind.
