# Write — Sprint 4: the kanban board

Status: PLANNED (written 2026-08-08, after sprints 1–3 shipped)

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
- **The tab pattern** from sprint 2: `tab()` is `'write' | 'notes'`, and the inactive surface is
  hidden with `.hidden-tab { display: none }` rather than `@if`-ed away, so an in-progress body
  survives a tab switch. **The board is a third tab and must do the same.**

## Stories

### S4.1 — The column model

A pure module (`pages/write/board.ts`) with its own spec:

- `columnFor(item, meta)` — the derivation. A `scheduled`-kind draft is always `scheduled`,
  whatever the sidecar says; everything else takes its stored column, defaulting to **Ideas**.
- `groupByColumn(items, workspace)` — items bucketed in column order, each bucket newest-first.

Default to Ideas rather than Writing: a draft nobody has triaged has not been started, and the
board's job is to make untouched work visible rather than to flatter it.

### S4.2 — The board tab

A third tab beside Editor and Notes. Four columns, each a scrollable list of compact cards showing
the preview, the kind badge, and the age.

Clicking a card opens it in the editor and switches to the Editor tab — that is the whole point of
having a board inside the workspace rather than beside it.

Below ~900px the columns stack vertically with their headings, rather than becoming a horizontal
scroll nobody discovers.

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
- Switching to the board and back does not disturb an in-progress body (the sprint-2 property).
- Anonymous: the board works and issues no requests.

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
