# QoL sprint 2 — server capability probe

## The problem

We show links to feeds the server in front of us does not serve. `mastodon.social`
answers `/timelines/public` with 422 anonymously; some servers disable the local or
federated timeline entirely; the Esperanto instance serves no trending links. The user
clicks, gets an error page, and learns nothing except that something is broken —
which reads as our bug, not the server's policy.

## Decision: hide, don't disable

Unsupported feeds are **not rendered**. No greyed-out row, no tooltip.

The reasoning: a disabled row is a permanent advertisement for something the user can
never have on this server, and it invites repeated clicking. This is a per-server fact
about the world, not a per-user setting they might change. The place to explain the
server's limits is the server's own About page, which we already link.

## Where this already exists — extend, don't invent

- `search-capability.ts` — the house pattern: per-host record, in-memory, probed lazily,
  one in-flight request per host, `reset()` to forget. **Read it first.** The new service
  should look like a sibling of it, not a second design.
- `server-availability.ts`, `server-degradation.ts`, `instance-status.ts` — existing
  reachability/health signals. Check whether the answer is already there before adding a
  request.
- Terms of Service and anonymous-search gating already hide UI this way; match how they
  do it.

## What to build

**`FeedCapability`** (`ui/src/app/feed-capability.ts`), one probe per feed kind:

| Capability | Probe | Consumers |
|---|---|---|
| `public-local` | `GET /timelines/public?local=true&limit=1` | Feeds page, nav |
| `public-federated` | `GET /timelines/public?limit=1` | Feeds page, nav |
| `trending-links` | `GET /trends/links?limit=1` | Explore, right rail |
| `trending-tags` | `GET /trends/tags?limit=1` | Explore, right rail |
| `trending-statuses` | `GET /trends/statuses?limit=1` | Explore |

Outcomes reuse the `SearchAbility` vocabulary where it fits: `works` / `refused` (401,
403, 404, 422) / `unreachable`. An empty 200 is **`works`** — a quiet server is not a
crippled one, and hiding a working feed because nothing is trending right now would be
the same class of error in the other direction.

### Caching: "rare, but not permanent"

Unlike `SearchCapability`, this **is** persisted — probing five endpoints on every page
load is a real cost, and the answers change on the timescale of server config edits.

- localStorage, keyed by host, via the existing `storage-registry`.
- TTL **24h**; a stale entry is used immediately and refreshed in the background, so a
  server that has just enabled a feed reappears on the next visit rather than the next
  click.
- Probes go through `Api` (inheriting interceptors, token, configured server) so the
  answer describes the request the user's UI will actually make — the same reasoning
  written up in `search-capability.ts`'s header comment.
- **Signed-in and anonymous answers differ** (that is the whole 422 story), so the cache
  key must include whether we have a token. An anonymous "refused" must not survive
  login and hide a feed the user can now see.
- A manual "re-check server features" button on the server settings page, next to the
  existing clear-caches affordances.

### Wiring

- Feeds/Lists page: filter server-feed rows by capability.
- Nav and right rail: same.
- Anywhere a feed is hidden, the *route* must still work if reached directly — hiding
  the link is a discovery decision, not an access-control one. A deep link to a
  refused feed shows the existing unavailable page.

**Tests:** a probe that 422s hides the row; an empty 200 keeps it; the cache serves a
second caller with no second request; a token change invalidates.
