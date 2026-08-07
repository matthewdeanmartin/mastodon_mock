# POSSE — Sprint 1: Your blog receives mentions

Status: COMPLETE (implemented 2026-08-06 in the `mistersql` repo; Hugo 0.164 builds clean,
all five exit criteria verified against the fixture). Roadmap: `posse-0-overview.md`.

## What changed during implementation

- **No template override was needed at all.** The plan assumed overriding Ananke's post
  layout. It ships a `content-after` hook (`themes/ananke/layouts/single.html:65`), so
  `layouts/_partials/hooks/content-after.html` is picked up automatically. Same for the
  head: `head-additions.html` is the documented injection point. Zero theme files touched.
- **Three bugs the build caught, all worth knowing:**
  1. **Hugo's `strings.Trim` and `ReplaceRE` take the string as the *last* argument**, so
     writing them as pipes (`.RelPermalink | strings.Trim "/"`) puts it in the wrong slot.
     This silently produced `-` as the slug for every page, so every data lookup missed —
     no error, just nothing rendered. Written out with explicit argument order now, and
     commented, because the failure mode is invisible.
  2. **`$` inside a `range` is the *page*, not the item.** `$.author.name` failed the build
     outright. Bind the value before entering `with`, which rebinds the dot.
  3. **A `README.md` inside `data/` breaks the build** — Hugo unmarshals everything under
     `data/` as data, and fails with `unmarshal of format "" is not supported`. The
     directory doc lives in `docs/webmentions-data.md` instead.
- **The theme's `ananke.custom_css` route does not work on this theme version.** It resolves
  entries through a partial (`AnankeGetResource.html`) the theme does not ship, so the
  stylesheet is silently skipped — no error, no warning. The CSS is linked from our own
  `head-additions.html` with `minify | fingerprint` and an SRI hash instead, and `hugo.toml`
  carries a note saying why.
- **Slug agreement between script and template is the correctness hinge**, and it was
  verified rather than assumed: on a project site, `.RelPermalink` (`/mistersql/posts/init/`)
  and the mention's absolute `wm-target` both reduce to `mistersql-posts-init`. Both sides
  carry a comment pointing at the other, because a divergence renders nothing and errors
  nowhere.
- **The fixture is adversarial on purpose.** It carries a reply whose `content.html` holds
  a `<script>` tag and a mention with an unknown `bookmark-of` property. Both are provably
  absent from the built output, which is what makes the two-layer defence (script keeps
  only `content.text`; template never marks it safe) a test rather than a claim.
- **`data/webmentions/` ships empty**, with a `.gitkeep`. The site builds and renders
  correctly with no data at all — verified — which is the state the repo is in until
  webmention.io collects something.
- **`public/` is tracked in this repo** (pre-existing). Local builds dirty it, so it was
  restored rather than committed; Actions produces the real deploy.

**Left for you:** the one-time setup in `docs/webmentions.md` — the `rel="me"` round trip,
webmention.io sign-in, and the `WEBMENTION_IO_TOKEN` secret. The `webmention_io_id` in
`hugo.toml` is a best guess at the encoding and **must be replaced with the value
webmention.io shows**, because a wrong one fails silently.

**This sprint touches the `mistersql` repo, not Mawkingbird.** Nothing in
`ui/src/app` changes. It is first because it has visible results, no risk to a working app,
and because once it is live, a webmention sent by sprint 3 can be *watched arriving* —
which is the only real end-to-end test this feature has.

## Exit criteria

1. Every page of the site advertises a webmention endpoint (two `<link>` tags in `<head>`).
2. A scheduled GitHub Action pulls new mentions from webmention.io into `data/webmentions/`
   and commits them, on a daily cron and on manual dispatch.
3. Each post renders its likes, reposts and replies from that data. A post with no mentions
   renders nothing extra — not an empty "0 likes" shell.
4. The pull job is idempotent: running it twice adds nothing the second time, and it never
   commits when there is nothing new.
5. Setup steps are written down well enough that a second person could repeat them.

## What is already true (verified 2026-08-06)

Read from the repo rather than assumed:

- `hugo.toml` sets `baseURL = 'https://matthewdeanmartin.github.io/mistersql/'` and
  `theme = 'ananke'`. **The site lives under a path, not at a domain root** — this matters
  more than anything else here; see "The identity problem" below.
- `layouts/` and `data/` are both **empty**. Nothing to fight, nothing to migrate.
- Ananke is on the modern layout structure (`layouts/_partials/`, Hugo 0.146+) and ships
  **`_partials/head-additions.html`**, documented as "the designated injection point at the
  end of `<head>`". So the `<link>` tags need no theme fork and no `baseof` override.
- `.github/workflows/hugo.yaml` builds on push to `main` and on `workflow_dispatch`, with
  `concurrency: group: pages, cancel-in-progress: true`.
- One post exists, `content/posts/init.md`, carrying TOML front matter written by
  Mawkingbird's sprint 1.

## The identity problem, and why it comes first

Webmentions are keyed by **URL**. Your posts are at
`https://matthewdeanmartin.github.io/mistersql/posts/init/`. That is a fine URL and it has
two problems:

1. **It is not yours.** If you ever move to a custom domain, every mention collected
   against the old URL is stranded, because the receiver has no idea the two are the same
   page.
2. **IndieAuth authenticates a *domain*.** Signing in to webmention.io means proving you
   control the site — done with `rel="me"` links between your homepage and a profile
   (GitHub is the easy one). On a `github.io/<repo>/` path this works, but you are
   authenticating a path on a domain shared with every other GitHub user.

Neither blocks this sprint. Both argue for a custom domain eventually. **Write the decision
down now**: if a domain is coming, get it before collecting mentions worth keeping, because
migrating them is manual and lossy. If not, proceed — the setup is identical.

Do not try to solve this with redirects or canonical-URL trickery in this sprint. Pick a
URL, use it consistently, and move on.

## Setup (done once, by hand, before any code)

Written out because "sign in to webmention.io" hides three steps that each fail differently:

1. **Add `rel="me"` to your GitHub profile from the site**, and a link back. On the site
   this is one line in the head partial below. On GitHub, put
   `https://matthewdeanmartin.github.io/mistersql/` in your profile's Website field. Both
   directions are required — IndieAuth checks the round trip.
2. **Sign in at `https://webmention.io`** with your site URL. It will bounce you through
   GitHub. If it refuses, the `rel="me"` pair is not resolving yet — deploy first, then
   retry.
3. **Copy the API token** from webmention.io's settings. It is a read token for *your*
   mentions.
4. **Add it to the repo as an Actions secret** named `WEBMENTION_IO_TOKEN`
   (Settings → Secrets and variables → Actions). It must not be committed; the workflow
   reads it from the environment.

## The `<link>` tags

`layouts/_partials/head-additions.html` — a project-level override of the theme's own
partial, which is exactly what Ananke documents it for:

```html
{{/* Keep the theme's hook working: site projects override this partial, so
     dropping the hook call would silently break any theme feature using it. */}}
{{- partials.Include "hook.html" (dict "hook" "head-end" "context" .) -}}

{{/* Webmention endpoints. Both forms, because receivers and senders disagree
     about which they look for and the cost of publishing both is two lines. */}}
<link rel="webmention" href="https://webmention.io/matthewdeanmartin.github.io%2Fmistersql/webmention" />
<link rel="pingback" href="https://webmention.io/matthewdeanmartin.github.io%2Fmistersql/xmlrpc" />

{{/* IndieAuth: proves this site and that GitHub profile are the same person. */}}
<link rel="me" href="https://github.com/matthewdeanmartin" />
```

The exact endpoint URL is whatever webmention.io shows after sign-in — **copy it from
there rather than constructing it**, because the path-encoding for a project site is
fiddly and getting it wrong fails silently (mentions go to a domain you do not own).

## The scheduled pull

`.github/workflows/webmentions.yaml`. A separate workflow from `hugo.yaml`, not a job
inside it: this one runs on a clock and commits, and mixing "build the site" with "change
the site" in one file makes both harder to reason about.

```yaml
name: Pull webmentions
on:
  schedule:
    - cron: '17 6 * * *'   # daily; an off-the-hour minute is likelier to run on time
  workflow_dispatch:
permissions:
  contents: write          # it commits; hugo.yaml deliberately has contents: read
concurrency:
  group: webmentions       # never two pulls racing on the same file
jobs:
  pull:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Fetch new mentions
        env:
          WEBMENTION_IO_TOKEN: ${{ secrets.WEBMENTION_IO_TOKEN }}
        run: python scripts/pull_webmentions.py
      - name: Commit if anything changed
        run: |
          if [[ -n "$(git status --porcelain data/webmentions)" ]]; then
            git config user.name  'webmention bot'
            git config user.email 'actions@github.com'
            git add data/webmentions
            git commit -m 'Pull webmentions'
            git push
          fi
```

Note what the last step buys: pushing only when something changed means the site rebuild
(`hugo.yaml`, on push to main) fires only when there is something new to render. A daily
empty commit would be a daily pointless deploy.

### `scripts/pull_webmentions.py`

Python, matching the repo it sits in. Standard library only — `urllib` is enough for one
GET, and a dependency file would drag `pip install` into a job that does not need it.

Design notes that are the actual content of this script:

- **Endpoint**: `https://webmention.io/api/mentions.jf2?token=…&per-page=200`, plus
  `&since=<ISO timestamp>` on later runs.
- **Store the high-water mark** in `data/webmentions/_meta.json` (`{"since": "..."}`). This
  is what makes the job idempotent and cheap: the second run asks only for what arrived
  after the first. Belt and braces, dedupe by `wm-id` as well — a mention can be re-sent,
  and `since` is a timestamp filter, not an exact cursor.
- **One file per target page**, keyed by a slug of the target URL:
  `data/webmentions/posts-init.json`. Per-page files keep the template lookup trivial and
  keep diffs readable; one giant file would re-write entirely on every pull.
- **Store only what renders**: `wm-id`, `wm-property` (`like-of` / `repost-of` /
  `in-reply-to` / `mention-of`), `url`, `published`, and `author` (`name`, `photo`, `url`).
  Everything else webmention.io returns is noise in a git diff forever.
- **Do not fetch author avatars into the repo.** They are hotlinked at render time, or
  omitted. Committing binaries on a cron is how a repo gets fat.

## Rendering

`layouts/_partials/webmentions.html`, included from a post-layout override. Ananke's post
template is `layouts/post/single.html`; override it at the project level rather than
editing the theme.

The shape:

```
{{ $slug := ... target URL -> the same slug the script writes ... }}
{{ with index site.Data.webmentions $slug }}
  {{ $likes   := where . "wm-property" "like-of" }}
  {{ $reposts := where . "wm-property" "repost-of" }}
  {{ $replies := where . "wm-property" "in-reply-to" }}
  ...
{{ end }}
```

Three rules the template must follow:

1. **Silent when empty** (exit criterion 3). No "0 likes". A post nobody has mentioned
   should look exactly as it does today.
2. **Likes and reposts render as small avatar rows** — a face and a link, no prose. Replies
   render as text with attribution.
3. **Reply content is untrusted HTML from strangers.** webmention.io returns
   `content.html`. Either render `content.text` only (safe, plain, and enough), or pass the
   HTML through Hugo's `sanitizeHTML`-equivalent — but the default here is **text only**.
   The first person to send you a reply containing a `<script>` tag should not be
   interesting.

## Test plan

There is no test runner in the blog repo, and adding one for this is out of proportion.
Instead the script gets a `--dry-run` flag and a checked-in sample response, so:

- `python scripts/pull_webmentions.py --dry-run --fixture tests/sample-mentions.json`
  prints what it *would* write, and is runnable locally with no token.
- Run it twice against the same fixture and confirm the second run writes nothing
  (exit criterion 4).
- Verify locally with `hugo server` before pushing: a post with fixture mentions renders
  them; `content/posts/init.md` with none renders unchanged.

Real end-to-end verification is sprint 3's job — send a webmention from Mawkingbird and
watch it appear. Until then, the fixture is the test.

## Handoff note

The three pieces are independent and land in this order: `<link>` tags (five minutes,
immediately verifiable in view-source), the pull script (the bulk of the work), the
templates (needs data to look at, so it wants the script first). Stopping after the first
two is a coherent state: mentions accumulate in the repo, nothing renders yet.
