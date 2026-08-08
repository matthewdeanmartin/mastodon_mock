# Write — Sprint 1: the workspace and the two zens

Status: COMPLETE (implemented 2026-08-08; not yet smoke-tested against a live account)

Read `write-0-overview.md` first. Depends on `drafts-sprint01..03.md` — all complete.

## What this sprint delivers

A new `/write` route: a full-width, rails-off writing workspace with the draft list on the left,
an editor in the middle, and a right pane reserved for notes (which sprint 2 fills). Plus **writing
zen**, which hides literally everything but the text.

No publish wizard, no kanban, no PKM model. Publishing from `/write` in this sprint goes through
the path that already exists.

## What the code gives you (audited — trust this, but verify line numbers)

### The wide-layout pattern is already there and is three lines

`shell/shell.ts:22` —

```ts
function isWideUrl(url: string): boolean {
  return (
    url.startsWith('/settings') || url.startsWith('/conversations') || url.startsWith('/search')
  );
}
```

`/write` joins that list. `shell/shell.html:238` already does the layout switch, and
`shell/shell.css:402` has `.layout-zen { grid-template-columns: minmax(0, var(--col-width)); }`.
The two-box grid inside a wide page is the `/chat` pattern — copy its CSS approach, don't invent one.

### The editor already exists — do not write a second composer

`<app-compose>` is 2130 lines with eight mount sites. It has the inputs you need
(`compose/compose.ts:350-391`): `initialText`, `initialDraft`, `initialVisibility`, `compact`,
`gateable`. Its thread model is `text` + `thread[]` combined by
`segments = computed(() => [this.text(), ...this.thread()])` (`compose.ts:524`), and
`addThreadBox`/`setThreadText`/`removeThreadBox` (`compose.ts:1158`) are the manual split-on-demand
path that already works.

`/drafts` already mounts it save-only at the top of the page (`drafts-page.ts:161` `writing`
signal). `/write`'s editor is that mount, given room.

### Length counting is already correct and is not yours to redo

`compose/post-length.ts` implements Mastodon's URL-weighted counting
(`characters_reserved_per_url`, 23). Any split logic **must** use `postLength()`, never
`string.length`.

### Draft plumbing is done

- `Drafts` (`drafts.ts`) — `save()`, `remove()`, `get()`, `handoff()`/`takeHandoff()`, and
  per-context `autosave()`. `DraftSnapshot` is the neutral shape everything reads and writes.
- `DraftSources` (`pages/drafts/draft-sources.ts`) — the merged four-kind list as a signal, with
  per-source error isolation and an anonymous fast path that issues no requests. **Reuse this
  service directly.** It is `providedIn: 'root'`, so `/write` and `/drafts` share one live list.
- `toSnapshot()` (`pages/drafts/draft-items.ts:238`) — read any kind into a `DraftSnapshot`.

### The existing global zen

`ClientPrefs.zenMode` (`client-prefs.ts:442`), surfaced in `blue-controls.html:203`, consumed only
at `shell/shell.html:238-249`. It hides the rails and nothing else. **Leave its meaning alone.**

## Stories

### S1.1 — The route and the feature flag

`/write`, lazy-loaded, titled "Write", behind a `write` feature flag via the existing
`featureFlagGuard` + `data: { featureFlag: 'write' }` pattern (see the `/pastes` route,
`app.routes.ts:666`). Add `/write` to `isWideUrl()`.

A nav entry in the left rail next to Drafts. `/drafts` gains a link to `/write` — the two coexist;
`/drafts` stays the plain merged list and is the honest "show me everything" view.

### S1.2 — The three-pane layout

Left: the draft list, reading `DraftSources.items()`, with the same kind filter chips `/drafts`
has. Rows are compact (this pane is narrower than `/drafts`) and selecting one loads it into the
editor.

Centre: the editor. Above it, the current draft's identity (kind badge, last-saved time) so it is
never ambiguous which draft you are editing.

Right: the notes pane. **This sprint it is a placeholder** with an honest empty state naming what
lands in sprint 2 — not a fake list, not lorem. If the placeholder feels dishonest, ship the pane
collapsed and let sprint 2 open it.

Below ~1100px, the side panes collapse to disclosure toggles above the editor rather than
disappearing. Nothing in this workspace may become unreachable on a laptop screen.

### S1.3 — Loading and saving a draft

Selecting a left-pane row loads it into the editor. The rule from `drafts-sprint02` holds and is
not negotiable: **a local draft is continued in place; every other kind hands over a copy and the
original is left exactly where it is.** `editForPost()` in `drafts-page.ts:197` is the reference
implementation of that rule — the same distinction, not a new one.

Saving updates the current draft rather than appending a duplicate. `Drafts` today has `save()`
(always appends) and `remove()`, so this sprint adds `Drafts.update(id, snapshot)` — refreshing
`updatedAt`, preserving `id` and list position. That is a genuine gap in the service, not a
workspace-local hack: `/drafts`' own editor has the same duplicate-on-resave problem today.

Unsaved-changes protection: switching drafts or leaving the route with a dirty editor must prompt.
The composer's `autosave()` slot is a backstop, not a substitute — a workspace that silently eats
an edit fails at the one job it has.

### S1.4 — Split by `---`

The default split mode for a draft written in `/write`. A line consisting of exactly `---`
(trimmed) is a segment boundary. The editor stays one textarea; segmentation is computed for
display and carried into `DraftSnapshot.segments` on save.

Show, live, beside the editor: segment count and each segment's `postLength()` against the
instance limit, with over-limit segments marked. This is the first virtuous distraction and the
whole reason the middle pane has room.

The other two modes are selectable per draft and stored in the sidecar (S1.6):

- **`---` (default)** — as above.
- **On demand** — today's manual thread boxes, plus a "split here" control at the caret.
- **Autosplit** — chunk continuous prose at the instance limit, preferring paragraph then sentence
  then word boundaries. Never split mid-URL (`findUrls()` in `post-length.ts` gives you the spans).

Put the split logic in its own pure module (`pages/write/split-modes.ts`) with its own spec. It is
the most testable thing in the sprint and the wizard's preview step (sprint 3) will import it.

### S1.5 — Writing zen

A signal on the `/write` page, **not** a persisted pref — it is temporary and per-session by
decision. Entering it:

- hides the universal header and footer, the rails, and both side panes;
- leaves the text, an `[Exit zen]` control, and `[Save draft]`;
- is exited by that control **and** by `Escape`, and the exit control stays visible (a mode you
  can't see the way out of is a trap).

The shell has to cooperate, since the header and footer are shell-owned and outside the router
outlet. Add a small root-level service (`writing-zen.ts`, `providedIn: 'root'`) holding one boolean
signal, set by `/write` and read by `shell.html` alongside `wide()` and `prefs.zenMode()`. Reset it
on navigation away so a zen session can never leak into another route.

Both zens on at once must be indistinguishable from writing zen alone — writing zen hides a strict
superset. Test that combination explicitly.

Accessibility, mandatory and consistent with the a11y work in the last two commits: the mode change
is announced, focus lands in the textarea on entry and returns to the trigger on exit, and the exit
control has an accessible name that is not an emoji.

### S1.6 — The workspace sidecar

One account-scoped localStorage record, `mockingbird_write_workspace` via `scopedKey()`, holding
per-draft workspace metadata that no draft kind has room for:

```ts
interface WriteMeta {
  splitMode: 'rule' | 'demand' | 'auto';
  column?: 'ideas' | 'writing' | 'editing' | 'scheduled'; // sprint 4 writes this
}
type WriteWorkspace = Record<string /* DraftItem.key */, WriteMeta>;
```

Keyed by `DraftItem.key` (`local:<id>`, `self:<id>`, …) because that is the only identifier unique
across kinds. Sprint 4's kanban writes `column` into this same record — **create the shape now with
`column` optional** so sprint 4 adds a writer, not a migration.

Entries for drafts that no longer exist are pruned on load. Unknown keys are ignored rather than
erroring: this is a cache of preferences, and losing one costs nothing.

### S1.7 — Coverage

- Split-mode module: `---` boundaries, over-limit marking, autosplit never breaking a URL, empty
  and whitespace-only segments.
- Route is wide (`isWideUrl('/write')`), and the flag guard blocks it when off.
- Load-a-draft: local continues in place, self/paste/scheduled copy and leave the original — assert
  the source still exists after.
- `Drafts.update()` mutates rather than appends, and preserves list position.
- Writing zen: header/footer/rails/panes absent; both zens on ≡ writing zen alone; `Escape` exits;
  focus goes to the textarea and returns on exit; the signal resets on navigation away.
- Sidecar: round-trips, is account-scoped, prunes dead keys, survives a record with unknown fields.

## Traps

- **`npm run test:ci` only.** Raw vitest fails in this repo. Renaming or deleting a spec trips the
  manifest guard even when everything passes — rerun with `npm run test:ci -- --update`.
- **Never format and test in one shell invocation.** Known trap in this repo.
- The `rate-limit.interceptor.spec` and drafts `"merges all four kinds"` specs are known
  intermittent flakes. Re-run before investigating.
- Do not add `ad-*` class names.
- `DraftSources` is a root singleton whose `load()` is called by `/drafts`' `ngOnInit`. Calling it
  again from `/write` is fine and intended, but do not assume it is unloaded on arrival.

## Definition of done

`npm run lint`, `npm run format:check`, `npm run test:ci`, `npm run build`, and
`npm run build:mockingbird` all pass. Append a **Delivered** and a **Found while implementing**
section to this file, in the style of `drafts-sprint03.md` — the next sprint's session reads them
as its ground truth.

---

## Delivered

### New files

| File | What it is |
| --- | --- |
| `pages/write/split-modes.ts` (+spec) | Pure split/measure module. `splitOnRule`, `autoSplit`, `segmentsFor`, `insertSplitAt`. No Angular. |
| `pages/write/write-workspace.ts` (+spec) | `WriteWorkspace` — the account-scoped sidecar, keyed by `DraftItem.key`. |
| `pages/write/write-page.{ts,html,css}` (+spec) | The three-pane workspace and writing zen. |
| `writing-zen.ts` | Root service holding the one boolean the shell reads. |

### Changed

- `drafts.ts` — added **`Drafts.update(id, snapshot)`**, returning `boolean`. Overwrites in place,
  keeps list position, advances `updatedAt`, returns `false` when the id is gone.
- `shell/shell.ts` — `/write` added to `isWideUrl()`; `WritingZen` injected as `writingZen`.
- `shell/shell.html` — the skip link and `<header>` are now inside `@if (!writingZen.active())`;
  the footer and both rails likewise; the layout div gained `layout-writing-zen`. A `Write` entry
  sits above `Drafts` in the More menu, behind the flag.
- `shell/shell.css` — `.layout-writing-zen` (one full-width column, full-height, no borders).
- `feature-flags.ts` — new `write` flag, `defaultState: 'production'`, in the `features` group.
- `app.routes.ts` — `/write`, lazy, titled "Write", behind `featureFlagGuard`.
- `pages/drafts/drafts-page.{ts,html,css}` — an "Open in Write →" link in the page head (flagged);
  `.page-head` became flex to hold two children.

### Decisions taken while building

- **The split mode picker sits on the editor, not in settings.** It is per draft, and it is stored
  per draft. A global default would have been the wrong shape for the one setting people change
  most often mid-piece.
- **`joinSegments` reopens a thread with visible `---` boundaries.** Collapsing a three-post thread
  into one paragraph on reopen would silently destroy the structure someone chose.
- **`autoSplit` never cuts inside a URL.** A severed link is worse than an over-long post: the post
  is merely ugly, the link is broken. `findUrls()` gives the spans, and the cut pulls back to the
  URL's start.
- **`isSplitRule` matches exactly `---`**, not "three or more dashes". People type `----` and
  `--------` as decoration, and swallowing those would break somebody's ASCII art into two posts.
- **The unsaved-work dialog is bespoke, not `app-confirm-dialog`.** Three outcomes (save / discard /
  cancel) do not fit a yes/no component. It uses the same `appFocusTrap` + overlay markup.

## Found while implementing

**Publishing must not be guarded, and the first version was.** `publish()` originally routed through
the same unsaved-work guard as switching drafts, so publishing an unsaved draft prompted *"you have
unsaved writing"* on the way to disposing of it. Caught by its own spec. The guard exists to stop
writing being **thrown away**; handing it to the composer is the opposite. `publish()` now clears
`dirty` and hands off directly, and there is a spec asserting it is never held up.

**Three `new`-context mounts, three answers — again.** The same shape `drafts-sprint03` hit. Here it
was: the workspace does not publish. It hands to the composer via `Drafts.handoff()`, exactly as
`/drafts`' "Edit for post" does. A second publish call site would have needed its own copies of the
visibility rules, target restoration and the thoughtful-posting gate, and would have drifted.

**`Drafts.update()` filled a gap, but "append on resave" is not simply a bug.** The workspace needed
update-in-place because you edit one draft for an hour there, and forty copies is not a workspace.
But `/drafts` appending is partly deliberate, and the boss confirmed it: **some draft targets cannot
be edited at all** — several pastebins are write-once — so for those kinds a resave *has* to be a
new copy. `/drafts` was therefore left alone, and correctly so.

What is genuinely missing is not `update()`; it is **explicit save-as-copy vs save-as-edit
semantics in the UI**, so the user chooses rather than the page guessing from the draft's kind.
That is a real piece of design work and belongs in its own sprint. `Drafts.update()` is one half of
the machinery it will need.

**A11y lint caught two things worth keeping.** The zen Escape handler was on a wrapper `<div>` —
unreachable for a keyboard user, since focus is in the textarea. It moved onto the textarea. The
overlay needed `tabindex="-1"` + `keyup.escape` to match the existing `confirm-dialog` pattern.

**Three spec traps, all mine, all worth recording:**

- `as Status` on a partial fixture fails the build (`TS2352`) once the object has enough fields to
  *look* like a `Status`. `as unknown as Status` is what the neighbouring specs use.
- `httpMock.verify()` cannot be used to prove "this page posted nothing" — it also catches the
  page's own `DraftSources.load()`. Assert `httpMock.match((r) => r.method === 'POST')` is empty.
- `ngModel` writes into a newly-rendered `<textarea>` asynchronously, so `.value` is `''` right
  after `detectChanges()`, and `vi.runAllTicks()` does not flush it. The zen spec asserts on the
  bound signal and on which elements exist, which is what the test was actually about.

**The pruning effect needs a settled source.** It reads `sources.loaded()`, which is only true
synchronously on the anonymous path; signed-in, it waits on two requests. The spec sets anonymous
mode for that reason, and it is the honest arrangement — an unsettled list must not be treated as
"these are all the drafts that exist" and used to delete sidecar entries.

## Verification

- `npm run lint` — pass.
- `npm run format:check` — pass.
- `npm run test:ci` — **3500 tests pass, 0 fail** (908 files; 61 added this sprint). Manifest
  updated with `-- --update`.
- `npm run build` and `npm run build:mockingbird` — pass. The two budget warnings (initial bundle,
  `status-card.css`) are pre-existing and unchanged by this sprint.

## Carried forward

- **Not smoke-tested against a live mastodon.social account.** Every server interaction here is
  inherited from `DraftSources`, which sprint 1 did not change, so the risk is low — but the
  three-pane page has never been opened against real data.
- **Save-as-copy vs save-as-edit needs explicit UI.** `/drafts` appends on resave, which is right
  for write-once targets (several pastebins cannot be edited) and wrong for a local draft you are
  revising. Today the page decides silently; the user should. Its own sprint — `Drafts.update()`
  is half the machinery it will need.
- **The notes pane is a placeholder** with honest copy naming what lands next. Sprint 2 replaces it.
- **The kanban `column` field is written by nothing.** The shape exists in `WriteMeta` and is
  round-tripped and validated by the sidecar's spec, so sprint 4 adds a writer, not a migration.
