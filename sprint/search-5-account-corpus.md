# Search Sprint 5 — Searching one account's posts

Status: **PLANNED** (written 2026-08-23, not started)

Deferred deliberately from the search-fixes batch, on the reader's own call:

> "Client side search from the search page of a given user is out of your scope,
> except for writing up a plan."

## The symptom

> "Why is post search so bad? For example `from:user` might return just two! But
> profile feed has lots!"

This is real and it is not a bug in the query builder. `from:` is serialized
correctly and sent correctly. The server answers honestly. The answer is just
nearly empty.

## Why

Post search and the profile feed read **different data stores**.

| | Endpoint | What it holds |
|---|---|---|
| Post search | `/api/v2/search?type=statuses` | The instance's full-text **index** |
| Profile feed | `/api/v1/accounts/:id/statuses` | That account's **actual posts** |

Mastodon's full-text index is not a copy of the fediverse. Without ElasticSearch
configured, most instances index only a narrow slice — commonly just posts the
viewer wrote or interacted with. Even *with* ElasticSearch, an instance indexes
what it has federated, which for a remote account is whatever happened to arrive.

So `from:@someone@elsewhere.social` searches an index that may contain two of
their posts, while `/accounts/:id/statuses` returns hundreds, because that call
is answered by the *origin* server's timeline.

`api.ts:495` is the search call. `api.ts:115` is the timeline call. Nothing in
between is wrong.

## The shape

The obvious move is to reroute `from:` queries to the timeline endpoint. **That
was proposed and rejected**, correctly:

> "No rerouting, don't like that."
>
> "We want to grab the relevant user's home timeline, transform the shape into
> the shape the search widget expects and let the search widget do its thing
> (facets, etc)."

The distinction matters and is the whole architecture of this sprint. Rerouting
forks the engine: a second code path, a second set of filters, a second place for
faceting to be subtly different. Instead:

**Fetch the account's posts, transform them into the corpus the search widget
already consumes, and let the existing widget do the rest.**

One search UI. One result pipeline. One faceting implementation. A different
*source* for the corpus — nothing else changes.

```
/api/v1/accounts/:id/statuses  ──►  Status[]  ──►  [same shape the search
   (paged, cursor, budgeted)                        results block already
                                                    renders and facets]
```

The search widget already refines client-side over a loaded corpus — that is what
`search-1-rich-object-and-refine.md` and `search-3-budget-and-pagination.md`
built, and why `callsUsed()` / `apiBudget()` exist. This sprint gives that
machinery a second way to be filled.

### Where the entry point goes

Profile already has a tab strip — `following / followers / collections /
analytics` (`profile.html:513-521`). Analytics is a tab, not a popup, and it does
exactly this kind of "spend API calls to build a local corpus, then analyze it"
work.

**A Search tab belongs there**, beside Analytics, for the same reason Analytics
is there. A dialog would be a second pattern for an operation the app already has
a pattern for.

### How deep to search

The original ask was a popup asking for 5 / 10 / 15 API calls up front. The app's
established answer is different and better, and it is `account-analytics`:

1. Load a cheap default sample immediately (`SAMPLE_SIZE`, ~100 posts).
2. State plainly what the sample is — *"Based on the last 100 posts, boosts
   excluded. The sample goes back 3 weeks."*
3. Offer to spend more, incrementally: **`Get more posts: +1 +5 +10`**, each
   labelled with its cost in API calls (`account-analytics.html:17-46`).

Results appear before any decision is required, and the reader spends more only
when the answer was not in the first hundred. Follow this exactly — same control,
same wording, ideally the same component.

`account-analytics.ts:123-170` is the reference implementation for the paging
itself: cursor via `maxId`, `hasMore`, `MAX_PAGES` ceiling, and a `getStatuses`
that already switches between the authenticated and anonymous-public paths.
Reuse it rather than writing a second pager.

### Matching

Plain `contains`, case-insensitive, over `stripHtml(status.content)` — plus
`spoiler_text`, which is where content warnings hide the words people search for.
`stripHtml` already exists in `sentiment.ts`.

Support `kw1 or kw2 or kw3` as the reader described. Bare spaces mean AND.

**Do not add a search library for this.** MiniSearch / Lunr / FlexSearch all
work, but they earn their keep at thousands of documents or when ranking and
stemming are needed. This corpus is 100–600 posts already in memory; `indexOf`
is imperceptible on it. The project has 11 runtime dependencies, all
load-bearing, and 30KB for a speedup nobody can perceive is a bad trade.

Keep the matcher behind one small function so that decision stays reversible. If
relevance *ordering* is wanted later, that is the moment to reconsider — it is
the one thing a real index gives that a scan does not.

## Scope

| In | Out |
|---|---|
| A Search tab on the profile | Any change to `/api/v2/search` behaviour |
| Corpus built from `/accounts/:id/statuses` | Rerouting `from:` on the search page |
| Reuse of the existing result/facet rendering | A second matching engine or search DSL |
| Incremental depth, analytics-style | A full-text index library |
| `or` between keywords; AND by default | Ranking, stemming, typo tolerance |

Explicitly **out**: touching the main search page's `from:` handling. The reader
ruled this out directly. A profile-scoped search is a different, honest thing —
"search *this account's* posts" — and it does not need to pretend to be the
global index.

## Open questions to settle first

1. **Does the corpus transform actually fit the existing widget, or does the
   results block assume `SearchResults`?** Check what the statuses result path
   consumes before committing to "let the widget do its thing" — if it is
   coupled to the API response shape rather than to `Status[]`, that decoupling
   is the first task and possibly most of the sprint.
2. **Boosts.** Analytics excludes them server-side (`excludeReblogs: true`).
   Searching someone's posts probably wants the same, but a reader looking for
   "that thing they shared" wants the opposite. Decide, and say which on screen.
3. **Anonymous mode.** `getStatuses` in analytics takes a `publicRef` for the
   anonymous path. Profile search must work there too; confirm the anonymous
   public client exposes the same paging.
4. **What happens with no query yet?** The tab could show the sample unfiltered
   (a plain feed, useless duplication of the profile) or an empty prompt. Prefer
   the prompt.

## Testing

Unit-testable, and most of the value is here: the matcher (`or`, AND, case, HTML
stripping, spoiler text), the paging arithmetic, `hasMore` at each boundary, and
that a `+N pages` click issues exactly N requests and no more. The budget
assertions matter — the failure mode of this feature is silently spending twenty
API calls on someone's behalf.

Not unit-testable: whether the tab feels fast enough to be worth the calls.

## Why this is a sprint and not a patch

The fetching is straightforward. The architectural work is the transform — making
the search widget's corpus come from somewhere other than a search response
without forking the widget. Done right, the app gains one reusable seam and every
future "search these posts" surface is cheap. Done as a shortcut, it becomes the
second search implementation, and the two drift.
