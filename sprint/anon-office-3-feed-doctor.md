# Anon Office — Sprint 3: Feed Doctor

Status: PLANNED. Roadmap: `anon-office-0-overview.md`.

## Three questions

Matthew's brief, verbatim: *who is flooding · why did my feed end · are the feeds mixing
nicely.* Those are diagnostic questions — each one has a verdict and an action, not a chart.
That is the whole distinction from `feed-analytics`, which stays exactly as it is:

| | `feed-analytics` (exists) | Feed Doctor (new) |
|---|---|---|
| Says | "Here is the composition." | "Here is what is wrong." |
| Output | Numbers and shares | A verdict, then a button |
| Silent when healthy | No — always renders | Mostly yes — ✓ and move on |

Decision 7: a new page at `/feed-doctor`, not a section bolted onto the analytics
component. Merging them would blunt both — descriptive stats want to show everything,
a diagnostic wants to show the one thing that is broken.

## The good news: the data already exists

Almost nothing here needs a new API call. That is the reason this sprint is last and also
the reason it is small.

**Who is flooding** — `feed-metrics.ts` already computes it. `feedAuthors()` (`:574`)
returns `AuthorRow[]` with counts *and shares*, and `ConcentrationRow` / `effectiveCategories()`
(`:419`, `:457`) already exist to express "how few accounts is this feed actually made of".
`BURST_WINDOW_MIN` / `BURST_MIN_POSTS` (`:410-412`) already define what a burst is. The
Doctor consumes `analyzeFeed()`; it does not recompute anything.

**Why did my feed end** — this is the one nobody has surfaced, and the data is *already
being produced and discarded*. `AnonymousMastodonProvider.fetchFollowFeedPage`
(`:308-345`) tracks `SourceCursor.exhausted` per follow and collects `warnings[]` for
sources that errored. The page returns `hasMore: false` when every cursor is exhausted —
so the app knows precisely why the feed stopped, and tells the user nothing. Three
distinguishable endings, currently rendered identically:

- Every source genuinely ran out of posts (rare, real).
- Sources *errored* — dead instance, blocked, rate-limited. `warnings` has the handles.
- A filter emptied the page: note line `:322`, `allowed.length !== statuses.length` marks a
  cursor exhausted when the filter (calm mode, local moderation, language) removed
  anything. A reader with an aggressive filter can end a feed they think is empty.

The third is the one that will surprise people, and it is invisible today.

**Are the feeds mixing** — `algo-feed.ts` already labels every post with an `AlgoSource`
(`mutual | boost | original | hashtag | rss`, plus `liked` from sprint 2). Composition by
source is a `groupBy` over data the feed already carries.

## `feed-doctor.ts` — pure verdicts

A pure module, in the house style (`clone-friends.ts`, `follow-quality.ts`): all the
judgement, no HTTP, fully testable.

```ts
export type Severity = 'ok' | 'notice' | 'warn';

export interface Verdict {
  id: 'flooding' | 'ended' | 'mixing';
  severity: Severity;
  /** One sentence, already phrased for a human. */
  headline: string;
  /** The evidence rows the page renders under it. */
  detail: VerdictDetail;
  /** Offered fixes. Never applied automatically. */
  actions: DoctorAction[];
}
```

Thresholds are **named constants with the reasoning attached**, same as
`ALGO_MAX_CALLS` and `CLONE_MAX_PAGES`. Starting values, to be tuned against a real
mastodon.social sample rather than defended in the abstract:

- `FLOOD_SHARE = 0.25` — one author over a quarter of the sampled window. Below that, a
  prolific account is just prolific.
- `FLOOD_MIN_POSTS = 8` — never call flooding on a small sample. 4 of 10 posts is noise.
- `THIN_SOURCE_SHARE = 0.8` — one source category over 80% is a mixing failure.
- `DEAD_FOLLOW_RATIO = 0.3` — when this many follows returned nothing, say so.

Every verdict must state its sample size. `feed-metrics.ts`'s doc comment is emphatic that
**the sample is the population** — everything describes the ~100–200 posts retrieved, never
"your feed" as an abstraction. The Doctor makes stronger-sounding claims than the analytics
page does, so it carries that caveat harder, not softer: "of the last 140 posts" in the
UI, not just in a tooltip.

## What the page looks like

```
Feed Doctor — Home                    sample: last 140 posts · 4 min ago

⚠  @newsbot is flooding
   38 posts, 41% of the window. Next highest is 6%.
   [ Mute 8h ]  [ Hide boosts ]  [ Unfollow ]

⚠  Your feed ended early
   22 follows · 9 returned nothing · 3 could not be loaded
     @a@dead.example    could not be loaded
     @b@slow.example    could not be loaded
   4 more were cut short by your filters.
   [ Review filters ]  [ Review quiet follows ]

✓  Sources are mixing
   Follows 61% · Hashtags 22% · RSS 17%
```

- **Healthy sections collapse to one ✓ line.** A page of green checkmarks trains people to
  stop reading it.
- **Every action is one the user takes.** No auto-mute, ever (roadmap non-goal). Mute
  durations reuse `local-moderation.ts` — which works anonymous, which is the point.
- "Review quiet follows" links to the follow list with the quiet ones marked. This closes
  the loop with sprint 1: `follow-quality.ts` is the same gate that filtered them on the way
  in, so a follow that has gone quiet since being adopted is now visible.

## Wiring, and the one real cost

The flooding and mixing verdicts are free. **"Why did my feed ended" needs the provider to
stop throwing its diagnosis away.** `AnonymousFollowFeedPage` already carries `warnings`;
it needs to also carry per-source outcomes:

```ts
export interface SourceOutcome {
  handle: string;
  /** 'ok' | 'empty' | 'error' | 'filtered' — why this cursor stopped. */
  ending: SourceEnding;
  fetched: number;
}
```

Populated at `:320-330` where `exhausted` is already being set — the branches are literally
already distinguished there, they just do not report which one fired. This is additive to
the page shape; existing consumers ignore the new field.

Home holds the most recent page's outcomes so the Doctor can read them without re-fetching.
Signed-in Home is a single server timeline with no per-source structure, so that verdict
degrades honestly to "your server returned N posts" rather than fabricating sources it
cannot see. **Do not synthesise per-follow endings for the authenticated case** — that
would be inventing data.

## Scope boundary

The Doctor reads Home. Not lists, not hashtags, not arbitrary timelines — those already
have `feed-analytics`. If it earns its keep on Home, extending it is a later, easy change;
building three surfaces for an unvalidated diagnostic is not.

## Tests

- `feed-doctor.spec.ts` — pure verdict tests: a flooder is caught at 41% and not at 12%;
  `FLOOD_MIN_POSTS` suppresses small-sample calls; three endings produce three headlines;
  healthy input produces all-`ok`.
- Provider: `SourceOutcome` distinguishes empty / error / filtered, and existing
  `createFollowFeed` tests still pass unchanged.
- Page: healthy state collapses; actions fire the right `local-moderation` calls; sample
  size is rendered.

## Done when

- `/feed-doctor` answers all three questions against a real anonymous Home feed.
- The "ended because your filters emptied it" case is detectable and stated.
- No new API calls in the flooding and mixing paths.
- `npm run test:ci` clean.
