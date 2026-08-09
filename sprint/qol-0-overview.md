# QoL batch — grounded plan & sprint index

A batch of bug fixes and small features raised after using the deployed canary. Five
sprints, bugs first: every item below was traced to a specific line before being
written down, and each sprint names the file it lands in.

## Ordering, and why

**Bugs before features.** Four of the five bugs are cases where a control is present,
looks live, and does the wrong thing (or nothing) with no explanation — the worst kind
to leave in front of a user who is deciding whether the app is trustworthy. The
features are all additive, so nothing in sprints 2–5 is blocked by them.

| Sprint | Theme | File |
|---|---|---|
| 1 | The five bugs | `qol-1-bugs.md` |
| 2 | Server capability probe → hide unsupported feeds | `qol-2-capabilities.md` |
| 3 | Collections: follow state and follow buttons | `qol-3-collection-follow.md` |
| 4 | Hashtag workflows (view-before-follow, zero-result follow, "My posts") | `qol-4-hashtags.md` |
| 5 | Terminology: florp preset + raw-literal audit and guard | `qol-5-terminology.md` |

## Diagnoses (done up front, not during)

Each of these was read to the line. Recording them here so the sprints can be about
the fix rather than the hunt.

### 1. Bluesky thread posting silently blocked

`compose/compose.ts:947`. `canSubmit` returns `false` when any Bluesky target is
selected and `thread()` holds text — with **no** message. That is the exact reported
symptom: the Post button goes dead when the second box is filled and comes back when
it is emptied, and switching to fedi-only "fixes" it.

Separately at `compose.ts:867`, `overLimit` measures every box against
`MAX_POST_CHARS` (500, Mastodon's) regardless of target. Bluesky's limit is 300
graphemes (`providers/bluesky/bluesky-reply.ts:11`), so a 400-character Bluesky post
reads as fine in the counter and is refused by the network.

Two defects, one symptom. Both in sprint 1.

### 2. Liking a post makes the feed jump

`sentiment.ts:321` `isRatioed()` compares `replies_count` against
`favourites_count + reblogs_count`. With Calm mode on, `pages/home/home.ts:287` runs
that predicate inside `applyTimelineFilters`, which is inside the `visible()` computed.
So liking a ratioed post raises `favourites_count`, flips `isRatioed` to false, and the
post **appears or disappears mid-list** — everything below it shifts. `track s.id` is
correct and is not the problem; the filter re-deciding is.

### 3. Bulk actions: retweet toggles look list-scoped

`pages/settings/bulk-actions/settings-bulk-actions.html:96` passes `[target]="target()"`
to the dialog unconditionally, including for `reblogs-off` / `reblogs-on`. The service
is not actually fooled (`bulk-actions.ts:336` branches on `needsList` first, so the
account-wide path runs), but the dialog is handed a list it will never use while the
list picker sits selected on screen — the UI states the wrong scope. Fix the input, and
make the dialog assert rather than accept a target it cannot use.

### 4. Mobile chat is mostly chrome

`pages/conversations/conversations.css:459` caps the peer list at `40vh` under
`max-width: 800px`, and it is stacked above the thread rather than beside it. Add the
header, composer, site footer and bottom nav and the actual conversation gets what is
left. The page also uses `height: calc(100vh - 100px)` (line 9), which on mobile
browsers is the wrong `vh` — `100vh` excludes the retracting URL bar.

### 5. "Reblog"/"boost" wording ignores the Tweets setting

`Terminology` (`terminology.ts`) already exists and most of `status-card.html` uses it
correctly. The leaks are hardcoded literals that never route through it, e.g.
`status-card.html:365` and `:394` (`<span class="sr-only">reposts</span>`),
`pages/explore/explore.html:110` (`{{ status.reblogs_count }} boosts`),
`pages/algo/algo.html:144` (`' boosts'`). Screen-reader text and aria labels are the
main offenders, because they are the strings nobody re-reads.

## Constraints that shape all of this

- **Client-side only.** Everything must work against real `mastodon.social` with no
  server change — see the existing `SearchCapability` for the house pattern.
- **Anonymous must not regress.** Follow buttons, capability probes and tag follows are
  signed-in features; anonymous visitors get the honest read-only version, never a
  button that 401s.
- Preferences live in `ClientPrefs` / localStorage, account-scoped where they are
  per-account.
