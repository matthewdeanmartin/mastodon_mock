# Anonymous Great — Sprint 1: search that tells the truth

Status: COMPLETE (implemented 2026-07-29; 1787 tests, lint and storage-registry clean). Roadmap: `anonymous-great-0-overview.md`.

## The bug

Search a server that doesn't allow anonymous search, and the page says:

> No results.

That is a false statement. Three different things produce it today and the user cannot tell
them apart:

1. **Nobody posted about this.** The honest case.
2. **The server refuses anonymous search.** `/api/v2/search` returns 401/403/422, the
   observable turns into an error, and we land on an empty result set.
3. **The server has no Elasticsearch.** This is the common one and the nastiest.
   `type=accounts` works perfectly. `type=statuses` returns `[]` — always, for every query,
   forever. Nothing errors. Nothing warns. The Advanced form, the DSL, the serializer, the
   whole search feature is inert and looks merely unlucky.

Case 3 hits **signed-in users identically**. This is not an anonymous-mode bug that
authenticated users are spared; a token does not conjure a search index.

## What already exists

`ui/src/app/search-server-probe.ts` — `probeSearchServer(baseUrl)` runs an anonymous canary
search for `Gargron`/`mastodon` against `type=accounts` and classifies the outcome as
`ok` / `no-results` / `auth-required` / `unreachable`. It is already wired into the search
page's "use a different search server" box (`search.ts` `applySearchServer`), which refuses
to adopt a server the probe doesn't like.

Two gaps: it only probes **accounts** (so it cannot see case 3 at all), and it uses raw
`fetch` with no credentials, so it answers "can an anonymous visitor search here" — which is
the wrong question when the user is signed in and holds a token for that server.

## Deliverables

### 1. `search-server-probe.ts` gains a statuses canary

`probeSearchServer` keeps its signature and behaviour for the discovery path, but the
canary set grows a post query and the result grows a field:

```ts
export interface SearchServerProbe {
  status: SearchServerStatus;
  accounts: number;
  /** Whether full-text post search returned anything. Null when not probed. */
  statuses: number | null;
}
```

A server qualifies as a *search server* only when accounts **and** statuses come back
non-empty — that is the "search endpoint other than tags, enabled and returning results"
bar from the TODO. Hashtag search is explicitly not evidence: every server answers it,
including the ones with no index at all.

Post canary: a stop-word-ish common term (`the`) is a poor test because some configurations
strip it. Use a word that is both extremely common on Mastodon and not a stop word —
`mastodon` — and require ≥1 result.

### 2. `search-capability.ts` — "is search actually on here?"

New service. Answers the question **through `Api.search`**, not raw `fetch`, so it inherits
the interceptors: the bearer token when signed in, the search-server diversion when one is
configured, no token when anonymous. That is the only way the answer describes the request
the user's search will actually make.

**As shipped** (the sketch had one `accounts-only` state; two independent abilities turned
out cleaner, because "accounts-only" is a *combination* of the two, not a third value):

```ts
export type SearchAbility =
  'unknown' | 'checking' | 'works' | 'empty' | 'refused' | 'unreachable';

export interface HostCapability {
  accounts: SearchAbility;
  statuses: SearchAbility;
}
```

The accounts-only server is then `{ accounts: 'works', statuses: 'empty' }` — a fact about
each half rather than a label someone has to remember the meaning of.

- Keyed by effective search host. In-memory for the session only, **not** localStorage:
  a cached "search is broken here" that outlives a server fixing its index is a worse bug
  than the one we are fixing, and the reject list in deliverable 4 is a deliberate,
  user-clearable exception for a different purpose.
- `reset()` is called whenever the search server changes (adopted, discovered, or cleared),
  since the cached verdicts describe a host the requests no longer go to.
- **Probed lazily**, per decision 4: `search.ts` calls it only when a search completes with
  zero results. One extra call, on the one outcome where the answer matters.
- Deduped: concurrent callers for the same host share one in-flight promise.

### 3. The search page stops lying

Replace the bare `No results.` branch. Copy depends on what the probe found:

| Probe | Message |
|---|---|
| `works` | `No results.` — unchanged, and now it means something |
| `accounts-only` (post search) | `Post search is not available on <host>. This server can search accounts and hashtags, but has no full-text post index. Try a different search server.` + a link to the search-server picker |
| `refused` | `<host> does not allow anonymous search. Pick a search server to search from instead.` + the picker |
| `unreachable` | `Couldn't reach <host> to check. Your connection or the server may be having trouble.` |
| `checking` | `No results — checking whether search is available on <host>…` |

The message is inline where `No results.` is now, not a toast: it is an explanation of the
result the user is looking at.

Applies to both anonymous and authenticated. The `refused` wording differs when a token is
held (`does not allow search with your account` — the server may be restricting search to
local accounts, or the token may lack `read:search`).

### 4. `search-server-rejects.ts` — the persistent skip list

Discovery walks a ~1000-entry directory where most instances will fail the search bar. Not
remembering that means every hunt re-probes the same duds.

```ts
interface RejectedServer {
  domain: string;
  status: SearchServerStatus;  // why it failed
  rejectedAt: string;          // ISO
}
```

- One localStorage key, `mockingbird_search_server_rejects_v1`, sensitivity `setting`
  (it names hosts, but a list of "servers where search is off" is a config note, not a
  secret — same class as `mockingbird_search_server_v1`). **Registry entry required** or
  `npm run check:storage` fails the build.
- Capped (500 domains, oldest evicted) so a long-running browser can't grow it unbounded.
- `skip(domain): boolean` feeds the discovery exclusion set.
- `clear()` behind a button, per decision 6, and the UI states how many it is holding —
  an invisible cache with a Clear button is a mystery; `Forget 214 rejected servers` is not.

### 5. `search-server-discovery/` — the finder

A sibling of `server-discovery/`, following it closely on purpose (that component is
already mounted in two places, `login.html` and `settings-server.html`, so the pattern is
proven). Differences:

- Probes with `probeSearchServer` instead of `probeServerAvailability`.
- Requires accounts **and** statuses hits.
- Excludes the reject list on top of the current server and the in-session attempted set,
  and **records every failure into the reject list** as it goes.
- Reports the reason it rejected a candidate as it walks, because a hunt through fifty
  servers that just says "searching…" looks broken. `mastodon.example: search needs a login`
  scrolling past is the feature working.
- Same 3-worker concurrency and abort-on-found as `ServerDiscovery.runWorker`.

Mounted in two places, matching the existing precedent:
- `settings-server.html` — a new `Search server` section: current search server + status,
  the finder, the manual picker, and the reject-list Clear button.
- The search page's existing collapsible search-server box gains the finder alongside the
  manual entry it already has.

## Files

- `ui/src/app/search-server-probe.ts` — statuses canary, `statuses` field.
- **New:** `ui/src/app/search-capability.ts` + `.spec.ts`
- **New:** `ui/src/app/search-server-rejects.ts` + `.spec.ts`
- **New:** `ui/src/app/search-server-discovery/search-server-discovery.{ts,html,css}` + `.spec.ts`
- `ui/src/app/pages/search/search.{ts,html}` — zero-result branch, finder mount.
- `ui/src/app/pages/settings/server/settings-server.{ts,html}` — the Search server section.
- `ui/src/app/storage-registry.ts` — the reject-list key.

## Testing

Pure and heavily covered:

- **Probe classification.** 401/403/422 → `auth-required`; 200-with-empty → `no-results`;
  network throw → `unreachable`; accounts-hit-but-statuses-empty → the case-3 signature.
  Stubbed `fetch`, per the `DropboxSession` spec treatment.
- **Reject list.** add / dedupe by domain / skip / clear / cap-and-evict / survive a
  corrupt localStorage payload (`JSON.parse` of garbage must yield an empty list, not throw
  — every other store in this app does this and it is always the first bug).
- **`SearchCapability`.** In-flight dedupe (two callers, one request), and the
  `accounts-only` classification, which is the whole point.
- **Search page.** A zero-result search on a server whose probe says `accounts-only` renders
  the post-search-unavailable message and not `No results.`

`npx ng test --no-watch` (bare `npx vitest` does not work — see the roadmap's Testing note).
`npm run check:storage` and `npm run lint` must pass.

## Demo script

1. Anonymous, on a server with search disabled. Search anything. **Before:** "No results."
   **After:** "<host> does not allow anonymous search," with a way out.
2. Click **Find a search server**. Watch it walk the directory, rejecting servers out loud.
   Accept the one it finds. Re-run the search — results.
3. Settings → Server → Search server. It is holding N rejected servers. Click
   **Forget rejected servers**. Run the hunt again; it re-probes from scratch.
4. Signed in on a server without Elasticsearch, search posts: "Post search is not available
   on <host>." Switch the search type to Accounts; results appear. This is the spillover —
   the same fix, no anonymous mode involved.
