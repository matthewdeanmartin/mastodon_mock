# Hugo — Sprint 4: Did it actually publish?

Status: COMPLETE (implemented 2026-08-05; 3297 tests, lint, prettier and both builds clean;
31 tests added). Roadmap: `hugo-0-overview.md`. Depends on sprint 1.

## What changed during implementation

- **A Hugo draft is not watched at all.** Not in the plan, and obvious in hindsight: a
  draft is committed but deliberately *not* built into the site, so there is no run to
  match and the chip would sit on "still building…" until the five-minute ceiling. The
  composer skips the watch for drafts entirely.
- **`PublishResult` gained `commit`.** The composer needs the commit sha to start a watch,
  and digging it out of `status.providerRef` means casting through `unknown` — the field is
  deliberately opaque. Returning the `HugoPutResult` alongside is cheaper and honest.
- **The watcher uses a monotonic token, not just a cleared timer.** Clearing the timeout
  stops the *next* poll but not the fetch already in flight, whose `await` resumes
  afterwards and would happily write a verdict into a watch the user had dismissed.
  Every callback checks the token before touching state, on both sides of the await.
- **Ordering is the safety property, and it is deliberate.** The composer publishes,
  emits its Status, and *then* starts the watch. A watch failure can therefore never make
  a successful commit look failed — which matters because the most likely watch failure
  (a token without `Actions: read`) is a setup issue, not a publishing one.
- **Spec note that cost a debugging round:** `mockResolvedValue(new Response(...))` hands
  the *same* object to every call, and a `Response` body can only be read once — the second
  poll fails to parse and the watcher reports `unknown`. Polling specs must mint a fresh
  Response per call (`alwaysRespond(() => …)`). This is the sibling of the
  `restoreAllMocks`/`clearAllMocks` trap from sprint 2; both are now commented in place.

The trust sprint. After sprints 1–2 the composer says "published" the moment GitHub
accepts the commit — which is a lie by omission. The post is not live; a build has been
queued. If the build fails (bad front matter, a theme error, a broken shortcode) the user
is told they published and nothing happened.

## Exit criteria

1. After a publish, the composer/result shows a live build state: **queued → building →
   live**, or **build failed** with a link to the run.
2. Polling stops. It stops on success, on failure, on a timeout ceiling, and when the user
   navigates away. No unbounded background loop.
3. A repo with no Actions workflow (someone deploying by other means) shows "published to
   the repo" and no build state — not a spinner that never resolves.
4. A token without `Actions: read` degrades to exit criterion 3's state with a one-line
   hint, and **never blocks publishing**.

## The API

```
GET /repos/{owner}/{repo}/actions/runs?branch={branch}&per_page=10
```

Returns runs newest-first with `head_sha`, `status` (`queued` | `in_progress` |
`completed`), `conclusion` (`success` | `failure` | `cancelled` | …), `html_url`,
`created_at`.

Sprint 1's `putFile` already returns `commitSha`. **Match on `head_sha === commitSha`** —
that is the whole correctness story. Do not take "the newest run", which belongs to
whatever else happened to push, and do not take "the newest run since we published", which
races with a colleague's commit and with GitHub Pages' own separate deployment run.

The gap worth designing for: **the run does not exist immediately.** For a second or two
after the commit, no run has `head_sha === commitSha` — that is `queued`-before-queued, not
"no workflow". Distinguishing that from exit criterion 3 is the difference between a
correct feature and a confusing one:

- No matching run **and** `< ~20s` since the commit → "queued".
- No matching run **and** `> ~20s` since the commit → "no build detected"
  (criterion 3's state). Say it plainly; do not keep spinning.

## Polling (exit criterion 2)

A pure state machine in `hugo-deploy.ts`, HTTP-free and fully testable, plus a thin caller:

```ts
export type DeployState =
  | { kind: 'queued' }
  | { kind: 'building'; runUrl: string }
  | { kind: 'live'; runUrl: string }
  | { kind: 'failed'; runUrl: string; conclusion: string }
  | { kind: 'no-build' }          // criterion 3
  | { kind: 'unknown'; reason: string };  // criterion 4, or an API error

export function nextDeployState(
  runs: ActionsRun[], commitSha: string, elapsedMs: number,
): DeployState;
```

Schedule: **backoff, not a fixed interval.** 3s, 5s, 8s, 13s, then every 15s to a hard
ceiling of **5 minutes**, then `unknown` with "still building — check the run". A Hugo
build is usually 30–90 seconds; a fixed 3s poll for five minutes is 100 requests against a
5000/hour rate limit for one post.

Stop conditions, all of them required:

- Terminal state reached (`live`, `failed`, `no-build`).
- Ceiling hit.
- The component is destroyed — `DestroyRef` / `takeUntilDestroyed`. A publish followed by
  navigation must not leave a timer running.
- A second publish supersedes the first; only one poller at a time.

## Where the state renders

The composer emits its Status and resets immediately today — publishing feels fast and
that should not change. So the build state **must not live inside the composer's submit
path**. Two options; prefer the first:

1. **On the published Status card / the success notice**, as a small live chip. The
   Status already carries `providerRef.commitSha` from sprint 1, so whatever renders it
   can drive the poll. Non-blocking, disappears with the card.
2. On the sprint 2 post-list page, as a column. Useful later; not sufficient alone,
   because the user is not on that page right after publishing.

Copy matters more than usual here. "Published" alone was the lie; the chip should read
`Publishing… · site rebuilding` → `Live ↗` (linking the predicted permalink, now
*confirmed*, which retroactively justifies sprint 1's guess) or `Build failed ↗` (linking
`html_url`).

## Failure is the point

The success path is a nicety; the failure path is why this sprint exists. A failed build
must:

- Be visually distinct from a failed *publish* — the commit succeeded, the post is in the
  repo, it is just not live. Say exactly that, because the user's next question is "did I
  lose my writing" and the answer is no.
- Link the run directly. We do not fetch or parse logs — no log parsing, ever; that is a
  rabbit hole and GitHub renders them better than we will.
- Not offer a retry button. Re-running someone's workflow is an outward-facing action, and
  the fix is almost always to change the content, not to re-run.

## Scope creep to refuse

- **No `deployments` / Pages API.** `GET /repos/{o}/{r}/pages/builds` is a second, partly
  redundant source with its own permission. One source, matched by sha.
- **No workflow dispatch, no re-run, no cancel.** Read-only.
- **No build status for posts published from elsewhere.** We poll a commit *we* made.
- **No log fetching or error extraction.**
- **No push notifications / background polling across sessions.** When the tab is gone,
  the question is gone.

## Test notes

`nextDeployState` is pure, so the entire matrix is a table test:

| runs | elapsed | expect |
|---|---|---|
| `[]` | 5s | `queued` |
| `[]` | 45s | `no-build` |
| matching, `in_progress` | any | `building` |
| matching, `completed`/`success` | any | `live` |
| matching, `completed`/`failure` | any | `failed` |
| non-matching sha only, `in_progress` | 45s | `no-build` (not `building`) |
| matching `queued` + newer non-matching `success` | any | `queued` (never the wrong run) |

The last two rows are the ones a naive implementation gets wrong; write them first.

For the poller: fake timers, assert the backoff schedule, assert it stops on each terminal
state, assert destroy cancels it, and assert a 403 (missing `Actions: read`) yields
`unknown` exactly once with no retry storm.

## Handoff note

Fully separable from sprints 2 and 3 — it depends only on sprint 1's `commitSha`. If the
roadmap needs reordering, this can move earlier or be dropped without stranding anything.
The pure state machine plus its table test is worth landing even if the UI half slips.
