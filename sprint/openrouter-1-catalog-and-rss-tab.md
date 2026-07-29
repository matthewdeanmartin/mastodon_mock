# Sprint 1 — Connections becomes a catalog; RSS gets its own tab

**Goal:** make the Connections tab a browsable catalog of one-account connectors, each with
its own child page, and move RSS out to its own settings tab where it belongs. No new API
calls, no new dependencies, no behavior change to any existing connector — this is the
restructure that sprints 2–5 build on.

Covers overview decisions 3 and 4.

## Why this is sprint 1 and not sprint 5

`settings-connections.html` is 363 lines of six stacked `<section>` forms; the component is
266 lines holding four independent sets of busy/error/notice signals. OpenRouter would be the
seventh section, and it is the *largest* one — PKCE state, a searchable model picker over
~500 models, a credits readout, and two prompt-template editors. Adding it to the current
page means building the catalog anyway, later, with more to move.

Doing it first also means the catalog is proven by four existing connectors before OpenRouter
— the one with actual risk — ever touches it.

## The reframing

Today the tab answers *"here are six forms, fill in whichever you want."* After this sprint
it answers two questions in order:

1. **What can Mawkingbird connect to, and what does each one get me?** — the catalog.
2. **How do I set this particular one up?** — the child page.

That ordering matters because the interesting information (Raindrop gives you a second
bookmark provider; GitHub finds your GitHub friends on Mastodon) is currently buried inside
setup instructions the user has to read past.

## Deliverables

### 1. `connection-catalog.ts` — the catalog model (new)

`ui/src/app/pages/settings/connections/connection-catalog.ts`

```ts
export interface ConnectionCatalogEntry {
  /** Route segment under /settings/connections and the tracking key. */
  id: 'github' | 'dropbox' | 'raindrop' | 'bluesky';
  label: string;              // 'GitHub'
  emoji: string;              // '🐙'
  /** One sentence: what this service *is*, for someone who doesn't know. */
  pitch: string;
  /** What connecting it turns on in Mawkingbird. Two to four short phrases. */
  enables: string[];
  /** Whether the connector is usable in this build/account at all. */
  available: boolean;
}
```

The entry list is a `const` array of plain data. **Connected state is not in the entry** —
the component reads it from the injected sessions, because a `Signal<boolean>` in a
module-level const would drag every session into the catalog's bundle and defeat the lazy
child routes. The component maps `id → connected` in one small `switch`.

`available` covers what the current template already gates on: Bluesky behind
`capabilities.canUseBluesky`, Dropbox behind `dropbox.configured`. An unavailable entry still
renders — greyed, with the reason — rather than vanishing, so "why is Dropbox missing?" is
never a question.

Copy for the four entries (this is the user-facing payload of the sprint, so it is specified
here rather than left to implementation):

| id | emoji | pitch | enables |
|---|---|---|---|
| `github` | 🐙 | Your GitHub account, read-only. | Find GitHub friends on Mastodon · Read unread notifications |
| `dropbox` | 📦 | An app-specific folder in your Dropbox. | Browse files from Mawkingbird |
| `raindrop` | 💧 | The Raindrop.io bookmarking service. | A second bookmark provider · Save a post's first external link instead of the post |
| `bluesky` | 🦋 | Your Bluesky account, read and write. | Bluesky posts merged into home · Reply, like and repost from here · Bluesky DMs in Chat |

### 2. The catalog page — `settings-connections.{ts,html,css}` (rewrite)

Becomes short. It renders:

- The page head (kept, with the "Mastodon is home" framing — but the RSS clause drops out
  of the intro copy, since RSS is leaving).
- **A scope badge on every card** (added mid-sprint, from Matthew): "This account" /
  "All accounts" / "This tab only". Three values, not two, because Dropbox keeps its token
  in *unscoped `sessionStorage`* — it is neither per-account nor durable. The badge is a
  claim about how the session actually stores its credential, so `ConnectionCatalogEntry.scope`
  and the session's storage must be changed together; a spec pins the four current values.
  Each connector page repeats the claim as a full sentence under its heading.
- **The catalog list, first** (per Matthew: "I want there to be a catalog 1st"): one card per
  entry — emoji + label, a `Connected` / `Not connected` pill, the pitch, the `enables` list,
  and the whole card is a `routerLink` to `/settings/connections/<id>`.
- **The credential-retention section, unchanged, below the catalog.** It is policy that spans
  every connector, so it stays on the parent page rather than moving into any child — but
  it is a wall of text, and "what can I connect?" has to be answerable without reading it.
  Its body copy needs one edit: it currently says "or to RSS feeds, which carry no credential
  at all", which stops being relevant here.

The component keeps only: `capabilities`, the four sessions (for connected state), and
`lifetimes`. Every busy/error/notice signal moves to the child that owns it. The
`ngOnInit` Dropbox query-param handling moves to the **Dropbox child page** — that is where
`dropbox-callback` should land, so `dropbox-callback.ts`'s two `router.navigate` calls
retarget to `/settings/connections/dropbox`.

`lifetimes.govern([...])` **stays on the parent**, because the parent is the only component
guaranteed to be mounted when any connection page is open, and enforcement must not depend on
which child the user happened to visit.

### 3. Four child pages (new, lifted verbatim)

`ui/src/app/pages/settings/connections/{github,dropbox,raindrop,bluesky}/connection-<id>.{ts,html,css}`

Each is the corresponding `<section>` from today's template plus the signals and methods that
serve it, moved with as little edit as possible. Each gets:

- an `<h1>` with emoji + label,
- a back link to `/settings/connections`,
- the same copy, forms, error/notice paragraphs, and credential warnings as today.

The Dropbox child also absorbs the file-list modal (`dropboxEntries`) and the callback
query-param handling.

**Explicitly not a refactor.** Do not "improve" the copy, the error handling, or the forms
while moving them. Anything that looks wrong gets noted at the bottom of this file, not
fixed here — a restructure that also changes behavior is a restructure nobody can review.

Routes are lazy children of `settings/connections`, so a user who never opens Bluesky never
downloads it.

### 4. RSS moves to `settings/rss` (new)

`ui/src/app/pages/settings/rss/settings-rss.{ts,html,css}`

The RSS `<section>` becomes a full page with the feed form, the 10-feed cap note, the
error line, and the feed list — all lifted from today's template, plus a proper page head
explaining what RSS gives you and the CORS caveat that is currently buried in the section
copy.

Nav entry in `settings-shell.ts`, placed directly after Connections:

```ts
{ label: 'RSS feeds', path: 'rss', exact: true, anonymous: true },
```

Existing `RssSubscriptions` / `RssFetch` services are untouched; storage keys do not change,
so nobody loses a feed.

### 5. Link updates

- `pages/conversations/conversations.html:52` — "Settings → Connections" points at the
  Bluesky child now (`/settings/connections/bluesky`); it is talking about Bluesky DMs.
- `pages/dropbox-callback/dropbox-callback.ts` — both navigations retarget to
  `/settings/connections/dropbox`.
- `app.routes.ts` — `settings/connections` gains four lazy children; new `settings/rss`.

### 6. Specs

`settings-connections.spec.ts` (212 lines) is about the *forms*, so most of it moves to the
child specs along with the code it tests. What stays becomes a much smaller catalog spec:

- every entry renders, with the right connected/not-connected pill for a stubbed session,
- an unavailable entry renders greyed with its reason rather than disappearing,
- each card links to its child route,
- the retention radio group still writes through `CredentialLifetimeStore`,
- `govern()` is called with all four sessions on init.

New `settings-rss.spec.ts` takes the RSS assertions from the old spec.

Remember the shared jsdom realm (`ui/docs/shared-jsdom-realm-in-tests.md`) — the existing
spec's storage/global stubbing must move with it, not be re-invented per file.

## Acceptance

- `npm run test:ci`, `npm run lint`, `npm run check:storage`, and `npm run build` all pass.
- Connecting and disconnecting each of the four connectors works exactly as before,
  including the Dropbox OAuth round trip landing on the right page.
- Feeds added before the change are still listed under Settings → RSS feeds.
- Shortening the credential lifetime from the catalog page still disconnects an over-age
  GitHub/Raindrop/Bluesky credential immediately.
- No new localStorage keys (so `check:storage` should need no registry edit — if it does,
  something moved that shouldn't have).

## Explicitly deferred

- Any OpenRouter code. Sprint 2.
- Catalog search/filtering. Four entries, soon five.
- Reworking the credential-retention copy beyond deleting the RSS clause.
- Making `paste` providers (`providers/paste/`) catalog entries — they are configured
  elsewhere and pulling them in is its own decision.

## Noted while moving, deliberately not fixed

Observations from the lift. None were acted on; they are the input to a future cleanup.

1. **`.feed-error` is the error class on every connector page.** It is an RSS-era name that
   stuck when the sections were siblings in one stylesheet. Now that RSS has left, the
   connection pages are styling their OAuth failures with a class called "feed error".
   Rename to `.conn-error` — but that touches four templates and a spec selector, so it is
   its own change.
2. **`.coming-soon` in the old stylesheet was dead.** No template referenced it. Dropped
   rather than carried into any child file; noting it in case it was load-bearing for
   something outside this page.
3. **GitHub's template guards on `github.connected() && github.user()`** while every other
   connector guards on one signal. If those two can ever disagree, the page silently falls
   through to the "paste a token" form with a live token in storage. Worth collapsing into
   one derived signal on the session.
4. **The Dropbox file-list modal is hand-rolled** — backdrop, `role="dialog"`, and a close
   button, with no focus trap and no Escape handler. The app has a `confirm-dialog` and
   several other dialogs; whether they share a primitive is a question the tag/search helper
   dialogs (sprints 4 and 5) will have to answer anyway.
5. **`AnonymousCapabilities.canUseBluesky` is read in two places now** (catalog row and the
   Bluesky page). That is correct but means adding a capability-gated connector means
   remembering both. If a third gated connector appears, the gate belongs on the catalog
   entry as a token the page can also resolve.

## Deviations from the plan as written

- **Child pages call `enforceLifetime()` on their own session in `ngOnInit`.** The plan said
  `govern()` stays on the parent because the parent is always mounted — but with a
  componentless parent route (chosen so a connector page *replaces* the catalog rather than
  nesting under it) there is no parent component, and a deep link to
  `/settings/connections/github` would mount no page that had ever enforced retention. The
  catalog still owns `govern()` for the policy picker; each child additionally re-checks
  itself. This is new behavior, and it is the conservative direction.
- **`expiryLabel` became a shared free function** (`connections/expiry-label.ts`) rather than
  being copied into three components. Same output, same sentence.
- **The Bluesky page renders an explanation when `canUseBluesky` is false** instead of the
  old behavior, where the whole section vanished for Anonymous. Consistent with the catalog's
  "unavailable is a state, not a removal" rule.
