# Portable config: exporting and importing your setup

The goal: write your Mawkingbird setup to a file, put that file somewhere (a
gist, a dotfiles repo), and have someone else — or you on a new laptop — load it
and get your setup. Without ever publishing a credential, and without
accidentally publishing that you follow `#diabetesSufferers`.

Nothing here is built yet except the classification (`storage-registry.ts`) and
the credential splits. This document is the design, the open questions, and the
one problem that needs a decision before a file format is fixed.

---

## The one thing to understand first: scope suffixes

This is the part that is genuinely confusing, so here it is concretely.

Some settings belong to the app (your theme). Some belong to a **specific
account** (the RSS feeds you added while signed in as `@you@fosstodon.org`). The
second kind can't all share one key, or signing into a second account would show
you the first account's feeds. So account-owned keys get a suffix:

```
mockingbird_client_prefs           ← app-wide, no suffix
mockingbird_rss_feeds_xy3ge5       ← belongs to one account
                    ^^^^^^
```

That suffix comes from `account-scope.ts`:

```ts
scopeSuffixForToken(token) === '_' + fnv1a(token);
```

**The suffix is a hash of your access token.** Not your username, not your
instance — the token.

### Why it was built that way

These services read their storage the moment they are constructed, before any
network call has happened. At that instant the app knows the token (it is right
there in `localStorage`) but does _not_ know who the token belongs to — finding
that out means calling `verify_credentials` and waiting. Hashing the token was
the only identifier available synchronously.

It also has a real security property worth keeping: the raw token never appears
in a key name, so the storage inspector, screenshots, and bug reports can show
key names safely.

### Why it breaks export/import

Tokens are not stable. **Every time you sign in again you get a new token.**
Signing in on a new laptop always produces a new token. So:

```
Laptop A                                    Laptop B
--------                                    --------
token = "abc..."                            (import the file)
suffix = _xy3ge5                            keys land as: mockingbird_rss_feeds_xy3ge5
key    = mockingbird_rss_feeds_xy3ge5
                                            sign in → token = "zzz..."
export  ───────────────────────────────►    suffix = _9fk2p1
                                            app looks for: mockingbird_rss_feeds_9fk2p1
                                                                                ^^^^^^^
                                                                                not there
```

The imported settings are sitting in storage, intact, under a name the app will
never look up again. They are invisible, and they never get cleaned up. From the
user's side: "I imported my config and half of it didn't apply."

Note this is _not_ about secrets. The token-derived name is the problem even
though the token itself was never exported.

Only the account-scoped keys are affected. App-wide keys — theme, fonts, feature
flags, which is most of what a shareable config contains — import fine today.
Run `npm run check:storage` and look at the registry: entries with
`suffix: 'account'` are the affected ones.

### The two ways out

**Option A — keep token hashing, remap on import.**
The export records what each key's scope _means_ (`acct:you@fosstodon.org`)
rather than the hash. On import, the app derives the local suffix for the
account you are currently signed in as and rewrites the keys.

- Small change, confined to the import/export code.
- Every import needs a live signed-in account to remap against, so "import
  before signing in" doesn't work, or has to defer.
- Orphaned keys still accumulate whenever a remap is skipped or a token rotates
  for other reasons.

**Option B — stop scoping on the token; scope on account identity.**
Use `acct@host` (`you@fosstodon.org`) instead of `fnv1a(token)`. Import becomes
a straight copy: the same account is the same folder on every machine, forever.

- Fixes the orphaning permanently, and makes re-authentication a non-event.
- Bigger change: touches `account-scope.ts`, `account-data.ts`, and every
  account-scoped key.
- Has to answer the original problem — _what scope do you use before you know
  who you are?_ Since the split, `mastodon_mock_sessions` stores an `account`
  snapshot for every saved login, so on any load after the first this is now
  answerable synchronously: active token → session row → `acct` + `server`. The
  remaining gap is the very first sign-in with a brand-new token, where the
  snapshot is still `null` until `verify_credentials` returns.
- Identity is no longer opaque: `mockingbird_rss_feeds_you@fosstodon.org` puts
  your handle in a key name. Not a secret, but it is more legible than a hash to
  anything that can read the key list — including a settings export, which would
  then need the handle stripped or normalized.

**Recommendation: B, decided before a file format ships**, because A bakes
"scope is a hash" into the format and you would be migrating the format later.
Storing the session `account` snapshot — which the credential split added for
unrelated reasons — is most of what B needs.

**But you asked to feel it first, and that is a reasonable plan.** Option A on a
throwaway basis is enough to learn what import actually feels like; just do not
publish a file format built on it.

---

## How export works

Walk `localStorage`, classify each key with `classifyStorageKey()` from
`storage-registry.ts`, keep the ones whose tier is in the chosen profile, write
JSON.

Two profiles:

| Profile     | Includes                          | For                                     |
| ----------- | --------------------------------- | --------------------------------------- |
| `shareable` | `setting`                         | a public gist — "here is my setup"      |
| `personal`  | `setting` + `private` + `content` | your own backup, your own other machine |

Neither ever includes `secret` or `cache`. The tiers, and why `private` exists
as something separate from `secret`, are documented in `security.md`.

The critical rule: **walk storage with `classifyStorageKey()`, never with
`key === base`.** Account- and instance-suffixed keys will not match a bare base
comparison, and depending on which way you get it wrong you either silently drop
half the export or silently include something you classified as excluded.

---

## How import works, and why it replaces rather than merges

**Import replaces. It does not merge.** You are right that merging would be
insane — there is no sensible union of two themes, and a half-merged config is a
state no user asked for and nobody can reason about. Importing a config means
"I want this config."

What that implies, and what the UI has to be honest about:

- Every key the imported profile covers is **overwritten or deleted**. If your
  file has no `mockingbird_rss_feeds` and you had feeds, they are gone.
- Deletion is scoped to the profile. Importing a `shareable` file must not
  delete your drafts, because a `shareable` file never had authority over
  `content` in the first place. Replace within the tiers the file claims;
  leave everything else alone.
- The file records which profile produced it, so the importer knows what it is
  allowed to clear.
- Credentials are never touched by an import, in either direction. You will
  reconnect Bluesky/GitHub/Raindrop after importing. That is by design.

Show what is about to change before doing it, and say plainly that it is a
replace. "Data loss" is fine when it is the thing the user asked for and could
see coming.

---

## How this is secure

**Export cannot leak a credential, structurally.** Not "we remembered to filter
them" — the four keys that used to mix a secret into exportable data were split
so the secret lives in its own key with its own classification:

| Exportable                 | Secret                           |
| -------------------------- | -------------------------------- |
| `mastodon_mock_sessions`   | `mastodon_mock_session_tokens`   |
| `mockingbird_bsky_profile` | `mockingbird_bsky_credentials`   |
| `mockingbird_github_user`  | `mockingbird_github_credentials` |
| `mockingbird_pastes`       | `mockingbird_paste_edit_keys`    |

**Unknown keys are refused, not allowed.** `classifyStorageKey()` returns null
for anything unregistered and `isKeyExportable()` says no. Forgetting to
classify a new key costs you an export, never a leak.

**Forgetting is caught at build time.** `npm run check:storage` (in
`make check`) scans the source and fails on any key missing from the registry.

**Import is a trust boundary.** A config file is untrusted input even when it
came from a gist you chose — treat it like a hostile HTTP response:

- Refuse any key that is unregistered, or classified `secret`, or classified
  `cache`, or whose tier the file's profile does not cover.
- Re-validate values; do not trust that a field holds what its type says. The
  pattern already exists: `client-prefs.ts` runs `normalizeColor()` on load from
  storage, not just on set, so a hand-edited colour cannot become a CSS
  injection. Import needs that discipline everywhere, not just for colours.
- Cap sizes, so a hostile file cannot exhaust the storage quota and brick the
  app.
- Never let an import write a key that classification says is not importable,
  even if the file asks nicely.

---

## Decisions still open

**1. Scope suffixes — Option A or B above.** The one that blocks a stable file
format.

**2. Should `shareable` include `mastodon_mock_server`?** It is classified
`private` today, so it is excluded. But a config that does not say which
instance it is for is less useful to share, and for a big public instance it
discloses very little. Possibly a per-key opt-in at export time rather than a
fixed tier.

**3. RSS feeds and OPML.** RSS subscriptions are `private`, so they are excluded
from a shareable export — but feed lists are exactly the kind of thing people do
want to share, and OPML is the established format for it. Probably a separate
"export feeds as OPML" action rather than part of the config file.

That brings a wrinkle worth handling deliberately: **private feed URLs often
carry a credential in the URL itself.** Feedbin, Miniflux, Tiny Tiny RSS, and
Google Alerts all issue per-user feed URLs with a token in the query string, so
`?key=…` in a feed URL can be a real secret sitting in a `private`-tier value.
Options, none implemented today:

- Strip the query string on export. Simple, and breaks every legitimate feed
  that uses query parameters for non-secret reasons (`?format=rss`, `?cat=3`).
- Strip only credential-shaped parameters (`key`, `token`, `auth`, `secret`,
  `api_key`, …). Better hit rate, still guesswork.
- Show the URLs and let the user decide. Most honest, most clicks.

A dialog listing the feeds with query strings highlighted, defaulting to
stripping, is probably the right shape. **Not implemented today** — this is a
note so the problem is not rediscovered later.

Worth knowing before choosing: blanket "remove everything after `?`" is more
destructive than it sounds. Plenty of ordinary feeds carry non-secret query
parameters (`?format=atom`, `?cat=12`, `?alt=rss` on Blogger, `?feed=rss2` on
WordPress), and stripping those yields a URL that 404s rather than one that
leaks — a silent break at import time, on someone else's machine, which is the
worst place to discover it. Whatever gets built, the export should keep the
original URL alongside the cleaned one, or at minimum tell the user which feeds
it changed.

**4. Versioning.** The file needs a schema version from the first release, or
the second release cannot read the first one's files.

**5. Where does the file live?** Copy to clipboard and download-as-file are both
trivial. Actually posting to a gist requires a GitHub token with `gist` scope —
which is a credential, and would fall under the retention policy like every
other connector.
