# Sprint 4 — Search helper

**Goal:** a button on the search page that turns prose into a runnable Mastodon query.
You describe what you're after in a sentence; you get five candidate queries, the app finds
the first one that actually returns results, and you edit it before it runs.

## The grading algorithm (changed by Matthew, 2026-07-28)

The original plan graded all five suggestions, then refined if too many came back thin.
That is five API calls, every time, and "be API-call efficient" is the standing vibe
everywhere else in this codebase — the whole of `sprint/search-3-budget-and-pagination.md`
exists for it.

**New rule: try the queries in order and stop at the first one that succeeds.**

```
for each query, most-likely first:
    count = search(query)          # 1 API call
    if count >= 5: stop — this is the answer
if nothing cleared 5: ask the model once more, with the counts as feedback
```

| | Old | New |
|---|---|---|
| Best case | 5 calls | **1 call** |
| Worst case | 5 calls, then 5 more after refining | 5, then up to 5 |
| Typical | 5 | 1–2 |

This works precisely *because* the prompt already orders suggestions "most to least likely to
be what they meant" (sprint 3). Walking that ordering and stopping early means the first
query that works is also the most specific one that works — which is the one you wanted.
Ordering was decorative before; now it is load-bearing, and the prompt says so.

The refine pass is unchanged in spirit and now has a sharper trigger: **it fires only when
all five queries failed**, which is the case where the model genuinely misunderstood.

## Authenticated only, and this is not a limitation we invented

The DSL (`from:`, `has:media`, `-is:reply`, …) is a *server-side* full-text feature.
mastodon.social nerfs anonymous full-text search, which is why anonymous post search in this
app is a hashtag transform (`searchPostsByHashtags`) rather than a query — see
`sprint/search-0-overview.md`. Suggesting `from:@someone@example.social` to an anonymous user
would produce a query they cannot run.

So the helper button appears only when **OpenRouter is connected AND the user is
authenticated**. Per decision 9 it is hidden, not disabled-with-an-upsell, in both cases.

## Budget: the helper's calls are counted separately

The page's API budget (`callsUsed` / `apiBudget`) governs *one search's pagination* and is
displayed as "2 of 3 API calls used". Folding probe calls into that counter would make the
number mean two things at once.

The helper reports its own cost in the dialog ("found on the 2nd query — 2 searches"), and is
bounded by construction: at most five probes per pass, two passes. Worth revisiting if the
helper ever gets used mid-pagination, but with a typical cost of one call it is not worth
coupling the two counters today.

## Deliverables

1. **`pages/search/search-helper.ts`** (+ spec) — the pure core:
   - `SEARCH_SUCCESS_THRESHOLD = 5`, `SEARCH_QUERY_COUNT = 5`
   - `gradeUntilSuccess(queries, run, opts)` → `{ attempts, winner, callsUsed }`, walking in
     order and short-circuiting.
   - `describeAttempts(attempts, threshold)` → the `{{feedback}}` text for the refine pass.
   Both pure and heavily tested; `run` is injected so the spec never touches HTTP.
2. **`SearchHelper` service** — orchestration: propose → grade → (only if nothing cleared)
   refine → grade. Probes with `limit: 5`, because "did it return five?" is the only question
   being asked and a bigger page is wasted bytes.
3. **`pages/search/search-helper-dialog/`** — prose input, per-query outcome list, the winner
   pre-filled into an editable textarea, and **Use search**. The user always edits before
   running: the model proposes, it never acts.
4. **`search.ts` / `search.html`** — the 🤖 button next to the search box, and wiring
   "Use search" into the existing query box + submit path.

## Acceptance

- Full gate green.
- A first-query success costs exactly one probe (asserted, not eyeballed).
- All-five-fail triggers exactly one refine, and a second failure gives up gracefully rather
  than looping.
- The button is absent when OpenRouter is disconnected, and absent for Anonymous.
- "Use search" fills the query box and runs the normal search path — no bypass.

## Verified at runtime

20 browser checks with OpenRouter stubbed at the network layer and the Mastodon searches
real, so the grading loop is genuinely exercised. The server log is the proof:

```
first-suggestion-works scenario:
  GET /api/v2/search?q=a&type=statuses&limit=5        <- the one probe
  GET /api/v2/search?q=a&type=statuses&limit=40       <- the real search, after "Use search"

all-fail scenario:
  GET .../q=zzzznope1&limit=5   .../q=zzzznope2&limit=5   .../q=zzzznope3&limit=5
  GET .../q=zzzzalso1&limit=5   .../q=zzzzalso2&limit=5   <- one refine pass, then stop
```

Also confirmed: the button is absent when disconnected; exactly one refine round trip fires
and no more; the refine prompt carries the per-query counts and the "too narrow" framing; a
best guess is still offered when everything fails; Escape closes the dialog.

## Deviations from the plan as written

- **The dialog lists every attempt as a clickable candidate**, not just the winner. The
  winner is the app's opinion; picking a "worse" query that returned two good results is a
  legitimate choice and costs nothing to allow.
- **A failed probe records `count: null` and the walk continues.** One flaky request should
  not discard four good candidates, and "the search failed" is honest where "0 results" would
  be a lie.
- **The backdrop is a `<button>`, not a `<div>`.** Click-away must be reachable by keyboard;
  the lint rule caught it, and `Escape` closes too.

## Explicitly deferred

- Saving a generated query as a saved search (that machinery exists; wiring is its own call).
- Explaining *why* a query was suggested.
- Anonymous support, pending a hashtag-shaped variant of the whole idea.
