# Roadmap — Hugo on GitHub as a blog destination

Status: PLANNED (2026-08-05). Decisions below are answered — see "Decisions taken".
Sprints: `hugo-1-*` … `hugo-4-*`. POSSE/webmentions is named here but has no sprint
files yet, deliberately (decision 8).

## The pitch

Mawkingbird can already publish a post to two blogs — Mataroa (`provider: 'blog'`) and
Blogger (`provider: 'blogger'`). Both are *hosted* blogs: you hand a service an API key
and it owns your content. The third blog connector is different in kind, and that is the
whole point of building it.

**A Hugo site in a GitHub repo is a blog you own outright.** Publishing a post is a file
commit. The "publish" step is `PUT /repos/{owner}/{repo}/contents/{path}` and the rest is
GitHub Actions building a static site. There is no blog API, no vendor, no account that
can be closed. That fits Mawkingbird's standing constraint better than either existing
blog connector does: no backend of ours, no backend of theirs.

It is also the only blog target where **the write path needs no CORS proxy**. Mataroa
writes go through an explicitly-consented proxy (`mataroa-api.ts:50-86`) because
mataroa.blog does not send CORS headers. `api.github.com` does, for reads *and* writes.
That is the single most important fact in this roadmap: it makes the Hugo connector the
cheapest and most reliable of the three, despite feeling like the most exotic.

And once your posts are files in a repo you control, the door opens to POSSE — publishing
your own replies, likes and reposts to your own site first and notifying the other site
after. That is the destination. It is not the MVP.

## What ships

| Sprint | The user gets | Built on |
|---|---|---|
| 1 | Connect a Hugo repo (own write token, validated), and publish a new post from the composer | `GitHubSession` (shape), `MataroaSettings` (shape), `PostTarget` |
| 2 | See the posts already in the repo, open one in the composer, publish an update over it | Sprint 1's contents API, a new connector child page |
| 3 | Your own blog back in your timeline, via its Hugo-generated RSS feed | `RssSubscriptions`, `RssProvider` (both exist) |
| 4 | "Published — site rebuilding… live" — real deploy status after a commit | GitHub Actions REST, sprint 1's commit result |
| — | POSSE / webmentions | *No sprint file yet. See "The POSSE destination".* |

## Reality check: what the browser can and can't do

Same table as `roadmap-providers.md` opens with, because the same discipline applies and
the answers here are unusually good.

| Operation | From the browser? | How |
|---|---|---|
| Read a repo's file tree | yes | `GET /repos/{o}/{r}/contents/{path}`, CORS-open |
| Read one file's content | yes | same endpoint; body arrives base64 in `content`, with its `sha` |
| Create a file | yes | `PUT .../contents/{path}` with `{message, content}` — base64 |
| Update a file | yes | same `PUT`, **plus the file's current `sha`** — this is the optimistic-concurrency check, and omitting it is a 422 |
| Read Actions runs | yes | `GET /repos/{o}/{r}/actions/runs?per_page=…`, needs `actions:read` |
| Read the built site's RSS | **usually** | it is an ordinary cross-origin fetch of `<site>/index.xml`; GitHub Pages sends `access-control-allow-origin: *`, a custom domain behind Cloudflare may not |
| Send a webmention | **no, not directly** | arbitrary third-party endpoint, no CORS contract — needs the proxy |
| Receive a webmention | **never** | requires a server that is listening. Out of scope forever |

Two consequences worth stating plainly, because they shape sprint boundaries:

- Sprints 1, 2 and 4 need **no proxy and no consent dialog**. This is unusual for a
  connector in this app and should be said in the UI copy — it is a genuine advantage.
- Sprint 3 (read your blog back) rides the RSS provider, which means it inherits the RSS
  provider's CORS reality: a Pages-hosted site works, some custom-domain setups will not,
  and the failure must be a clear message at add time, not a mystery empty feed. This is
  already how `rss-fetch.ts` behaves; sprint 3 must not special-case around it.

## Architecture

New code lives under `ui/src/app/providers/hugo/`, following the shape the two existing
blog connectors already established (`mataroa/` is the closest model — settings service +
api service + status builder):

```
providers/hugo/
  hugo-settings.ts     # the repo config: owner, repo, branch, content path, site URL
  hugo-token.ts        # the write credential, separate from GitHubSession's read token
  hugo-contents.ts     # thin GitHub contents API: list / read / put (create + update)
  hugo-front-matter.ts # pure: build TOML front matter, parse it back. No HTTP.
  hugo-post.ts         # pure: slug rules, file path assembly, Status construction
  hugo-publish.ts      # orchestration: compose payload -> commit -> result
  hugo-deploy.ts       # (sprint 4) Actions runs -> a build verdict
```

The pure/impure split is deliberate and is the house pattern (`clone-friends.ts`,
`follow-quality.ts`, `feed-doctor.ts`): front matter, slugs and paths are where all the
fiddly correctness lives, and they should be testable without a single HTTP mock.

### Why the config is in two places, and how to make that not hurt

Matthew flagged this as the weird part, and it is real: GitHub is already a connection
(`connection-catalog.ts`, `ConnectionId = 'github'`), and Hugo needs GitHub. Two rules
keep it coherent:

1. **They are two different connections because they hold two different credentials with
   two different blast radii.** The existing GitHub connection is a read-only PAT
   (`notifications`, `read:user`) that powers "find GitHub friends". The Hugo connection
   holds a **write** credential. Merging them would silently upgrade an existing user's
   token scope requirement, which is exactly the kind of thing a connector should never
   do quietly. Decision 1.
2. **The Hugo page never makes you go find the GitHub page.** It is self-contained: paste
   a fine-grained token, name the repo, done. It *links* to the GitHub connection as
   related, and if the read connection is present it uses `github.user()?.login` to
   prefill the owner field — a convenience, never a dependency.

So: `ConnectionId` gains `'hugo'`, `CONNECTION_FLAGS` gains `hugo: 'connector-hugo'`, and
`FeatureFlagId` gains `'connector-hugo'`. One catalog entry, one child page, same as every
other connector. The catalog rule ("a connection is *one account*") holds — one repo.

### The composer seam

`PostTarget` gains `'hugo'` and `isBlogTarget()` (`compose.ts:73`) gains it too. That one
predicate is why the composer already does the right thing for a third blog: title-from-CW
required, no media, no polls, no threads, no scheduling — all of it falls out of
`targetIncludesBlog()` (`compose.ts:742`) without new branching in `canSubmit`.

Note the naming wart this inherits and does **not** fix: `'blog'` means Mataroa
specifically, for historical reasons documented at `compose.ts:80-84`. The new target is
`'hugo'`, not `'blog'`, and no sprint here renames the existing one — that is a separate
cleanup and it would touch drafts persistence (`drafts.ts:35`).

### Status construction

Publishing emits a local `Status` the way `mataroaStatus()` and `bloggerStatus()` do:
`provider: 'blog'`, `providerRef: { providerId: 'hugo', path, sha, commitSha }`, id
`blog:hugo:<slug>`. The existing `'✍️ Blog'` badge (`status-card.ts:834`) covers it, and
`PROVIDER_CAPS.blog` already says no reply/favourite/reblog. **No changes to `models.ts`,
`provider.ts` or `status-card.ts` are needed for sprints 1–2**, which is the strongest
evidence the existing seam was cut in the right place.

The one honest wrinkle: `url` in that Status is a *prediction*. The post is not live until
Actions finishes, and the permalink we compute from the site URL + slug is Hugo's default
convention, which a theme can override. Sprint 1 says so in the UI ("will be live at…");
sprint 4 replaces the guess with a confirmed build.

## Decisions taken (from Matthew, 2026-08-05)

1. **A second, separate write token.** The Hugo connector asks for its own fine-grained
   PAT scoped to the one Hugo repo (`Contents: read and write`, plus `Actions: read` for
   sprint 4). The existing read-only GitHub connection is untouched. A leaked token
   reaches one repo.
2. **No in-app repo creation for MVP.** The user forks/generates from the template in
   GitHub's own UI; we link to it with the template URL prefilled. Mawkingbird's job is to
   *validate* what it is pointed at: does the branch exist, is there a `hugo.toml` /
   `config.toml` / `config.yaml`, does the content path exist. Generating a repo from
   inside the app is an outward-facing write with collision handling and async polling —
   it can come later, once publishing is proven.
3. **All four capabilities are in scope**: publish new, update existing, read your blog
   back as a feed, and deploy status. Four sprints, in that order.
4. **TOML front matter (`+++`)**, Hugo's own default and what its archetypes use.
   Generated with a real serializer, not string concatenation — titles contain quotes.
5. **The content path is configured, defaulting to `content/posts/`**, and validated to
   exist at connect time. No auto-detection: guessing wrong is worse than one text field,
   and themes genuinely disagree (`content/post/`, `content/blog/`).
6. **Editing happens on a new post-list page under the connector**, at
   `/settings/connections/hugo`. Not the drafts page — a live file in a git repo and an
   unsent local draft are different things and conflating them would make both confusing.
   Not a top-level `/blog` route either: **`/blog` is already taken** by the docs hub
   (`app.routes.ts:536`), which is deliberate and documented there.
7. **The blog-back-as-feed path reuses the RSS provider.** No Hugo-specific feed code. If
   the user's site RSS is CORS-blocked they get the same clear error any other feed does.
8. **POSSE gets an overview section here and no sprint files yet.** The ground is
   unproven until publishing works, and the hard constraint (sending needs the proxy,
   receiving is impossible) is worth writing down now so nobody plans around it later.

## Non-goals

- **No Mawkingbird backend, still.** Every credential is localStorage under the existing
  retention policy (`credential-lifetime.ts`); every call goes browser → `api.github.com`.
- **No git beyond the contents API.** No trees, no blobs, no branches, no PRs, no merge
  conflict resolution. One file, one commit, one `sha`. If two devices race, the second
  gets a 409/422 from GitHub and we surface it as "someone changed this post since you
  opened it" — which is the correct answer, not a bug to engineer around.
- **No Hugo build locally.** We never render the site, never parse a theme, never
  validate shortcodes. We write Markdown and let Actions be right.
- **No image/media upload in sprints 1–4.** Blog targets already reject media
  (`canSubmit`), and doing it properly means committing binaries and rewriting body links.
  Later, if ever.
- **No renaming `PostTarget.'blog'` to `'mataroa'`.** Tempting, out of scope, touches
  persisted drafts.
- **Not a general "commit a file to GitHub" tool.** It is a blog connector that happens to
  use git as its transport.

## The POSSE destination (no sprint files yet — decision 8)

Publish (O)n your (O)wn (S)ite, (S)yndicate (E)lsewhere. Once your posts are files you
own, your *replies* and *likes* can be files too: a reply to someone becomes a small entry
on your own site with a `u-in-reply-to` pointing at theirs, and then you tell their site
about it. That is a webmention.

What it would take here, honestly:

- **Sending** is `POST` to a webmention endpoint discovered from the target page's HTML
  (`<link rel="webmention">`). Both the discovery fetch and the POST are cross-origin to
  arbitrary hosts with no CORS contract, so both need the CORS proxy — the same
  consent-gated machinery Mataroa already uses (`ProxyConsent`, `CorsProxy`). Doable,
  meaningfully less reliable than everything in sprints 1–4.
- **Receiving** — someone else's comment appearing on your site — requires a listening
  server. Mawkingbird will never be that. The realistic answer is the user points their
  site at a third-party receiver (webmention.io) and we read *its* API. That is a fourth
  vendor connection, and it should be entered into deliberately.
- **Syndication back** (post to Hugo, then also to Mastodon/Bluesky with a link home) is
  the *easy* half and doesn't need webmentions at all — the composer's "both" target
  already proves the multi-leg pattern.

Sequenced roughly as: syndicate-with-canonical-link → send webmentions → read a receiver.
Write the sprint files when sprint 4 lands, not before.

## Testing strategy

- `hugo-front-matter.ts` and `hugo-post.ts` are pure → straight unit tests. Cover the ugly
  cases on purpose: a title with `"` and `'` and a newline, a title that is entirely
  emoji, a title that slugifies to empty, a duplicate slug, a non-ASCII title, a path the
  user typed with a leading and trailing slash.
- The contents API gets `HttpTestingController` specs like every other connector.
  Base64 round-tripping of non-ASCII bodies is the thing most likely to be wrong: use
  `TextEncoder` + `btoa` over bytes, **not** `btoa(string)`, which throws on any character
  above U+00FF. A spec with an em-dash and an emoji in the body is non-negotiable.
- Run specs with `npm run test:ci` from `ui/` (see the `ui-test-runner` memory: raw vitest
  does not work here, and the manifest guard fails the run on renamed/deleted tests —
  rerun with `-- --update` when a rename is intended).

## Sprints

1. `hugo-1-connect-and-publish.md`
2. `hugo-2-edit-existing.md`
3. `hugo-3-blog-back-as-feed.md`
4. `hugo-4-deploy-status.md`
