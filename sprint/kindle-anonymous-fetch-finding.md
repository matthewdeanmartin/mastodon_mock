# Finding — remote posts are fetched without credentials, even when signed in

Status: **FIXED** (2026-09-04) for the reader path. The profile page still has it.
Raised by: matthewdeanmartin, 2026-09-04, while testing [[kindle-2-library-and-progress]]
Related: [[kindle-0-overview]]

## The question

> "Why are we fetching posts anonymously when we are not anonymous? That's how
> you fail to view restricted posts, that might be limited to followers."

Correct on both counts. Here is what is actually happening.

## What "anonymous" means here, and why the name misleads

`provider: 'anonymous-mastodon'` does **not** mean "the reader is signed out".
It means *this post was read directly from a server we hold no account on*. A
signed-in user gets these. `providers/provider.ts` already flags the name as a
misnomer in a comment; this report is what it costs.

## The mechanism

`AnonymousPublicApi` (`providers/anonymous/anonymous-public-api.ts`) issues
requests straight at the origin server:

```ts
this.http.get<Status>(`${ref.server}/api/v1/statuses/${ref.id}`, {
  context: externalFetch(),
})
```

`externalFetch()` sets `EXTERNAL_FETCH`, and `auth.interceptor.ts` reads that
flag to **deliberately withhold the bearer token** — correctly, because the
token belongs to the home server and sending it to graz.social would be a
credential leak.

So the request is unauthenticated by design. The consequence the operator
identified follows directly:

- **Followers-only and unlisted posts are invisible.** The remote server has no
  idea who is asking, so it serves only what is public.
- **Instance-blocked or authorized-fetch servers refuse outright.** A growing
  number of instances require a signed request for any status fetch.
- **The reader sees a 404 or a thin thread** and has no way to know that the
  post exists and they are entitled to it.

## Where a signed-in session ends up on this path

Every *feed* path is properly gated on `auth.isAnonymous`:

- `AnonymousMastodonProvider.linked` — gated.
- Search's anonymous fan-out (`AnonymousCapabilities.active`) — gated.

The gap is in **routing by id**. Two places send a request down the anonymous
path purely because of the id's shape, with no session check:

1. `pages/profile/profile.ts:992` — `parseAnonymousAccountRouteRef(id)` →
   `loadAnonymousPublicProfile(ref)`, unconditionally.
2. `pages/read/thread-loader.ts` (and the thread page before it) —
   `parseAnonymousStatusRouteRef(id)` → `loadAnonymousPublic(ref)`,
   unconditionally.

Those ids are minted by `status-card.ts` while browsing anonymously, or by a
search against a search-server, and then persist: in browser history, in a
bookmark, in a hand-copied address bar — and now, in the reader's library.
Signing in afterwards does not change what the id says, so a signed-in reader
following their own old link is silently served the credential-free path.

**Not, however, in anything shared.** The share dialog uses `status.url` — the
origin permalink (`https://graz.social/@user/117…`) — and never emits a
Mawkingbird `/read/anonymous-status.<blob>` URL. These ids are in-app only.

## What the fix would be

Mastodon already has the right mechanism: `GET /api/v2/search?resolve=true`
against the **home** server. It federates the fetch, applies the reader's
identity, and returns a local id for the post — which is then an ordinary
status, readable in full, replyable, boostable.

`api.ts:528` already implements `resolve`. The work is a resolution step:

```
signed in + an anonymous-* id  →  resolve originalUrl on the home server
                                  ├─ resolved → load it as a normal status
                                  └─ failed   → fall back to the public fetch,
                                                and say which happened
```

The fallback matters. Resolution fails legitimately — the home server may not
federate with that instance, or may be slow — and dropping to a public read is
better than nothing, provided the reader is told the post may be partial.

## What was done

Implemented in `pages/read/thread-loader.ts` as `loadPublicPost`:

```
an anonymous-* id  →  have a Mastodon token, no search server, and an origin URL?
                      ├─ yes → resolve it on the home server
                      │        ├─ resolved → load as an ordinary status,
                      │        │             context by its local id
                      │        └─ unknown or failed → fall back to the public read
                      └─ no  → public read, as before
```

When resolution succeeds the post is an ordinary local status: `isAnonymousPublic`
stays false, so it is replyable, boostable and favouritable — correct, because on
your server it now *is* one. The context call uses the local id too, which
surfaces replies your server has federated and the remote would never have shown
an unauthenticated caller.

The fallback is kept because resolution legitimately fails — a server may not
federate with that instance, or may be slow, or the post may be public and simply
unknown to it. Falling back beats an error, and the reader keeps whatever the
remote will give.

Seven tests in `thread-loader.spec.ts`.

### Two earlier reasons for deferring, both withdrawn

Recorded because they were offered and neither survived scrutiny.

**"It costs a request per open."** True but irrelevant — the app economizes
against *paid third-party* APIs (Twitter, the CORS proxy), which is where those
cost comments live. Your own home server is not that, and this feature already
spends a context call per open without comment.

**"It changes what a shared link means."** Simply wrong. The share dialog emits
`status.url`, the origin permalink; no `anonymous-status.` id ever leaves the
app. These ids live only in the route, history, bookmarks and the library.

**"It is a federation change."** Also overstated, and the phrasing mattered: the
federation is Mastodon's and happens server-side regardless. All that changed
here is which of our *own* endpoints we call for a post whose URL we already
hold — `api.search(..., { resolve: true })`, one existing method. A routing fix.

## Still open: the profile page

`pages/profile/profile.ts:992` dispatches `anonymous-account.*` ids to
`loadAnonymousPublicProfile` with no session check, exactly as the thread loader
used to. A signed-in reader opening such a profile still gets a credential-free
read of the account and its posts, so followers-only posts are missing there too.

Not fixed here because a profile resolves an *account* rather than a status —
`resolve=true` with `type: 'accounts'` on the handle — and because it belongs to
the profile page rather than to the reader. The mechanism is the same and the
fix should mirror this one.

## Two other bugs found on the same path

Both surfaced by the operator's report, both independent of the above:

- **`adaptAnonymousStatus` namespaced `id` but not `in_reply_to_id`**, so no
  post in a remotely-read thread could be matched to its parent. Reply
  threading was broken everywhere those posts appear; the visible symptom was a
  two-post storm rendering as one post in the reader.
- **The feed id and the route id are different strings**, and the library stored
  the feed one, producing rows whose links 404. Now goes through
  `pages/read/reader-route-id.ts`, and `ThreadLoader` additionally accepts the
  feed form so existing entries and stray links resolve.
