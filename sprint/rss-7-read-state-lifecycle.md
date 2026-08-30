# RSS Sprint 7 — Read-state lifecycle and read-later

Status: **DONE** (2026-08-29). Parts 1, 2 and 3 shipped; Part 4 is a doc note.

Written first as a plan, then executed in the same session — so the plan below stands as
written and the outcome of each part is recorded inline.

Follows [[rss-0-overview]] (Sprints 1–4) and the second wave ([[rss-5-paste-any-url]],
[[rss-6-share-any-ecosystem]]). This is the third wave, and it is the "RSS/read-later
epic" line item from `mockingbird_remaining_work.md` P1 — the part the audit lists as
missing while noting core RSS is Done (A31, A34, A42, A45, B61, C58).

Constraints inherited from the P1 sprints ([[p1-0-overview]]): **no layout work, nothing
requiring Playwright or eyeballs.** Vitest only.

## What the audit asked for, and what is actually left

The audit bundles six things under one bullet. They are not one sprint, and two of them
are already effectively done:

| Ask | Reality |
|---|---|
| Feed discovery/search | **Done** — Sprint 5 shipped paste-any-URL; `rss-discovery.ts` resolves a site to its feeds |
| Friend-shared synthetic feeds | **Done** — synthetic profiles exist (`B69`), audit says so itself |
| Comments on articles | **Undecided** — needs a product call before any code |
| **90-day read-state cleanup** | **Not done.** Well specified. This sprint. |
| **Multi-link article selection** | **Not done.** Needs a design pass. |
| **Hostile-page policy** | **Partly done** — `preview-card.ts` and `thread.ts` already handle paywalls/bot-checks; needs a stated policy, not new code |
| **Annotation / read-later scope** | **Not done.** Needs scoping before building. |

So the sprint is: **do the prune, decide the other three.** Do not attempt all six.

## Outcome

| Part | Result |
|---|---|
| 1. 90-day prune | **Built.** `pruneReadMap` + startup prune + count cap. |
| 2. Multi-link selection | **Built**, and re-specified by the boss — see below. |
| 3. Read-later | **Decided and shipped as a rename.** Starred *is* read-later. |
| 4. Hostile-page policy | Left as-is; the behaviour already exists. |

Full suite after: **5504 tests, 0 failures**, coverage up on all four measures.

## Part 1 — The 90-day prune — BUILT

The previous sprint left this deliberately ready. From `rss-read-state.ts`:

> "A timestamp rather than a bare id set, even though nothing reads the value yet: the
> 90-day wipe on the roadmap needs something to prune against, and retrofitting a
> timestamp onto an id-only store later is a migration on data that lives in other
> people's browsers."

Everything needed is in place, which makes this a small, high-confidence change.

**The rule that must not be broken**, also already documented in that file:

> "each can be pruned on its own schedule (read state ages out; a star is a deliberate
> act and should not)."

**Prune read state. Never prune stars.** A star is the user saying "keep this"; ageing it
out silently deletes something they asked to keep. If a starred item's read entry is
pruned it simply becomes unread-and-starred, which is harmless and correct.

### Shape

- Prune entries in `readMap` older than **90 days**. Leave `starMap` entirely alone.
- Run it **on service construction**, once per session. Not on a timer, not on every
  write: the store is read at startup anyway, so this is free there and intrusive
  anywhere else.
- **Also cap by count.** Time alone does not bound a heavy reader — someone reading 300
  items a day accrues ~27,000 entries inside the window. Keep the newest N (suggest
  20,000) after the age prune. `localStorage` has a ~5MB budget shared with every other
  key in `storage-registry.ts`, and blowing it breaks unrelated features.
- Report what was dropped through `HomeDiagnostics`, so Storage Diagnostics can show it.

### Tests

Pure-function prune (`pruneReadMap(map, now, maxAge, maxEntries)`) so it tests without
Angular DI — same reasoning as `people-cursor.ts` in [[p1-1-people-paging]], and the same
payoff: a bare `vitest run` on the spec, no jsdom realm needed.

Cover: an old entry goes; a recent one stays; an entry exactly at the boundary (pick a
side and assert it); the count cap keeps the newest; **stars survive a prune that removes
their read entry**; a corrupt store still loads (already handled by `load()`, assert it
stays handled).

### What shipped

`pruneReadMap(map, now, maxAge, maxEntries)` — pure and exported, plus `READ_MAX_AGE_MS`
(90 days) and `READ_MAX_ENTRIES` (20,000). Runs once in the constructor, which for a
root-provided service is once per session; `prunedOnLoad` reports what went, because
silent maintenance nobody can observe is indistinguishable from maintenance that is not
running.

The boundary is inclusive — a mark *exactly* 90 days old is kept, since the rule is
"older than 90 days" — and that is asserted so the inequality cannot be flipped later by
accident. A healthy store returns the identical object rather than a copy, so startup does
not rewrite `localStorage` for nothing.

**One pre-existing test had to change.** `drops non-numeric entries but keeps the rest of
the store` seeded a timestamp of `5` — epoch 1970, which the new prune correctly discards
as ancient. The test is about the non-numeric filter, not about ageing, so its fixture now
uses `Date.now()`. Worth knowing: a token timestamp in any other spec will now age out.

## Part 2 — Multi-feed selection — BUILT

The plan here was half-right and the boss re-specified it, correctly:

> "if there is one good RSS feed, but often pages have like, here are 10 rss feeds, a
> comment feed for each, feeds in rss/atom/etc so there could be more than 1. […] if
> they're the same thing, but 1 is atom, one is rss, then we should just pick the more
> expressive one. If the feeds offered on a page are like, politics, books or comics,
> then the user needs to pick."

That is **two cases that look identical in the markup**, and the distinction is the whole
feature:

1. **Same content, different format** — `/feed/` beside `/feed/atom/`. Asking which one
   somebody wants is asking them a question about serialisation formats. They have no
   opinion, and both answers give the identical reading experience. **Decide it for them.**
2. **Different content** — Politics, Books, Comics. **Must ask.** Picking one is picking
   what they read, and no heuristic knows which section they came for.

`rankFeeds` already existed and already handled comments/category demotion — the audit's
"not done" was wrong about that. What was missing was case 1, so `feedLinksIn` now carries
the declared `type` through (it was being discarded) and `collapseFormats` groups by a
**content key**: the URL with format-only parts stripped — `/feed/atom/` → `/feed/`,
`index.rss` → `index`, `?feed=atom` dropped. Crucially `?cat=politics` is *kept*, because
that is content, not serialisation.

Within a group the more expressive format wins. **Atom over RSS is not a style
preference:** Atom mandates a globally unique `<id>`, a real RFC-3339 `<updated>`, and
distinguishes `<summary>` from `<content>` — and this app uses all three (dedupe keys off
the id, ordering off the date, the reader shows content where it exists). RSS 2.0 makes
`guid` optional, its RFC-822 dates are widely malformed, and its one body element means
different things per publisher.

Ranking runs *first*, then the collapse, which preserves order: ranking decides which
content wins, the collapse only decides which *format* of a given content survives. A site
with three sections in two formats each goes from six options to a clean three-way choice.

`paste-resolve.ts` wires it in, so the existing "exactly one feed → subscribe immediately"
path now fires for a site publishing one feed in three formats — which previously forced a
pointless pick.

## Part 3 — Read-later — DECIDED: it is Starred, renamed

**The boss's call, asked before building:** option 1. Starred *is* read-later.

That is the right answer and it is worth recording why, because the instinct is to build
the bigger thing. Starred was already a complete feature — its own store, its own filter
tab, a per-item toggle, its own empty state. A second "save this" gesture beside it would
have been two affordances doing one job, and the user then has to learn which is which.

So this is a **copy change only**:

| Was | Now |
|---|---|
| `Starred` filter tab | `Read later` |
| `☆ Star` / `★ Starred` | `☆ Read later` / `★ Saved` |
| "Nothing starred here yet." | "Nothing saved for later yet." |
| `Star <title>` (aria) | `Save <title> to read later` |

**The internal id stays `starred` and the storage key stays
`mockingbird_rss_starred`.** Renaming a persisted key throws away everybody's saved items
to change a label. A test asserts the new copy *and* the old key together, so a later
tidy-up that renames the key has to fail that test first.

"Read later" over "Starred" for the same reason the P1 sprints kept naming things: a star
is a symbol every app defines differently, while "read later" says what the list is for.

### The original decision, kept for context

**This needs a product decision before any code**, and it is the item most likely to
sprawl. The honest question: *how is read-later different from starred?*

Today `RssReadState` already has starred, with its own filter. A separate read-later
store risks being a second name for the same gesture, and two overlapping "save this"
affordances is worse than one.

Three options, smallest first:

1. **Rename and stop.** Starred *is* read-later. Zero code, and possibly correct.
2. **Add a second flag** (`later`) alongside `starred`, with its own filter. Cheap — the
   file's two-flat-maps design accommodates it exactly as written. Justified only if
   "keep forever" and "get back to this soon" are genuinely different in the boss's
   reading.
3. **Full read-later with annotations** — highlights, notes per article, persistence,
   export. This is a large feature that touches the article view, storage registry,
   settings export, and the PKM lifecycle. **Not a sprint. An epic.**

**Recommendation: ask before building.** If the answer is (1) or (2) this is an afternoon.
If it is (3) it needs its own overview doc and probably three sprints. Note that A34 and
B61 both mention annotation, which is a hint the intent is (3) — but the audit also says
PKM lifecycle needs "a smaller shippable lifecycle" specified first, and the same warning
applies here.

## Part 4 — Hostile-page policy — NO CODE, deliberately

`preview-card.ts` already documents that extraction fails on "paywalls, bot checks,
consent walls", and `thread.ts` has user-facing copy for the paywall case. The behaviour
exists; what does not exist is a stated policy saying it is deliberate.

**The policy, stated:** a page that refuses to be read is not an error condition. Paywalls,
bot checks and consent walls are the publisher's decision, and the app's job is to say so
plainly and stop — not to retry, not to work around it, and not to present the refusal as
our failure. `thread.ts` already says "This publisher asks for a subscription, so only the
opening is readable here", which is exactly right.

No code was written. A45 closes on the strength of behaviour that already exists, and this
paragraph is the record that it is deliberate. This mirrors the P1 finding that several
"missing" audit items were already built — worth checking before building.

## What is still open

- **Comments on articles** — still undecided, still needs a product call. Untouched.
- **Annotations** (the big read-later, option 3 above) — explicitly *not* chosen. If it
  ever comes back it needs its own overview doc and two to three sprints, and the audit's
  own warning about PKM applies: specify a smaller shippable lifecycle first.

## Traps

**Account scoping.** `RssReadState` keys are `scopedKey(...)` — account-suffixed. A prune
must operate on the *current* account's keys only, and must not iterate all of
`localStorage` looking for `mockingbird_rss_read*`, which would prune a different logged-in
account's history.

**The storage registry gate.** Any new key needs an entry in `storage-registry.ts` or
`npm run check:storage` fails. Read state is `private` sensitivity (it discloses what you
read), not `cache` — it is not refetchable.

**Test-suite traps**, both of which cost real time in the P1 sprints ([[p1-3-bookmark-buttons]]):
spec files share one jsdom realm, so every `describe` needs `TestBed.resetTestingModule()`
in its `beforeEach`; and root-provided singletons keep state between tests, so seed
`localStorage` rather than expecting a fresh service.

**Do not touch stars.** Stated twice in `rss-read-state.ts`, restated twice here, because
it is the one change in this sprint that silently destroys user data if got wrong.
