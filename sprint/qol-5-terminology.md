# QoL sprint 5 — terminology: florp, and the raw-literal audit

## 5a. Florp as a third preset

**Where:** `terminology.ts`.

The file is already built for this: a `Words` interface and two constant tables selected
by `prefs.postNoun()`. Adding a third is a table plus a widened union.

```
postNoun: 'post' | 'tweet' | 'florp'
```

```
const FLORP_WORDS: Words = {
  post: 'florp',  posts: 'florps',  Post: 'Florp',  Posts: 'Florps',
  PostAll: 'Florp all',
  poster: 'florper',  posted: 'florped',
  boost: 'reflorp',  boosts: 'reflorps',
  Boost: 'Reflorp',  Boosts: 'Reflorps',
  boosted: 'reflorped',  Boosted: 'Reflorped',
  UndoBoost: 'Undo reflorp',  BoostedBy: 'Reflorped by',
};
```

- Settings → Mockingbird Blue: the existing two-way control becomes three-way.
- `ClientPrefs.postNoun` needs its stored value widened, and — importantly — an
  **unrecognised stored value must fall back to `post`**, not throw. Someone who tries
  florp, and later loads a build where it doesn't exist, should see posts.
- The `Terminology` header comment says "the English UI strings only"; keep that true.
  Florp is a label swap, never a change to what we send the server.

## 5b. The raw-literal audit

**Where:** everywhere. This is the "some things called reblogs when settings says
Tweets" bug, and it is a class of bug, not an instance.

Confirmed offenders found while diagnosing:

- `status-card/status-card.html:365` — `<span class="sr-only">reposts</span>`
- `status-card/status-card.html:394` — same
- `pages/explore/explore.html:110` — `{{ status.reblogs_count }} boosts`
- `pages/algo/algo.html:144` — `[attr.aria-label]="link.status.reblogs_count + ' boosts'"`

The pattern is clear: **screen-reader text and aria labels are where the untranslated
strings hide**, because they are the strings nobody looks at. The visible buttons right
next to them already use `words()`.

Work:

- Sweep every template and every user-facing string in TS for `post`, `posts`, `boost`,
  `boosts`, `reblog`, `reblogged`, `repost`, `reposts`, `tweet`, `retweet` used as
  *display text* — including `aria-label`, `title`, `alt`, `sr-only`, and toast/error
  copy.
- Route each through `Terminology`. Where a component has no `words()` yet, inject it.
- Leave alone: API field names (`reblogs_count`, `showing_reblogs`), CSS classes, route
  paths, and anything sent to a server. Only display text moves.

## 5c. The guard test

A sweep fixes today. A guard fixes tomorrow — otherwise the next component ships with
`aria-label="3 boosts"` and we do this again.

`terminology-coverage.spec.ts`:

- Read every `*.html` under `src/app`.
- Fail on a banned literal appearing as display text — the noun list above, matched
  case-insensitively as a whole word.
- Allowlist by exact file+line with a required comment, for the genuine exceptions
  (quoting Mastodon's own API in developer-facing docs pages, for instance). An
  allowlist entry should be rare enough that adding one prompts a second thought.
- The failure message must name the file, the line and the fix ("use `words().Boosts`"),
  because a guard test that only says "banned literal found" costs the next person ten
  minutes.

Mind the repo's test-manifest guard (`npm run test:ci` exits 1 on renamed or deleted
tests even when everything passes; rerun with `-- --update`). Adding a spec file will
trip it once — expected.

**Tests:** florp preset returns florp vocabulary; an unknown stored `postNoun` falls
back to post; the coverage spec fails on a deliberately-introduced raw literal and
passes on the swept tree.
