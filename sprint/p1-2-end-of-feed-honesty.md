# P1 Sprint 2 — The feed says why it ended

Status: **DONE** (2026-08-29)

Second of three. Follows [[p1-1-people-paging]]; Sprint 3 is the bookmark button
pair. Closes the reporting half of **A62**, and the Feed Doctor complaint behind it.
Same constraints: no layout work, no Playwright, vitest only.

## The complaint

> "Bug where feed says oh n posts filtered and then the feed stops altogether. But
> other times the feed keeps going. And feed doctor never says why a feed ended."
> — `MockingBird.md:406`

> "I was hoping feed doctor to explain this, but feed doctor ended up only saying
> 'well, no single person is flooding your feed' and stuff like that. It never
> successfully diagnosis why a feed ended."

The second quote is the specific, reproducible failure, and it had a specific cause.

## Why the Doctor could not answer

`diagnoseEnding` exists and is good. It consumes `SourceOutcome[]`, which is produced
**only by `anonymous-mastodon-provider.ts`** — the anonymous stitched-timeline path that
reads each follow separately and therefore knows which follow went quiet.

A signed-in reader's Home comes from `FeedAggregator`, which has no per-follow reads and
no `ending` concept. `feed-doctor-page.ts` passed `outcomes: []` for that path, with an
honest comment saying the verdict was "omitted rather than faked". `diagnoseFeed` then
skipped `diagnoseEnding` entirely, leaving flooding + sources + timespans + mixing — none
of which is about why the feed stopped. Hence the exact sentence the boss kept getting.

The omission was individually correct at every step and collectively produced a page that
could not do its job.

## The insight

"Which follow went quiet" is not the reader's question. **"Why did this stop"** is, and
its answer does not need per-follow data at all — it needs the list of things that bound
a feed. There are seven, and *none* of them announced itself:

| # | Mechanism | Where | Before |
|---|---|---|---|
| 1 | `homeWindow` time cutoff | `feed-aggregator.ts` `withinWindow` | counted, shown at end-of-feed only |
| 2 | `feedMax` trim | `home.ts` `mergeStatuses` | warn log |
| 3 | Cap + 60-min cooldown | `capActive` | message, but silently kills "Load more" |
| 4 | **Calm mode** | `applyTimelineFilters` | **nothing** |
| 5 | **Language filter** | `feedLangFilter.shouldShow` | **nothing** |
| 6 | Boosts/Replies chips | `hiddenByFilters` | counted + one-click undo |
| 7 | All-sources-hidden | `isProviderVisible` | warn log |

Row 6 was already right, and became the template for the rest: count what you hid, name
the number, offer the undo.

## What changed

### The bug found on the way

Home's empty state ran `@else if (!visible().length)` → *"Find friends to follow →"*.
`visible()` is the **filtered** list. So Calm hiding every fetched post told a reader with
thousands of follows that they were not following anyone, and sent them to `/find-friends`
to fix something that was not broken. This is the same class as A58's "End of the list" and
is arguably worse.

Now `allHiddenByFilters()` (`statuses().length > 0 && visible().length === 0`) takes
priority and renders *"3 posts loaded, and your filters are hiding them all"* with the
matching undo. The follows-are-empty state still exists for the case that actually is that.

### `feed-doctor.ts` — new `diagnoseStopped`

Takes a `FeedBounds` and returns a `stopped` verdict. Reports every applicable mechanism,
and **ranks the headline** by how completely each bounds the feed: cooldown (stops paging
outright) → window (stops it at a date) → filters (only thin what already arrived). A
reader stopped by the cooldown does not need to hear about their language filter first,
but both still appear in `detail`.

With nothing bounding the feed it distinguishes two green answers — *"every source ran
out"* vs *"nothing is limiting your feed"*. Only one means more will arrive.

`bounds` is optional on `DiagnoseOptions`, so a caller with nothing to report still gets no
verdict rather than a fake reassuring one — matching the module's existing discipline.

### `feed-doctor-page.ts` — both paths supply bounds

Computed from **the page's own sample**, not read off Home: the Doctor is reachable without
Home being open, and reporting whatever feed someone last scrolled would be worse than
measuring fresh. Each filter is counted against posts the *others* would have shown, so the
numbers do not overlap into a total larger than the feed.

Two honest zeroes, both commented in place: `hiddenByChips` (Home's own view state, which
does not exist on this page) and `droppedByWindow` for anonymous (that feed applies no time
window at all — `JustMyServer` and `FeedAggregator` are the two that do).

`widen-window` and `show-calm` actions act and then **re-run the diagnosis**, so the page
cannot keep blaming a window the reader just widened.

### `home.ts` / `home.html` — Calm and language named

`hiddenByCalm()` and `hiddenByLanguage()` mirror `hiddenByFilters()` exactly. Calm gets a
one-click undo. **The language filter deliberately does not**: it is a multi-language
choice rather than a toggle, so "show the rest" would mean guessing which languages were
meant. It names the number and points at the picker, which is already in the filter bar at
the top of the same page.

## Tests

`feed-doctor.spec.ts` (+7) — Calm named; window named with its action; cooldown leads when
several bound at once while all three still appear in `detail`; exhausted vs unfiltered;
counts reported as given; `diagnoseFeed` includes `stopped` with bounds and omits it
without.

`home.spec.ts` (+3) — the all-hidden state does **not** say "Find friends to follow"; the
partial case reaches the end-of-feed note and names Calm; an unfiltered feed still says
"You're all caught up".

| Gate | Result |
|---|---|
| `test:subset` — home, feed-doctor page, feed-doctor, feed-aggregator, algo | 135 passed |
| `tsc -p tsconfig.app.json` | clean |
| `npm run lint` | clean |

Full `make check` not run.

## For the next developer

**The cooldown is still silent in the one place it matters.** `diagnoseStopped` can report
it, but `feed-doctor-page.ts` passes `cooldownActive: false` — the cooldown lives in
Home's component state and resets on reload, so it genuinely is not in force by the time
the Doctor is open. **Sprint 3 owns this.** The boss's decision: keep the cooldown, add an
"ignore cooldown" setting for endurance doomscrolling, and give it *real friction* rather
than a relabelled button. When that setting exists, lift the cooldown state somewhere both
Home and the Doctor can read it, and pass the real values here.

**Anti-flood is explicitly on hold** — the boss has not decided its shape. Note it is a
*different* feature from the cooldown: anti-flood is "one person posts every 2 seconds",
cooldown is "you have been scrolling 2 hours". Do not conflate them; `diagnoseFlooding`
already covers the measurement side of the former.

**`feedMax` trim and all-sources-hidden are still log-only** (rows 2 and 7). Both are
plumbed into `FeedBounds` in shape but not in fact. Add them when someone hits one.

**Do not let `bounds` become mandatory.** Its optionality is what keeps the Doctor from
inventing verdicts, and that discipline is why this page is trusted where it is right.
