# Hugo — Sprint 1: Connect a repo, publish a post

Status: COMPLETE (implemented 2026-08-05; 3202 tests, lint, prettier and both builds clean;
90 tests added). Roadmap: `hugo-0-overview.md`.

## What changed during implementation

- **A `hugo-validate.ts` appeared that the plan did not name.** Exit criterion 1 said
  "validates all four against the live API", and putting that in the connector component
  would have made it untestable. It is its own service, and it borrows the candidate
  connection: `HugoContents` reads its coordinates from `HugoSettings`, so validation
  temporarily stores the candidate and restores the previous connection (or none) in a
  `finally`. That restore is what makes a failed "Connect" a true no-op, and it has its
  own test.
- **`hugo-token.ts` was never written.** The plan split the credential into its own file
  by analogy with `GitHubSession`, but the token has no behaviour of its own here — no
  profile fetch, no proof call. It is two localStorage keys and a getter, so it lives in
  `hugo-settings.ts` with the repo half. The two-key storage split the plan asked for is
  intact; only the file count changed.
- **`enforceLifetime()` drops the token but keeps the repo.** Not in the plan. The repo
  coordinates are not a secret, and discarding them would turn "reconnect" from one paste
  back into a five-field form. The composer already gates on `connected()`, which requires
  both halves, so the half-state is safe — and the connector page names it explicitly.
- **`normalizeSiteUrl` had a real bug the spec caught**: `ftp://example.com` has no
  `http://` prefix, so the prepend step turned it into `https://ftp//example.com` rather
  than rejecting it. Now the scheme is validated before a default is applied.
- **An existing spec helper had to be fixed.** `settings-connections.spec.ts`'s
  `cardFor()` matched any text inside a card, so the Hugo card — whose copy mentions a
  GitHub token — started matching `cardFor(…, 'GitHub')`. It now matches on
  `.catalog-label`, the card's actual heading. The governed-credential count moved 9 → 10.
- **Both blog-target error paths were consolidated.** `send()` had an inline ternary
  choosing between the Mataroa and Blogger "reconnect" messages, which a third blog would
  have turned into nested ternaries. It is now a `Record<BlogTarget, string>`, and
  `isBlogTarget()` narrows to that type so a fourth blog is a compile error until its copy
  is written.
- **Spec helpers filter `fetch` calls by host and method.** TestBed construction fires
  unrelated fetches (bundled server list, joinmastodon), and reads share the mock with
  writes, so positional indexing into `mock.calls` was unstable. Worth knowing for
  sprint 2, which has both reads and writes in the same tests.
- **Do not run `npm run format` and `npm run test:ci` in one shell invocation.** Prettier
  rewrites spec files while the run is reading them, producing failures that vanish on a
  clean re-run. Run the gates sequentially.

The spine sprint. When it lands, a user with a Hugo site on GitHub can write in the
Mawkingbird composer, hit publish, and have a commit appear in their repo that Actions
builds into a live post. Everything after this sprint is refinement of a working path.

## Exit criteria

1. `Settings → Connections → Blog (Hugo)` accepts a fine-grained PAT, an owner/repo, a
   branch and a content path, and **validates all four against the live API** before
   saving anything.
2. The composer's target picker offers `✍️ Hugo` when connected + flagged on, requires a
   title (the CW box, like every blog target), and rejects media/polls/threads/scheduling
   — all inherited, no new branching.
3. Publishing commits `content/posts/<slug>.md` with TOML front matter and emits a local
   `Status` that renders in the timeline with the `✍️ Blog` badge.
4. A slug that already exists does not silently overwrite. See "Collisions".
5. Specs green, lint and prettier clean, both builds clean.

## The credential (decision 1)

A **separate** token from `GitHubSession`'s. That service keeps its read-only PAT and is
not touched by this sprint.

New: `providers/hugo/hugo-token.ts`, modelled on `GitHubSession`'s storage split
(`github-session.ts:16-17, 389-416`) — the token is `secret`, everything else is `private`
— but much smaller, because there is no user profile to fetch and no proof to run.

Setup copy on the page must ask for a **fine-grained** token, not classic, with:

- Repository access: **only** the Hugo repo.
- Permissions: `Contents: Read and write`. (Add `Actions: Read` now, in the same
  instruction, so sprint 4 doesn't force a token re-issue. Say what each is for.)

Link straight to `https://github.com/settings/personal-access-tokens/new`. Fine-grained
tokens cannot be scope-prefilled by URL the way classic ones can, so the instructions have
to be a real list, not a magic link — write them out.

Two storage-registry rows, mirroring the GitHub pair:

| base | suffix | sensitivity | note |
|---|---|---|---|
| `mockingbird_hugo_credentials` | `account` | `secret` | Fine-grained GitHub PAT with write access to the Hugo repo. |
| `mockingbird_hugo_repo` | `account` | `private` | Hugo repo coordinates: owner, repo, branch, content path, site URL. |

`account`-scoped, same reasoning as Mataroa's row: a blog is part of one public persona.
Both go under `credential-lifetime` (`stampCredential` / `enforceLifetime`) exactly as
`MataroaSettings` does — this is not optional, the connections page enforces a retention
policy across every connector and an unstamped credential is a hole in it.

## `hugo-settings.ts`

```ts
export interface HugoConnection extends ExpiringCredential {
  owner: string;          // 'mistersql'
  repo: string;           // 'my-blog'
  branch: string;         // 'main' — the branch Pages builds from
  contentPath: string;    // 'content/posts' — normalized, no leading/trailing slash
  siteUrl: string | null; // 'https://mistersql.github.io/my-blog/' — for permalinks
}
```

`siteUrl` is nullable and asked for as an optional field: it is needed only to *predict* a
permalink, and a wrong guess is worse than no link. If absent, the published Status links
to the file on GitHub instead — which is honest and always correct.

Normalization is pure and tested: strip `https://github.com/` if the user pastes a repo
URL into the owner box (they will), split `owner/repo` if pasted whole (they will do this
too), trim slashes off the content path, and reject an empty branch.

## `hugo-contents.ts`

Three calls, all `https://api.github.com`, all with
`Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
`X-GitHub-Api-Version: 2026-03-10` — copy the header block from `github-session.ts:355-362`
rather than reinventing it.

```ts
listDirectory(path: string): Promise<HugoDirEntry[]>   // GET contents/{path}?ref={branch}
readFile(path: string): Promise<{ text: string; sha: string }>
putFile(args: {
  path: string; text: string; message: string; sha?: string;
}): Promise<{ commitSha: string; contentSha: string; htmlUrl: string }>
```

**`sha` is the whole concurrency story.** Omit it → GitHub creates the file, and 422s if
it already exists. Supply it → GitHub updates, and 409s if the file moved on since. That
is precisely the behaviour we want, so sprint 1 passes no `sha` (always a create) and
sprint 2 adds the update path. Do not invent a read-then-write "check if exists" dance;
let the 422 be the answer.

### Base64 is the trap

`content` goes up base64 and comes down base64. `btoa(text)` **throws** on any character
above U+00FF, which means the first em-dash or emoji in a post breaks publishing. Encode
through bytes:

```ts
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
```

And decode symmetrically with `TextDecoder` for sprint 2. A spec with an em-dash, an
emoji and a CJK character in the body is a required test, not a nice-to-have.

Also: GitHub returns the download `content` with newlines injected every 60 chars. Strip
whitespace before decoding.

## `hugo-front-matter.ts` (pure)

TOML, per decision 4. Generated by a small serializer, never by template string:

```
+++
title = "..."
date = 2026-08-05T14:31:00Z
draft = false
tags = ["...", "..."]
+++
```

- Strings are escaped for `"` and `\` and any control character; a title containing a
  newline gets it collapsed to a space (a multi-line TOML basic string is legal but there
  is no reason to emit one from a one-line title field).
- `date` is RFC 3339 — the composer's post time, not the commit time.
- `draft` comes from the composer's existing `blogDraft` signal, which currently only
  Blogger reads (`compose.ts:749`). Hugo has a native `draft` concept, so wire it: it is
  the same checkbox, and the composer already clears it when leaving a blog target.
- `tags` from hashtags found in the body. Hugo tags conventionally do not carry `#`, so
  strip it. Leave the hashtags in the body too — that's what the author wrote.

The parse direction (`parseFrontMatter`) also lands here in sprint 1 even though only
sprint 2 consumes it, because it is the natural place for its tests and it keeps sprint 2
about UI. Parse must survive: no front matter at all, `---` YAML front matter (a
pre-existing post from a template repo — recognize it and refuse to *rewrite* it as TOML,
preserving whatever it was), and unknown keys (round-trip them untouched).

## `hugo-post.ts` (pure)

Slug rules, and they need to be boring and predictable:

- lowercase, NFKD-normalize, strip diacritics, non-alphanumerics → `-`, collapse runs,
  trim `-`, cap at ~60 chars on a word boundary.
- **Empty result is a real case** (a title of only emoji, or only CJK — the latter is
  common and must not produce garbage). Fall back to the date plus a short random suffix,
  e.g. `2026-08-05-a7f3`, rather than failing the publish.
- File path = `${contentPath}/${slug}.md`.

Plus `hugoStatus()`, the third sibling of `mataroaStatus()` and `bloggerStatus()`. Same
shape (see `mataroa-status.ts`), with:

- `provider: 'blog'`, `providerRef: { providerId: 'hugo', path, contentSha, commitSha }`
- `id: 'blog:hugo:' + slug`
- `url`: the predicted permalink if `siteUrl` is set, else the GitHub `htmlUrl`.
- `application: { name: 'Hugo', website: 'https://gohugo.io/' }`

## Collisions (exit criterion 4)

Publishing "My Post" twice must not overwrite the first one. The create-without-`sha` PUT
already 422s, so the work is turning that into a good experience: catch the 422, and
publish again as `<slug>-2` (then `-3`), telling the user in the success notice which slug
it actually got. One retry step, capped — three collisions in a row means something else
is wrong and the error should surface.

## Wiring checklist

Small, mechanical, and easy to half-finish — so it is a list:

- `feature-flags.ts`: `FeatureFlagId` += `'connector-hugo'`, plus its catalog entry.
  Description: "Publishing posts to a Hugo site in a GitHub repo."
- `connection-catalog.ts`: `ConnectionId` += `'hugo'`; `CONNECTION_FLAGS.hugo`; a
  `CONNECTION_CATALOG` entry — label `Blog (Hugo)`, emoji `✍️`, scope `account`, pitch
  "Your own static site on GitHub, published from the composer." Place it next to the
  other two blog entries. `enables`: publish Markdown from the composer / your posts stay
  files in a repo you own / needs a GitHub token, no CORS proxy.
- `app.routes.ts`: lazy child route `hugo` under `connections`, matching the pattern at
  `:212-223`.
- `settings-connections.ts`: add `hugo` to the `id -> connected` map.
- `compose.ts`: `PostTarget` += `'hugo'`; `isBlogTarget()` (`:73`) += it; a
  `targetIsHugo` computed mirroring `targetIsBlogger` (`:733`); fold into
  `targetIncludesBlog` (`:742`); guard in `onTargetChange` (`:938`); a case in the target
  resolver (`:1426`); `sendToHugo()` alongside `sendToBlogger()`.
- `drafts.ts:35`: the persisted `target` union += `'hugo'`.
- `compose.html`: the target option, gated like the other two.

## Test notes

- Pure modules first and heaviest: front matter escaping, slug edge cases, path
  normalization, base64 round-trip.
- `hugo-contents` with `HttpTestingController`: create, 422-then-retry, 401 (clear the
  token, same as `GitHubSession` does at `:185-188`), 404 (repo/branch gone → a message
  that names which).
- Composer spec: the target appears only when connected *and* flagged on; a publish with
  no title cannot submit; a successful publish emits a Status with the `blog:hugo:` id.
- Validation spec for connect: bad token, repo not found, branch not found, content path
  not found — four distinguishable messages. This is the part users will actually hit.

## Handoff note

If this sprint stops half-done, the seam to stop at is **after `hugo-contents.ts` + the
pure modules + their specs, before the composer wiring**. The connector page alone
(connect, validate, disconnect) is shippable and useful on its own, and the composer
changes are the part that touches a file everything else depends on.
