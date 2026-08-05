# Anon Office — Sprint 1: copy an account, leave cleanly

Status: COMPLETE (implemented 2026-08-04; 3059 tests, lint, prettier and build clean).
Roadmap: `anon-office-0-overview.md`.

## What changed during implementation

Three things worth knowing that the plan did not anticipate:

1. **Collections load *after* the confirm screen, not before it.** Awaiting them inline
   broke ten existing tests by stranding the dialog in `loading` — and that was the design
   telling on itself: a slow collections read (or a 404 from a pre-4.6 server) would have
   delayed the follows the user actually clicked for. The follows now render immediately
   and collections fill in behind, with the confirm button held only while that read is in
   flight so nobody can click through and silently get half the feature.
2. **A collection member has to be followed to be listed**, so copying collections spends
   `ANONYMOUS_FOLLOW_LIMIT` slots exactly like copying follows does. `AnonymousLists`
   stores follow *keys*, minted by `AnonymousFollows.follow`. This is decision 2's cost
   argument showing up directly in the storage model, and the UI says so.
3. **The export offer needed its own exporter.** `exportPortableConfig` builds a *shareable
   setup* — `setting` keys plus a three-key private allowlist — and contains **none** of
   the eight anonymous keys. Wiring the dialog to it would have handed someone their theme
   and proxy choice while deleting the follow list they thought they were saving, beside a
   button reading "this can't be undone". Replaced with `SessionTeardown.backup(scope)`,
   which mirrors the teardown's own registry walk minus credentials. See
   `session-teardown.spec.ts` → "the backup has to contain what the wipe destroys".

Three changes that all live within arm's reach of each other: the profile `•••` menu (make
it readable, group it, upgrade clone-friends into `Copy account`), and the shell's exit
(make it ask, and let it clean up).

---

## 1. The `•••` menu is unreadable, and that is a bug report

Matthew asked for "Copy Account, add to top of profile's `•••` menu" — then found the
existing `Clone friends list` entry had been at the top of that menu since 2026-07-29 and
he had never seen it. That is the finding. A feature that ships into an unscannable menu
has not shipped.

Look at what `.account-danger-panel` is (`pages/profile/profile.css:177-232`): a 5px-padded
box of full-width buttons with **no gap between them**, all of them red except the ones
that are not, with a `.menu-note` label and a wrapped row of mute-duration pills in the
middle. Seven-plus interactive elements, one visual weight, zero grouping.

### What changes

**Density first** — this is the part that fixes the actual complaint:

- Gap between items (`display: grid; gap: 2px` on the panel, or margin on the children —
  either, but the items must not touch).
- Real padding on the panel (`5px` → `6px 5px`) and on items (`8px 10px` stays, it is fine
  once things are separated).
- `min-width: 170px` → wider (`200px`); several labels are near-wrapping already and
  `Copy account…` is longer than what is there now.

**Then grouping.** One `<hr class="menu-rule">` (a real `<hr>`, so it is exposed to
assistive tech as a separator rather than being a styled div nobody announces) between:

```
┌─────────────────────────────┐
│ Open on mastodon.nu       ↗ │   keep / go
│ Copy account…               │
│ Hide boosts                 │
├─────────────────────────────┤   ← <hr class="menu-rule">
│ Mute for…                   │   destroy / hide
│   [8h] [1d] [1w] [∞]        │
│ Block account               │
│ Remove follower             │
│ Report account              │
└─────────────────────────────┘
```

Ordering rules that should survive later edits:

- Above the rule: things that make something *appear* in the reader's app. Below: things
  that make something *disappear*. `Hide boosts` is the judgement call — it goes **above**,
  because it tunes a relationship you are keeping rather than ending one. If that reads
  wrong in practice, moving it is a one-line change and not a re-litigation of the rule.
- The red (`#e0245e`) treatment applies *below the rule only*. `.menu-neutral` currently
  opts individual items out of red; invert it so the panel's default is neutral and a
  `.menu-danger` class opts in. Fewer classes on the common case, and a new menu item added
  carelessly defaults to "not alarming" instead of "alarming".

The same panel markup appears twice in `profile.html` (the Bluesky branch at ~line 84 and
the Mastodon branch at ~line 130). Both get the spacing and the rule. Do not try to unify
them in this sprint — their contents genuinely differ.

### Tests

- `profile.spec.ts`: the rule renders between the last keep-action and the first
  destroy-action, in both provider branches.
- Existing menu tests must keep passing untouched; if a selector breaks, the fix is the
  test's selector, not re-flattening the menu.

---

## 2. `Copy account` — follows *and* collections

`Clone friends list` becomes `Copy account…` and grows the collections half. Decision 1:
one action, one report, no checkbox dialog.

### Why collections were the missing half

The profile you want to copy has already done the work twice: once by choosing who to
follow, and once by *publishing* curated collections. Sprint `anonymous-great-2` took the
first and left the second, even though `AnonymousLists` (browser-local lists, member
management, all of it) has existed since `anonymous-mastodon-sprint01`. The gap was never
capability. It was that nobody asked.

### Flow

Unchanged from clone-friends through the follows phase — `homeServerFor()` still decides
who to ask (that fix is load-bearing: ask the wrong server and you get the federated
subset, which is how "1 to follow, 4 too quiet" happened). Then:

1. `GET {homeServer}/api/v1/accounts/{id}/collections` — `api.ts:505 accountCollections`,
   payload wrapped as `{collections: [...]}`.
2. For each collection (cap: **5**, most-members first — a read budget, same reasoning as
   `CLONE_MAX_PAGES`), `GET /api/v1/collections/{id}` for its accounts. Rank by the
   `item_count` field already present on the list payload, so picking the biggest five
   costs no extra requests.
3. Quality-gate the members (decision 2) with `rejectionReason()` from `follow-quality.ts`
   — the *same* gate as follows, unchanged and unforked.

**Verified live and anonymously on 2026-08-04** — the spike is done, no fallback needed:

- Both endpoints return **200 with no token**.
- `/collections/{id}` returns `{collection, accounts}` where `accounts` are **full `Account`
  objects** carrying `statuses_count` and `last_status_at` — so the quality gate costs zero
  extra requests, exactly as on the follows side.
- Fixture with real data: Gargron (`id=1`) has 5 public collections; `116784146949292427`
  has 7 members. Useful for a live-ish test.

`hide_collections` is present on member accounts and an account can still refuse: an empty
`collections` array against a non-zero claim is the same *refusal vs absence* distinction
`followsAreHidden()` already draws. Reuse that phrasing rather than reporting "no
collections".
4. `AnonymousLists.create(title)` + `setMember()` per survivor. Title collision: suffix
   `" (copy)"`, then `" (copy 2)"`. Never silently merge into an existing list.

### The report is the feature

```
Copied from @curator@mastodon.nu

  Follows      20 adopted        43 skipped (too quiet)
  Lists         3 copied

    Reading list      12 of 31    19 too quiet
    Rust people        8 of  9     1 too quiet
    Local news         0 of 14    14 too quiet   ⚠
```

**The per-list skip count is mandatory, not a nicety.** A curated-but-quiet collection can
copy back nearly empty, and a zero-survivor list must say so on the same screen — an empty
list appearing in the sidebar with no explanation is exactly the failure that produced
`homeServerFor()`.

There is deliberately **no "copy everyone anyway" escape hatch.** A local list is a feed
source rendered one API call per member, so a skipped dead account is a call saved on every
future open of that list — the skip is the feature, not a limitation to route around
(decision 2).

`ANONYMOUS_FOLLOW_LIMIT` (50) still caps follows. Lists are not capped by it — they are not
follow slots — but the 5-collection ceiling stands.

### Structure

- `clone-friends.ts` keeps its name, its exports and its tests. Follows logic does not move.
- New `copy-account.ts` beside it: pure selection/report logic for the collections half plus
  the combined report type. Same bargain as `clone-friends.ts` — arithmetic, no HTTP, fully
  testable.
- `clone-friends-dialog/` → gains the collections phase and the combined report. Renaming
  the directory to `copy-account-dialog/` is correct but costs a `test-manifest.json`
  update (`test-manifest-guard` memory: `npm run test:ci -- --update`). Do it in one commit,
  by itself.
- Still `canCloneFriends()`-guarded → **anonymous only**. Non-negotiable, decision 1 of
  `anonymous-great-0`. The comment block in `profile.html` explaining why stays and gets
  updated to say "copy", not "clone".

---

## 3. Leaving asks first, and can clean up

### Now

`shell.html:212` and `:71` call `auth.logout()` / `auth.exitAnonymous()` on click. No
confirm. `auth.ts:279-315` clears the token and mode and leaves every other key — follows,
lists, bookmarks, tags, prefs, RSS cache — sitting in `localStorage`.

For the use case driving this (reading on a machine where signing in is not an option),
"log out" leaving a complete record of who you follow and which hashtags you read is the
wrong default. `mockingbird_anonymous_tags` is classified `private` in
`storage-registry.ts:221` with a note explaining exactly why a followed-tag list is a
disclosure. We already know. We just never offered the door.

### The dialog

Triggered by both `Exit anonymous` and `Log out`. Three outs (decision 4):

```
Leave Anonymous?

  ┌──────────────────────────────────────────────┐
  │ Return to login page                         │
  │ Your follows, lists and likes stay in this   │
  │ browser.                                     │
  ├──────────────────────────────────────────────┤
  │ Delete anonymous data, then leave            │
  │ Follows, lists, likes, saved posts and       │
  │ followed tags. Any signed-in accounts you    │
  │ have saved are kept.                         │
  ├──────────────────────────────────────────────┤
  │ Remove all browser data, then leave          │
  │ Everything above, plus saved accounts and    │
  │ settings. This can't be undone.              │
  └──────────────────────────────────────────────┘

     [ Download my data first ]        [ Cancel ]
```

- **Middle option is the emphasised one.** It is what most people asking for this actually
  want, and it is the only one that is both effective and non-catastrophic.
- **Export first is offered, not forced** (decision 4). Reuses
  `exportPortableConfig(… 'private')` — the `personal` profile, since a backup for yourself
  is exactly the case that profile was written for. `assertSafeConfig` still refuses to let
  a credential out; that guard is not bypassed for this path.
- Signed-in wording swaps "Anonymous" for the handle and drops the middle option's
  anonymous framing — for a signed-in user the middle option is "delete this account's
  local data".

### The wipe

`storage-registry.ts` is the source of truth; **do not hand-write a key list** in the
dialog. It needs one new thing:

```ts
/** Which teardown a key belongs to. Everything is 'all'; anonymous session data is 'anonymous'. */
group?: 'anonymous';
```

on `StorageKeySpec`, set on the eight `mockingbird_anonymous_*` entries (`:193, :200, :207,
:214, :221, :433, :547, :554`) — plus local likes when sprint 2 adds its key.

Then in `auth.ts` (or a small `session-teardown.ts` — preferred, since `auth.ts` should not
grow storage-sweeping logic):

- `clearAnonymousData()` — every registry key with `group: 'anonymous'`, honouring `suffix`
  via the existing `matchesKey()` rather than prefix-matching by hand.
- `clearAllData()` — every registry key, all storages, plus the IndexedDB stores (the RSS
  feed cache lives there — `rss-feed-cache` memory). Then `logoutAll()`.

Both navigate to `/login` and **hard-reload**. The precedent is already set: account
switching hard-reloads (`account-scoped-client-settings` memory) precisely because
signal-holding services cache state that a storage wipe does not reach. A soft navigation
after deleting everything under a live `AnonymousFollows` is a bug factory.

`storage-registry.spec.ts` already enforces "every key is registered". Add: every key is
either in the `anonymous` group or deliberately not, and `clearAllData()`'s sweep is a
superset of `clearAnonymousData()`'s.

### Tests

- Dialog renders three options; each calls the right teardown; Cancel touches nothing.
- `clearAnonymousData()` removes every anonymous key and **leaves a saved signed-in session
  intact** — this is the assertion that makes the middle option trustworthy.
- `clearAllData()` leaves `localStorage` empty of registered keys.
- Export-first path produces a config that `assertSafeConfig` accepts.

---

## Done when

- The `•••` menu has visible space between items and a rule between keep and destroy, in
  both provider branches.
- `Copy account…` copies follows and collections, reports per-list skips, and is still
  invisible when signed in.
- Both exits confirm, offer export, and the two teardowns do what they say.
- `npm run test:ci` clean (`ui-test-runner` memory: specs only via that command). Lint and
  `storage-registry.spec.ts` clean.
