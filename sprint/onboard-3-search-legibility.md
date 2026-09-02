# Onboarding sprint 3 — Making search legible

Status: **COMPLETE** (2026-09-01). 15 tests added; `make test` green (5614 tests, 0 missing).

One planning assumption was corrected during implementation: 3.1's preferred option — "default to
Posts" — was rejected against `search-capability.ts`, which documents that Mastodon full-text post
search needs both an Elasticsearch index and a token, and is off *as the rule rather than the
exception* anonymously. Defaulting a first-time anonymous visitor into the one search that usually
returns nothing would be a worse first impression than the wrong-but-populated list they get now.
Shipped option 2 alone: infer from the query's shape where it is unambiguous, leave the default
otherwise.

Also found while testing: gating the new result announcement on `searching` made it appear and then
blank, because `maybeAutoFill` pages again to build the facet corpus and re-sets that flag. It is
gated on having something true to say instead.

Search is the app's strongest surface and its worst first impression. Four separate problems, all
in `pages/search/`.

---

## 3.1 — Search defaults to Accounts for no reason

**Now:** `pages/search/search.ts:652` — `protected type = signal<SearchType>('accounts')`. A
visitor who types a topic into the search box gets a list of *people* whose profiles match, which
is a plausible answer to a question nobody asked. There is no signal that they wanted accounts;
`accounts` is simply first in the union type.

**Change:** pick a default that is right more often, or refuse to guess.

Three candidates, in order of preference:

1. **Default to Posts.** A typed phrase is far more often a topic than a person. The catch is
   `typeUnavailable` (`search.ts:806`): `statuses` requires `this.session.linked()` on Bluesky, and
   Mastodon full-text post search is server-dependent — `search-capability.ts` already probes for
   this. So "default to posts" must mean "default to posts *where posts are searchable*, and to
   accounts otherwise," with the fallback visible rather than silent.
2. **Infer from the query.** `@name` and `name@host` are unambiguously account searches;
   `#tag` is unambiguously a hashtag search; `tagCandidate()` (`search.ts:511`) already does
   part of this work. Everything else is a topic. This is cheap, correct most of the time, and
   explainable in one line under the box.
3. **Search across all three and group the results.** Best answer, most work, and it multiplies
   API calls against a budget the code already tracks (`callsUsed()`). Note it as the eventual
   destination; do not build it this sprint.

Prefer 2 layered over 1: infer where the query is unambiguous, otherwise posts-where-possible.
Whatever is chosen, **say so where the user can see it** — the type select should visibly move to
the inferred value, so the inference is a suggestion they can override rather than a mystery.

## 3.2 — On a phone, a completed search looks like nothing happened

**Now:** `search.css:19` lays the page out as `grid-template-columns: 360px minmax(0, 1fr)` — form
and facets left, results right. At `max-width: 800px` (`search.css:45`) that collapses to a single
column. The DOM order puts `.search-form-box` **before** `.search-results-box`, so on a phone the
entire form-and-facet stack sits above the results. Submit a search and the visible viewport
changes only by the facets that appeared — the results are a full screen further down. The user
concludes nothing happened.

**Change:** two parts, both needed.

- **Announce the result.** A results header stating what was found — "42 posts" — placed
  immediately above the results and, on a narrow viewport, above the facets. The count is
  available (`shownCount()`, `loadedCount()`, used at `search.html:824`); it is just not where a
  phone user looks. Make it an `aria-live="polite"` region so screen readers get the same news.
- **Reorder or scroll on narrow viewports.** Either put results first in the collapsed layout
  (CSS `order`, or reorder the DOM and let the desktop grid place them), or scroll the results
  into view on completion. Reordering is the better fix: scrolling fights the user if they are
  mid-gesture.

Check `search.html:1227` (`type() !== 'accounts' && !results() && searching()`) — the in-flight
state exists but only for non-account searches. Account searches get no pending state at all.

## 3.3 — Facets cannot be collapsed

**Now:** `search.html:727` wraps the facets in `<details class="refine-facets" [open]="refineOpen()">`
— so *the facet block as a whole* already collapses. What does not collapse is everything above it
in the sticky form column: the query box, the type select, the account-source controls, the numeric
facet grid (`.num-facet-grid`, `search.html:562`, three `.num-facet` blocks), the refine bar with
filter/group/sort. On a phone all of that is stacked ahead of the results.

**Change:** the boss's note said "not a lot of good options," and that is fair. The realistic move
is to make the *whole refinement column* one collapsible unit on narrow viewports — collapsed by
default once results exist, with a summary line naming any active refinements ("3 filters") so a
collapsed state is never a hidden state. Desktop keeps the sticky column as-is; it works there.

This is mostly the same work as 3.2's reorder. Do them together.

## 3.4 — Starter packs are not searchable

**Now:** starter kits and bundled collections live at `/bundled-starter-kits` and
`/bundled-collections`, reachable only from the two-row `/find-friends` menu. `SearchType` is
`'accounts' | 'statuses' | 'hashtags'`; there is no way to find a kit by name, from the search page
or anywhere else. Once a new user has left the kits screen, kits are effectively gone —
which is the boss's separate "starter kits are hard to find afterwards" note, and it has the same
root cause.

**Change:** make kits and collections findable by name. Two independent pieces:

- **A search surface.** Either a fourth type in the select, or — cheaper and probably better —
  a "Starter kits matching *query*" block above account results, since kit names and topics overlap
  heavily with what people type into an account search. `bundled-starter-kits.generated.ts` is a
  local, static corpus, so this costs no API calls and can be matched client-side.
- **A persistent way back.** `/find-friends` is in the shell menu (`shell.html:321`), buried among
  ~20 items. Consider promoting it, or the merged discovery surface from
  [[onboard-4-discovery-and-brand]], to the main nav for accounts with few follows.

Coordinate with sprint 4: that sprint merges the two surfaces, so build the search against the
merged concept if the ordering allows, or against both corpora if not.

---

## Definition of done

- Typing a topic into search returns topical results, or explains why it cannot.
- On a 390px viewport, completing a search visibly changes what is on screen, and the count is
  announced.
- Refinement controls can be collapsed on a phone, and a collapsed state names what is active.
- A starter kit can be found by typing its name.
- `cd ui && make test` green.
