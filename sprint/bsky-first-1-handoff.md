# Sprint 1 → Sprint 3 handoff: the `isAnonymous` migration inventory

Status: COMPLETE (2026-08-12). Written as Sprint 1's closing deliverable.

Parent: [bsky-first-1-account-kinds.md](bsky-first-1-account-kinds.md)

## What this is

Sprint 1 deliberately did **not** migrate any of the ~190 non-spec `isAnonymous`
call sites. It added the vocabulary to do so:

| Predicate | Means | True for |
|---|---|---|
| `isAnonymous` (legacy) | *both* meanings, ambiguously | anonymous |
| `lacksMastodonToken` | **A** — no bearer token, skip authenticated Mastodon calls | anonymous, bluesky, signed out |
| `isAnonymousIdentity` | **B** — use the browser-local anonymous stores | anonymous |
| `isBlueskyPrimary` | Bluesky owns the identity | bluesky |

This document is the inventory, so the sprint that turns the Bluesky door on
does **triage against a list** rather than rediscovering the problem file by
file. Counts are from 2026-08-12.

## The rule

For each site, ask: *would a Bluesky-primary account want the same branch as an
Anonymous one?*

- **Yes, because neither has a Mastodon token** → `lacksMastodonToken` (A).
- **No, because this reads or writes the local anonymous stores** →
  `isAnonymousIdentity` (B).
- **No, because Bluesky wants a third behaviour entirely** → needs a real
  branch, not a rename. These are the interesting ones and are listed last.

Anything not touched keeps `isAnonymous` and keeps working — the migration is
incremental by design.

## Meaning A — rename to `lacksMastodonToken`

Mechanical. These gate authenticated Mastodon work that a Bluesky-primary
account equally cannot do.

| File | Lines | What it gates |
|---|---|---|
| `pages/home/home.ts` | 337, 399 | Follow nudge; live-stream sync |
| `follow-button/follow-button.ts` | 123 | Server follow action |
| `follow-state.ts` | 85, 133, 196 | Relationship reads/writes |
| `invites/invite-access.guard.ts` | 17 | Signed-in-only page |
| `pages/invites/invites.ts` | 53 | `signedIn` flag |
| `pages/collection/collection.ts` | 134 | `canFollow` |
| `pages/tag/tag.ts` | 114 | `canFilterMine` |
| `pages/server-feed/server-feed.ts` | 106 | `authRequired` feeds |
| `pages/lists/lists.ts` | 411 | `authRequired` feed filter |
| `pages/settings/i18n/settings-i18n.ts` | 129 | Server-side prefs |
| `account-hover-card/account-hover-card.ts` | 298, 334 | Relationship fetch |
| `feed-analytics/feed-analytics.ts` | 100 | Server-backed analytics |
| `feed-members/feed-members.ts` | 98 | Server-backed members |
| `pkm/pkm-source.ts` | 203 | Authenticated source |
| `starter-kit-post/starter-kit-post.ts` | 41, 90 | Follow-all action |
| `import-follows.ts` | 149 | Rate-limit delay |
| `algo-feed.ts` | 129 | Authenticated feed source |
| `status-card/status-card.ts` | 1218 | Server-known status ops |

**~30 sites.** Low risk, high mechanical volume. Do these in one commit.

## Meaning B — rename to `isAnonymousIdentity`

These touch the local anonymous stores (follows, tags, bookmarks, lists, feed
corpus, the `'anonymous'` account id). A Bluesky-primary account must **not**
take these branches.

| File | Lines |
|---|---|
| `pages/home/home.ts` | 469, 499, 706, 771, 791, 800 |
| `pages/lists/lists.ts` | 320, 386, 469, 471, 494, 536, 539, 571, 574 |
| `pages/list-timeline/list-timeline.ts` | 82, 127, 146, 208, 275, 300 |
| `pages/bookmarks/bookmarks.ts` | 84, 177, 197, 222 |
| `pages/tag/tag.ts` | 154, 157, 198, 204, 222 |
| `pages/profile/profile.ts` | 814, 851, 889, 1485, 1536, 1564, 1604 |
| `pages/starter-collection/starter-collection.ts` | 41, 62, 64, 86 |
| `pages/drafts/draft-sources.ts` | 92 |
| `pages/settings/profile/settings-profile.ts` | 37, 92 |
| `pages/settings/follows/settings-follows.ts` | 25 |
| `people-browser/people-sources.ts` | 274, 277, 285 |
| `list-dialog/list-dialog.ts` | 171, 206, 238, 366 |
| `bulk-add-dialog/bulk-add-dialog.ts` | 77, 168, 183 |
| `just-my-server.ts` | 181, 213, 235, 268, 314, 326 |
| `import-follows.ts` | 177, 191 |
| `providers/anonymous/*` | all — these are the anonymous provider itself |
| `shell/left-rail/profile-stack/rail-profiles.ts` | 44, 58, 110, 141 |

**~55 sites.** Also mechanical, but each one deserves a moment's thought: a
mistake here means a Bluesky account reading another identity's local data.

## The interesting ones — a real third branch

These cannot be renamed. A Bluesky-primary account wants behaviour that is
neither the Mastodon nor the Anonymous branch, and Sprint 3+ must decide what.

| Site | The question |
|---|---|
| `pages/home/home.ts:706` (`mergeStatuses`) | Anonymous merges from the local corpus, Mastodon from the timeline. Bluesky merges from the Bluesky provider — which already works via `FeedAggregator`, so this may just need `isAnonymousIdentity` plus a check that the aggregator is reached. **Verify at runtime, do not assume.** |
| `shell/shell.ts:252, 310` | Skips `verify_credentials` for anonymous. Bluesky must skip it too (A), but `previousWasAnonymous` at 310 drives a reload-on-switch — confirm a Bluesky switch takes the same path. |
| `shell/shell.html:232, 238` | Renders "Exit anonymous" vs "Log out". Bluesky needs its own wording; `logout()` now has a Bluesky branch (Sprint 1), so the label is the only gap. |
| `leave-dialog/leave-dialog.ts:50` | Its `anonymous` input decides the whole dialog's copy and which teardown runs. Bluesky needs a third variant — this is the one most likely to *destroy data* if rushed. |
| `providers/feed-aggregator.ts:128, 141` | `mastodonExhausted` is set from `isAnonymous`. For Bluesky-primary there is no Mastodon source at all unless a connector is attached — Sprint 4's territory. |
| `feed-capability.ts:220` | Cache key is `host\|anon\|auth`. A Bluesky-primary session probing Mastodon anonymously must not collide with a real anonymous session's cache. Needs a third value. |
| `pages/thread/thread.ts:129` | `capabilitiesFor(provider, !isAnonymous)` — the second arg means "can act on the server". For a Bluesky post under a Bluesky account the answer is **yes**, which today's expression gets wrong. |
| `command-bar/command-bar.ts:55, 60` | Provider chips. Bluesky-primary should probably not show a "Bsky" chip as a *foreign* provider when it is the primary network. |
| `rail-profiles.ts:58–107` | Builds the identity stack. Today a Bluesky card is always "a connector"; under Sprint 1's model it may be the identity. This is the open question Sprint 1 deferred. |
| `fail-whale/fail-whale.ts:86` | Error-page copy assumes anonymous-or-Mastodon. |
| `pages/login/login.ts:202` | Redirect-if-already-signed-in. Interacts with Sprint 2's routing. |

**~11 sites needing judgement.** These, not the renames, are the real work.

## Templates

Roughly 45 more sites live in `.html` files (`shell.html`, `profile.html`,
`status-card.html`, `lists.html`, `home.html`, `settings-*.html`, …). They
follow the same A/B split but are invisible to a TypeScript compiler, so a
rename that misses one fails silently at runtime rather than at build time.
**Grep the templates separately** and lean on `npm run test:ci` — several of
these are covered by component specs.

## Suggested order

1. Meaning-A renames (one commit, mechanical, no behaviour change).
2. Meaning-B renames (one commit, mechanical, no behaviour change).
3. Templates, same split.
4. The eleven judgement calls — **one commit each**, with a spec each.

Steps 1–3 are pure refactors: `isAnonymous` and `isAnonymousIdentity` return the
identical value today, and `lacksMastodonToken` differs only for a kind no user
can yet create. So all three can land safely *before* the Bluesky login page
exists, which is why they are worth doing early and separately.
