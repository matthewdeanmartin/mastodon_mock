# Write — Sprint 5: sources (Gist, and Mataroa both ways)

Status: PLANNED (written 2026-08-08, after sprints 1–4 shipped)

Read `write-0-overview.md`, then the **Delivered** and **Found while implementing** sections of
sprints 1–4. The last sprint of this epic.

## Product premise

Sprints 1–4 built where you write, what you write beside, how you publish, and how you triage.
This sprint is about where a draft can *come from* and *go back to*.

Two things, both of which turn a one-way street into a round trip:

1. **GitHub Gist as a draft source.** A gist is already how a lot of people park a piece of writing
   they are not ready to publish — versioned, private if you want, reachable from any machine. It
   is a fifth draft kind in everything but name.
2. **Mataroa both ways.** `MataroaApi.createPost()` publishes. `MataroaApi.listPosts()` exists and
   **is already called** by the connection settings page — but nothing in the writing surfaces
   reads it, so a published post can never be pulled back for editing.

## What sprints 1–4 leave you

### Verified present

- **`GitHubSession`** (`providers/github/github-session.ts`) — a browser-only GitHub REST session
  on a user-supplied **classic PAT**, account-scoped, already an `ExpiringConnection`. It exists for
  the Hugo connector's benefit and knows nothing about gists yet.
- **`MataroaApi`** (`providers/mataroa/mataroa-api.ts`) — `listPosts()` and `createPost()`.
  `listPosts()` has exactly one consumer today: `connection-mataroa.ts:65`, which uses it to prove
  the credentials work. **There is no update or delete method.**
- **`DraftSources`** (`pages/drafts/draft-sources.ts`) — the four-kind merge, per-source error
  isolation, anonymous fast path. A fifth kind goes here.
- **`DraftItem` / `DraftSource`** (`pages/drafts/draft-items.ts`) — the discriminated union every
  surface reads, and `toSnapshot()`, the one place a kind becomes editable text.
- **`WriteWorkspace`** — sidecar keyed by `DraftItem.key`. A new kind gets its columns and split
  mode for free, provided its key is unique.
- **`CorsProxy` + `ProxyConsent`** — Mataroa goes through a consented proxy
  (`mataroa-api.spec.ts` shows the shape). **`api.github.com` is CORS-open for writes** and needs
  no proxy — that is a recorded finding, not a guess.

### The shape a new draft kind has to fill

Adding `gist` means touching, in order: `DraftKind`, a `DraftSource` variant, a `gistDraftItem()`
builder, a `toSnapshot()` case, `DraftSources` loading and error handling, the filter chips on
`/drafts` and `/write`, and `removalCopy()` on `/drafts`. That list is the honest cost. Nothing in
sprints 1–4 needs changing beyond it, which is the payoff for the union having been kept honest.

## Stories

### S5.1 — Gist as a draft kind

`providers/github/gist-api.ts` — list, read, create, update. Scoped to the authenticated user's own
gists; nothing about other people's.

Which gists count as drafts is the design question, and the answer must be **conservative**: this
reads a real account's real gists, and treating someone's config snippets as unpublished writing
would be the same class of mistake `isSelfDraft` was careful to avoid. Start with:

- The gist is **private** (secret), and
- it has exactly one file, and
- that file is `.md` or `.txt`.

Say the rule in the UI, because it will surprise someone. A "these are the gists I can see" count
next to the filter chip does more good than a cleverer heuristic.

### S5.2 — Editing a gist and writing back

Opening a gist draft loads it into the editor. **Saving writes back to the gist** — this is the
first draft kind where "the original" is somewhere editable, and it changes the load rule that
sprints 1–2 held to.

That rule was: *local continues in place, everything else copies*. It was right when the other
kinds were a scheduled post, a `direct` post and a paste, none of which can be updated in place.
A gist can. So this sprint **extends** the rule rather than breaking it:

> A draft is continued in place when its source can be written back to. Otherwise it copies.

Local and gist continue in place; scheduled, self and paste still copy. Make that explicit in
`DraftItem` — a `writable: boolean` or a `canUpdate` predicate — rather than letting each surface
re-derive it from `kind`. Three surfaces already ask this question.

**The boss's standing note applies here:** save-as-copy vs save-as-edit deserves explicit UI, and
some targets cannot be edited at all. This sprint should not build that UI, but it should stop
making the decision silently — at minimum the editor says which one saving will do.

### S5.3 — Mataroa: read back and edit

Consume `listPosts()` in the writing surfaces, so a published Mataroa post can be pulled into the
editor.

**`MataroaApi` has no update method.** Check the real API before designing the flow — if there is
no update endpoint, "edit a published post" means create-and-delete, and that is a materially
different promise with a different failure mode (a failed delete leaves two copies). Find out
first; the story is not "add an update button" until the endpoint is confirmed.

A published post is **not a draft** and must not land in the drafts list. Give it its own surface —
the board's Scheduled column is the precedent for "shown, but not a thing you drag".

### S5.4 — One connections story

Both connectors already have settings pages. This sprint adds: what the gist rule is, how many
gists match, and — if S5.3 finds an update endpoint — that editing a published post is possible.

Nothing new in the connections *framework*. If it feels like it needs one, that is a sign this
sprint has grown.

### S5.5 — Coverage

- The gist predicate: a private single-`.md` gist qualifies; a public one, a multi-file one, and a
  `.json` one do not. Assert the negatives — that is where the privacy-shaped mistake lives.
- `toSnapshot()` for a gist round-trips the body.
- Saving a gist draft issues an update, not a create, and the gist id is unchanged.
- The `writable` distinction: a gist continues in place, a paste still copies. Assert the paste's
  source survives.
- Anonymous: no gist requests, no Mataroa requests, and the other four kinds still list.
- A failing gist load leaves the other kinds visible (the `DraftSources` isolation property).

## Traps

Every one hit for real in this epic:

- **`npm run test:ci` only**; `-- --update` after adding or renaming specs. **Never format and test
  in one shell invocation.**
- `as Status` on a partial fixture fails the build (`TS2352`) — use `as unknown as Status`.
- `httpMock.verify()` does not prove "issued no requests of its own"; two services already scan
  `/accounts/:id/statuses` on `/write`. Use `flushStatusScans()`, and assert
  `httpMock.match((r) => r.method === 'POST')` is empty to prove nothing published.
- Vitest fetch traps: `restoreAllMocks` keeps call logs; a reused `Response` body reads once.
- `ClientPrefs` persists through a constructor effect — never call `persist()` yourself.
- Anything through `[innerHTML]` must be escaped first; nothing here is server-sanitized.
- **A PAT is a secret.** `github-session.ts` already splits the stored profile from the stored
  token for exactly this reason — follow it, and check `storage-registry.ts`.
- Do not add `ad-*` class names. Never say "X" — it is Twitter.

## Definition of done

`npm run lint`, `npm run format:check`, `npm run test:ci`, `npm run build`,
`npm run build:mockingbird` all pass. Append **Delivered** and **Found while implementing**
sections. This closes the epic — the final entry should also update `write-0-overview.md` with an
honest list of what the epic did *not* do.