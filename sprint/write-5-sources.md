# Write — Sprint 5: sources (Gist, and Mataroa both ways)

Status: **PARTIALLY COMPLETE** — S5.1/S5.2 (Gist) done 2026-08-08, **as a paste provider, not as a
draft kind**. S5.3 (Mataroa both ways) and S5.4 not started.

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

### ~~The shape a new draft kind has to fill~~ — SUPERSEDED

> This section planned Gist as a **fifth draft kind**, listing the eight places that would need
> touching. **The boss reversed it: a gist is a paste, and Gist is a paste provider.**
>
> That was the better call, and the reason is the one line that makes this whole epic cheaper:
> **every paste provider is already a draft source.** `PasteHistory` feeds `pasteDraftItem`, which
> feeds `DraftSources`, which feeds `/drafts`, the workspace draft list, and the kanban board. A
> gist therefore appears in all of them with **zero** drafts-side code — against the eight files the
> draft-kind plan would have touched.
>
> Implemented as `PasteProvider`, the cost was: two new provider files, one registry entry, one
> catalog entry, one settings page, two storage-registry rows. Nothing in `pages/drafts/` or
> `pages/write/` changed at all.

## Stories

### S5.1 — Gist ~~as a draft kind~~ **as a paste provider** ✅ DONE

> Rewritten to match what shipped. The original text planned a `gist-api.ts` and a conservative
> "which gists count as drafts" predicate over the user's whole gist history. **That is not what was
> built, and the difference matters:** modelled as a paste provider, Gist only ever surfaces gists
> *this app created* (through `PasteHistory`), so the question "is this someone's config snippet or
> their unpublished writing?" never arises. The privacy-shaped mistake the original was worried
> about is designed out rather than guarded against.
>
> `recent()` does list the account's own gists — it is part of the `PasteProvider` contract — and
> there the single-file rule applies: a multi-file gist is a project, not a note.

**Delivered:**

- `providers/paste/gist-provider.ts` — full `PasteProvider`: `create`, `update`, `delete`,
  `recent`, `status`, plus `whoami()` for the connection page.
- `providers/paste/gist-settings.ts` — its **own** token, deliberately not `GitHubSession`'s and
  not Hugo's, following `HugoSettings`' recorded reasoning: one leaked string must not reach more
  of the account than the feature it belongs to. Needs the `gist` scope and nothing else.
- Registry entry, conditional on a connected token (the `ShortenerPasteProvider` precedent).
- `/settings/connections/gist`, catalog entry, two `storage-registry.ts` rows.

**Mappings decided:**

| Paste concept | Gist reality |
| --- | --- |
| `unlisted` | a *secret* gist — unlisted, but readable by anyone with the link. Not private. |
| `public` | a public gist, listed on the GitHub profile |
| language | becomes the **filename extension**; GitHub has no language field |
| expiry | `never` only. Gists have no TTL and no burn-after-reading. |
| `editKey` | empty. The account token is the authority, as with the shortener provider. |

### ~~S5.1 (original) — Gist as a draft kind~~

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

### S5.2 — Editing a gist and writing back ✅ **DONE, and simpler than planned**

> The original text below worried that a writable source breaks the sprint-1/2 load rule ("local
> continues in place, everything else copies") and proposed a `writable` flag on `DraftItem`.
>
> **Modelling Gist as a paste made that unnecessary.** `PasteProvider` already has `update()` and
> `delete()`, and the Pastes page already knows which providers are `immutable`. A gist is simply a
> mutable paste — the same category Rentry is in — so the existing machinery covers it and no new
> concept was added.
>
> The boss's save-as-copy vs save-as-edit note still stands as unbuilt UI, and it now has a cleaner
> home: it is a *paste* question ("does saving rewrite the paste or make a new one?"), not a draft
> question. Sprint 6 material.

### ~~S5.2 (original) — Editing a gist and writing back~~

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

**`MataroaApi` has no update method** — but the *API* does. **Settled 2026-08-08** from the real
docs, captured at `docs/reference/mataroa-api.md`:

- **`PATCH /api/posts/<slug>/`** exists, taking any of `title`, `slug`, `body`, `published_at`. So
  "edit a published post" is a genuine update, **not** the create-and-delete this story feared —
  no two-copies-on-failure mode to design around.
- **`GET /api/posts/` returns full bodies**, not just metadata. Pulling a post into the editor is
  one request, with no per-post follow-up.
- **`published_at: null` means draft.** Mataroa has real drafts, which makes it a plausible source
  alongside the paste providers — worth considering, out of scope here.
- Every path needs its **trailing slash**, and `published_at` is a date (`YYYY-MM-DD`), not a
  timestamp. Sending it empty unpublishes.

The story is now simply: add `updatePost()` and consume `listPosts()` in the writing surfaces.

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

---

## Delivered (Gist half, 2026-08-08)

| File | What it is |
| --- | --- |
| `providers/paste/gist-provider.ts` (+spec) | `GistProvider` — a full `PasteProvider` over the GitHub Gist API. |
| `providers/paste/gist-settings.ts` (+spec) | Its own `gist`-scoped token, split credential/profile. |
| `pages/settings/connections/gist/connection-gist.{ts,html}` | Connect, prove, disconnect. |

Changed: `paste-provider-registry.ts` (entry + conditional availability), `connection-catalog.ts`
(`gist` id, entry, flag mapping), `settings-connections.ts` (connected state + lifetime governance),
`storage-registry.ts` (two rows), `app.routes.ts` (child route).

**Nothing under `pages/drafts/` or `pages/write/` was touched.** That is the headline.

## Found while implementing

**The paste-provider framing removed a whole design problem.** The draft-kind plan needed a
predicate deciding which of someone's real gists count as "unpublished writing" — the same shape as
`isSelfDraft`, and the same risk of misreading private material. As a paste provider, only gists
this app created are ever treated as drafts, so the question never comes up.

**The `pastebin` flag, not a new connector flag.** What Gist turns on is one more paste provider,
so turning pastes off must take it along. `CONNECTION_FLAGS` maps `gist → 'pastebin'`.

**Prove the token, then store it — in that order.** The first version stored the token and then
called `recent()` to check it, disconnecting on failure. Cleaner not to write a bad credential at
all: `whoami()` takes the token as an argument rather than reading settings, so `/user` both
validates it and returns the login the provider names itself with.

**The connections spec counts governed sessions and asserts by identity.** Adding Gist correctly
failed `expect(governed).toHaveLength(10)` — the guard doing its job. Updated to 11 *and* added the
identity assertion, since the file's own comment says a bare length check "passes just as happily
when a connector is swapped for the wrong one."

**A gist has no per-paste secret**, so `editKey` is stored empty — exactly what
`ShortenerPasteProvider` does, and for the same reason: the account credential is the authority.

## Verification

- `npm run lint`, `npm run format:check` — pass.
- `npm run test:ci` — **3682 tests pass, 0 fail** (29 added). Manifest updated.
- `npm run build`, `npm run build:mockingbird` — pass.

## Still to do in this sprint

- **S5.3 — Mataroa both ways.** Unstarted, but no longer uncertain: the API reference is captured
  at `docs/reference/mataroa-api.md`, and `PATCH /api/posts/<slug>/` exists. `MataroaApi` needs an
  `updatePost()`, and `listPosts()` needs a consumer outside the settings page.
- **S5.4 — one connections story.** Gist has its page; Mataroa's needs the read-back copy once S5.3
  lands.
- **Not smoke-tested against a real GitHub account.** Every gist call is `HttpTestingController`
  only. Unproven: whether `PATCH` with a renamed file behaves as assumed (renaming a gist's only
  file while changing its content), and whether `per_page=30` is a sensible listing depth.
- **Save-as-copy vs save-as-edit UI**, now correctly a paste-level question.