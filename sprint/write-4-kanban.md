# Write — Sprint 4: the kanban board

Status: COMPLETE (implemented 2026-08-08; not yet smoke-tested against a live account)

Read `write-0-overview.md`, then the **Delivered** and **Found while implementing** sections of
sprints 1–3. Those are this sprint's ground truth.

## Product premise

`/write`'s left pane is a flat, time-sorted list of everything unpublished. That is the right shape
for "what was I working on yesterday" and the wrong shape for "what is nearly done".

A board answers the second question. Four columns, in the order writing actually moves:

```
┌──────────┬──────────┬──────────┬───────────┐
│ IDEAS    │ WRITING  │ EDITING  │ SCHEDULED │
├──────────┼──────────┼──────────┼───────────┤
│ a line   │ half a   │ done,    │ parked,   │
│ and a    │ draft    │ needs a  │ publishes │
│ link     │          │ read     │ Tuesday   │
└──────────┴──────────┴──────────┴───────────┘
```

**Scheduled is derived, not dragged.** A parked or genuinely-scheduled draft *is* scheduled; that
is a fact about the draft, not an opinion about it. The other three are the user's own judgement
and are stored.

## The placement constraint — read this before designing anything

**The board's home is not settled, and the boss has said so explicitly.** It may pop open and
closed inside `/write`, or it may turn out that there simply is not the real estate and it has to
move to a screen of its own.

That is a requirement, not an open question to resolve by picking one. **Build the board so both
are true without a rewrite:**

- The board is a **self-contained component** (`pages/write/board/write-board.ts`) that takes its
  items as an input and emits "open this draft" as an output. It injects `WriteWorkspace` for the
  column read/write, and **nothing else from the page**.
- It must not reach into `WritePage` for state, and `WritePage` must not reach into it. Everything
  they share travels through the input and the output.
- Mounting it at a route later must be: add a route, pass it the same items. If moving the board
  means touching its internals, the boundary was drawn wrong.
- Its CSS lives with the component and must not assume the three-pane grid around it. Give it a
  container query or a plain `max-width`-driven layout rather than anything keyed to `.panes`.

Sprint 2 asked for exactly this discipline on the notes list — "a component the tab hosts, so the
PKM epic can mount the same component at `/pkm` without unpicking it" — and **did not do it**. The
`pkm/` model is clean, but the list markup went into `write-page.html`. Nobody has paid for that
yet; the PKM epic will.

So: this constraint is not decoration, it is the one thing that already slipped once in this epic.
If you are looking for a worthwhile extra, extracting the notes list into
`pages/write/notes/write-notes.ts` alongside the board is the obvious pairing — same shape, same
reason, and doing them together makes the boundary a pattern rather than a one-off.

**Pop open / pop closed** is the default state to build: the board is a panel that opens over or
beside the workspace and closes back to the editor, not a mode you navigate into. Remember what it
is *for* — glancing at what is nearly done, then getting back to writing. A board you have to
navigate away from and back to defeats that.

## What sprints 1–3 leave you

### The sidecar already has the field

`WriteWorkspace` (`pages/write/write-workspace.ts`) is account-scoped localStorage keyed by
`DraftItem.key`. `WriteMeta` is:

```ts
interface WriteMeta {
  splitMode: SplitMode;
  column?: WriteColumn;   // ← written by nothing, until this sprint
}
```

`setColumn()` / `column()` exist. `WriteColumn` is already `'ideas' | 'writing' | 'editing' |
'scheduled'`. The loader validates the value and **drops an unrecognized column while keeping the
split mode**, and `prune()` already clears entries for drafts that no longer exist. All of that has
specs. **This sprint adds a writer and a view, not a schema.**

That was deliberate — sprint 1's note: *"create the shape now with `column` optional so sprint 4
adds a writer, not a migration."* Hold to it.

### Everything else you need

- **`DraftSources.items()`** — the merged four-kind list, already a signal, already anonymous-safe.
- **`DraftItem.kind`** — `local` | `scheduled` | `self` | `paste`. The `scheduled` kind is what
  derives the Scheduled column.
- **`WritePage.open()`** — the load rule (local continues in place, everything else copies). A card
  on the board must route through it, not grow a parallel path.
- **The `.pane` / `.draft-row` / `.chip` CSS** in `write-page.css`, so the board reads as the same
  page rather than a bolted-on view.
- **The "don't tear down the editor" trick** from sprint 2: `tab()` is `'write' | 'notes'`, and the
  inactive surface is hidden with `.hidden-tab { display: none }` rather than `@if`-ed away,
  precisely so an in-progress body survives. The board is a *panel*, not a tab (see S4.2b) — but
  whatever it does on open, **the editor must not be destroyed and recreated underneath it**. An
  overlay panel gets this for free; a layout that swaps the editor out does not.
- **The component-boundary precedent** from sprint 2: the notes list was built as a component the
  tab hosts, so the PKM epic could later mount it at `/pkm` unchanged. The board needs the same
  treatment for the same reason — see the placement constraint above.

## Stories

### S4.1 — The column model

A pure module (`pages/write/board.ts`) with its own spec:

- `columnFor(item, meta)` — the derivation. A `scheduled`-kind draft is always `scheduled`,
  whatever the sidecar says; everything else takes its stored column, defaulting to **Ideas**.
- `groupByColumn(items, workspace)` — items bucketed in column order, each bucket newest-first.

Default to Ideas rather than Writing: a draft nobody has triaged has not been started, and the
board's job is to make untouched work visible rather than to flatter it.

### S4.2 — The board component

`<app-write-board>`: four columns, each a scrollable list of compact cards showing the preview, the
kind badge, and the age.

Its whole contract with the outside world:

```ts
readonly items = input.required<DraftItem[]>();
readonly currentKey = input<string | null>(null);   // highlights the open draft
readonly opened = output<DraftItem>();              // "put this in the editor"
readonly closed = output<void>();                   // "I am done looking"
```

Nothing else. See the placement constraint above for why that list is short.

**Layout must not assume its container.** Four columns side by side when there is room; below
roughly 900px of *the board's own width* they stack vertically, each keeping its heading. Prefer a
container query over a viewport media query — the board may end up in a panel far narrower than the
viewport, and a viewport query would lay it out for a width it does not have.

### S4.2b — Popping it open

In `/write`, the board opens as a panel and closes back to the editor. A `[▦ Board]` control in the
page head opens it; `Escape` and a visible close control both dismiss it.

**Not a tab.** Tabs are for surfaces you go to and stay in; this is one you glance at. It should
feel like opening a drawer and shutting it, and the editor's in-progress body must be exactly where
it was afterwards — that property is already specced from sprint 2 and applies here too.

Whether the panel overlays the workspace or displaces the side panes is an implementation call;
overlay is the safer default because it cannot reflow the editor underneath.

Clicking a card emits `opened`, and `/write` loads it in the editor and closes the panel — glance,
pick, back to writing.

**Do not build a `/board` route this sprint.** The component is built so one is cheap later; adding
it now would mean maintaining two entry points before anyone knows the panel is insufficient.

### S4.3 — Moving a card

Drag and drop between columns, **plus** a keyboard-accessible path — a "Move to…" control on each
card. The keyboard path is not optional and not a follow-up: a board you can only use with a mouse
is a board half the users cannot use at all.

Rules:

- Dropping into Scheduled is **refused**, with an explanation: a draft becomes scheduled by being
  scheduled (the publish wizard's last step, or `/drafts`' park action), not by being dragged.
  Dragging *out* of Scheduled is refused for the same reason.
- Moving a card is instant and local. No request, no undo needed — the cost of a wrong move is one
  more move.
- The move is announced for screen readers (`role="status"`), because a silent visual change is
  invisible to exactly the users who most need the keyboard path.

### S4.4 — Column counts and empties

A count per column heading. An empty column keeps its heading and gets one line saying what belongs
there — an unexplained empty column reads as broken, and this is the only place the four columns'
meanings are ever stated.

### S4.5 — Coverage

- `columnFor`: a scheduled-kind draft ignores a conflicting stored column; an untriaged draft is
  Ideas; a stored column is honoured.
- `groupByColumn`: order within a column, and that every item lands in exactly one.
- Moving writes the sidecar and survives a reload; moving into or out of Scheduled is refused.
- The keyboard "Move to…" path produces the same result as a drop.
- Clicking a card opens it in the editor under the sprint-1 load rule — assert the source survives
  for a non-local kind.
- Opening and closing the panel does not disturb an in-progress body (the sprint-2 property,
  and the thing most likely to break here).
- `Escape` and the close control both dismiss the panel.
- Anonymous: the board works and issues no requests.
- **The board renders standalone.** A spec that mounts `<app-write-board>` on its own with a
  handful of items, asserts the columns and cards, and never touches `WritePage`. That test is the
  thing that keeps the "extract to its own screen" option genuinely open — if it needs the page to
  exist, the boundary has already leaked.

## Traps

Every one of these has been hit for real in this epic:

- **`npm run test:ci` only**; `-- --update` after adding or renaming specs. **Never format and test
  in one shell invocation.**
- `as Status` on a partial fixture fails the build (`TS2352`) — use `as unknown as Status`.
- `httpMock.verify()` does not prove "this issued no requests of its own"; two services already
  scan `/accounts/:id/statuses` on this page. Use the spec's `flushStatusScans()` helper, and
  assert `httpMock.match((r) => r.method === 'POST')` is empty to prove nothing published.
- `ngModel` writes asynchronously — assert on the bound signal, not on `.value`.
- `ClientPrefs` persists through a constructor effect; never call `persist()` yourself.
- A11y lint rejects `(keydown)` on non-focusable elements and click handlers without keyboard
  equivalents. **Drag-and-drop will attract both** — build the keyboard path first and the pointer
  path on top of it.
- Anything rendered through `[innerHTML]` must be escaped first; nothing on this page is
  server-sanitized. (Sprint 3's preview is the reference.)
- Do not add `ad-*` class names. Never say "X" — it is Twitter.

## Definition of done

`npm run lint`, `npm run format:check`, `npm run test:ci`, `npm run build`,
`npm run build:mockingbird` all pass. Append **Delivered** and **Found while implementing**
sections. Sprint 5 (Gist + deeper Mataroa) is written after this lands.

---

## Delivered

### New files

| File | What it is |
| --- | --- |
| `pages/write/board/board-columns.ts` (+spec) | The pure model: `columnFor`, `groupByColumn`, labels and hints. |
| `pages/write/board/write-board.{ts,html,css}` (+spec) | `<app-write-board>` — the board itself, standalone. |

### Changed

- `pages/write/write-page.{ts,html,css}` — a `[▦ Board]` control in the page head, `boardOpen`,
  `openFromBoard()`, and the overlay panel that hosts the component.

### The placement constraint, honoured

The board's contract with the outside world is four members and nothing else:

```ts
readonly items = input.required<readonly DraftItem[]>();
readonly currentKey = input<string | null>(null);
readonly opened = output<DraftItem>();
readonly closed = output<void>();
```

It injects `WriteWorkspace` and nothing else. **Its spec mounts it standalone, with no `WritePage`
in the TestBed at all** — twelve tests that would fail the moment the boundary leaked. Moving it to
`/board` later is: add a route, pass it `DraftSources.items()`.

Its CSS uses `container-type: inline-size` and a `@container (max-width: 900px)` query rather than a
viewport media query, so it lays itself out against **its own** width. That is what makes "narrow
side panel" and "full-width route" the same code.

### Decisions taken while building

- **A panel, not a third tab.** Tabs are for surfaces you go to and stay in; the board is one you
  glance at on the way back to writing. It overlays rather than displacing the panes, which is also
  what guarantees the editor underneath is never torn down.
- **`move()` is the single mutation point**, and drag-and-drop calls it. The keyboard menu was
  built first and the pointer path on top, so the two cannot disagree — there is a spec asserting a
  drop lands where the menu would.
- **Scheduled refuses moves in both directions.** In, because a draft becomes scheduled by being
  scheduled. Out, because dragging a card out of Scheduled would claim to cancel a publish it has
  not cancelled. Both refusals are announced rather than silent.
- **A stored `scheduled` on a non-scheduled draft is ignored** rather than honoured. Otherwise a
  card written by some future bug would strand in a column it can never legitimately leave.

## Found while implementing

**A11y lint did not flag the drag handlers, and that is not the same as them being fine.** The
sprint spec predicted lint would object to `(dragover)`/`(drop)` on a non-interactive element; it
didn't. The keyboard path was built first anyway, on the reasoning that the rule matters whether or
not the linter enforces it — and it is the path the specs exercise, since jsdom has no real drag.

**`vi.fn()` rather than `() => {}` for a stubbed `preventDefault`.** The empty-function lint rule
rejects the latter, and the mock is better anyway: `onDrop` must call `preventDefault` or the
browser treats the drop as rejected, so the spec now asserts it does.

**The four column meanings are written down in exactly one place** (`columnHint`), and it is the
empty state. That was not the plan — the plan was a doc comment — but an empty column with no
explanation reads as broken, and the only honest fix put the definitions on screen. They are now
the same strings the spec asserts against.

## Verification

- `npm run lint`, `npm run format:check` — pass.
- `npm run test:ci` — **3653 tests pass, 0 fail** (32 added this sprint). Manifest updated.
- `npm run build`, `npm run build:mockingbird` — pass; only the two pre-existing budget warnings.

## Carried forward

- **The notes list is still not extracted.** This sprint was the natural moment to pair it with the
  board and it was left alone to keep the diff honest to one feature. It remains sprint 2's debt —
  see that file's Carried forward.
- **`/board` does not exist.** Deliberately: the component is built so adding it is cheap, and
  nobody yet knows whether the panel is insufficient. Decide from use, not in advance.
- **Not smoke-tested against a live account**, so the Scheduled column has never been seen holding a
  genuinely parked post from a real server.
- **Drag-and-drop is untested in a real browser.** jsdom has no drag implementation, so the specs
  drive `onDragStart`/`onDrop` directly. The pointer path needs one pass by hand.
