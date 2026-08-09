# QoL sprint 1 — the five bugs

Every one of these is a control that is present and lies about what it will do. See
`qol-0-overview.md` for the diagnoses; this is the work.

## 1a. Bluesky: per-target character limit

**Where:** `compose/compose.ts:843–868`.

`maxChars` and `overLimit` are both hardcoded to `MAX_POST_CHARS` (500). Bluesky is 300
graphemes, and `graphemeLength` from `providers/bluesky/bluesky-facets` is already
imported at `compose.ts:31`.

- Add `MAX_BSKY_CHARS = 300` next to `MAX_POST_CHARS` (or re-export the constant
  already sitting in `bluesky-reply.ts:11` rather than defining a second one).
- Make the effective limit a computed off `target()`: Bluesky-only → 300 counted with
  `graphemeLength`; `both` → **the lower of the two**, since one text goes to both; fedi
  and the rest → 500 counted with `postLength`.
- `overLimit` measures each segment against that effective limit.
- The visible counter shows the effective limit, and when the target is `both` says
  which limit is binding — "300 (Bluesky)" — so the number is explicable.

## 1b. Bluesky: allow threads, or explain the refusal

**Where:** `compose/compose.ts:942–954`.

The rule `if (this.thread().some((t) => t.trim())) return false;` kills the Post button
with no message. Bluesky supports threads natively (`bluesky-reply.ts` already posts
replies with the parent/root refs), so the honest fix is to support them.

- Post the Bluesky leg as a real thread: first post, then each subsequent segment as a
  reply carrying `parent` = previous post and `root` = first post. That is the same
  record shape `bluesky-reply.ts` builds; lift the shared part rather than copying it.
- If a leg fails partway, report which posts landed. A thread half-published that
  claims total failure sends the user to post it all again.
- Keep the single-post rule **only** where it is genuinely true: scheduled posts
  (`compose.ts:938`), polls, and media on a Bluesky-only target.
- Anywhere a rule still blocks submission, `canSubmit` returning false is not enough —
  surface the reason next to the button. A dead button with no text is the bug being
  fixed here, and re-introducing it elsewhere would be the same bug.

**Tests:** a 400-char Bluesky post is over limit and 400-char fedi post is not; a
two-box thread with Bluesky selected is submittable; a scheduled Bluesky post is not,
*and* says why.

## 1c. Feed no longer jumps when you like a post

**Where:** `pages/home/home.ts:282–290`, `sentiment.ts:349`.

The filter decision must be made once per post and then held, so the user's own
interaction cannot re-sort the page under their thumb.

- Add a session-scoped decision cache keyed by status id: the first time a post is
  evaluated for Calm, record the verdict and reuse it for the life of the feed.
- Clear it when the feed is genuinely reloaded (pull-to-refresh, route change), not on
  every recompute.
- Apply the same treatment anywhere else a post-level filter reads a mutable engagement
  count — grep the other `applyTimelineFilters`-alikes in `pages/` before finishing.

This deliberately does **not** change what Calm hides on first read; it changes only
whether a post can change category while you are looking at it.

**Test:** with Calm on, a ratioed post that is hidden stays hidden after its
`favourites_count` rises; a shown post keeps its index after `changed` fires.

## 1d. Bulk actions: correct scope in the dialog

**Where:** `pages/settings/bulk-actions/settings-bulk-actions.html:96`.

- Pass the target conditionally: `[target]="needsList(id) ? target() : undefined"`
  (expose `needsList` to the template).
- In `BulkActionsDialog`, treat a target on a non-list action as a programming error —
  ignore it explicitly with a comment, so the next reader doesn't wire it back up.
- While a `reblogs-*` dialog is open, the list picker should visibly not apply. Simplest
  honest version: the dialog's summary already says "everyone you follow"; make sure the
  card copy for those two actions says *friends*, never *list*.

**Test:** opening the retweets-off dialog with a list selected previews against the
follow list, and issues no `/lists/:id/accounts` request.

## 1e. Mobile chat: give the conversation the screen

**Where:** `pages/conversations/conversations.css:9, 452–459`.

- Replace `height: calc(100vh - 100px)` with `100dvh`-based sizing so the retracting
  mobile URL bar doesn't cost a fixed 100px forever. Keep a `vh` fallback for browsers
  without `dvh`.
- Under `max-width: 800px`, stop stacking a 40vh peer list above the thread. Make peer
  selection a collapsed control (the current peer's name, tap to switch) so the thread
  owns the viewport.
- Audit what else stacks on that page on mobile — the instruction box called out in the
  report should be collapsible or shown once, not permanently resident.

**Test:** a component test can assert the collapsed-peer-picker state at narrow widths;
the rest is a visual check via `/verify`.
