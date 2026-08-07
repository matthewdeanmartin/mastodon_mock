# POSSE — Sprint 4: Make it visible, and make it work where it matters

Status: COMPLETE (implemented 2026-08-07; 3365 tests, lint, prettier and both builds clean.
Blog-side changes staged in `mistersql`). Roadmap: `posse-0-overview.md`.

## What changed during implementation

- **The diagnosis was confirmed, not assumed.** Built against Matthew's live
  `data/interactions/2026-08-07.json`: the pages *were* generating correctly
  (`/interactions/2026-08-07-1/` → "Liked a post by mistersql" with a valid `u-like-of`),
  and `grep interactions public/index.html` returned **0**. Nothing was broken; nothing
  linked to it. Fixed with a `[menus]` entry, which also made interactions appear on the
  homepage listing for free.
- **The section index needed its own template.** Ananke's default list renders
  title + summary + "read more", which for a page whose *title is the entire sentence*
  reads as the same thing three times. `layouts/interactions/list.html` groups by day and
  shows icon + title + excerpt instead.
- **The excerpt needed plumbing through.** The first version showed the bare target URL,
  which tells you nothing — `interactionExcerpt` is now a page param.
- **`PROVIDER_CAPS.rss.favourite` stayed false, deliberately.** Flipping it would have sent
  a Mastodon favourite request for an `rss:` id — a 404, and exactly the trap
  `serverKnowsStatus` documents. POSSE-only interaction is a *separate* predicate
  (`canPosseOnly`) consulted alongside the capability, never instead of it. The
  zero-HTTP-requests test is the one that guards this.
- **Record-only buttons are distinct affordances, not the existing ones re-gated.** They
  carry their own titles ("Record a like on your blog") and take their on/off state from
  the queue, since these cards have no server `favourited` flag to read.
- **Delivery now waits on `HugoDeployWatch`, with three endings.** `live` delivers;
  `failed` does not (the source page will not exist, and the user is told); `no-build` /
  `unknown` delivers anyway, because the site may deploy some other way and refusing
  forever would be worse than one send that might be early.

## Still open

- **Replies are still never queued.** Unchanged from sprints 2 and 3: the model, queue,
  page and blog template all handle `reply`; no composer path creates one.
- **Nobody has sent a real webmention yet**, so `layouts/_partials/webmentions.html` has
  only ever run against the fixture. Exit criterion 2 is satisfied by code that exists and
  is tested, not by observed live data.

Written after Matthew's first real run: he liked a Mastodon post and a repost, processed the
queue, and both reached GitHub correctly. Three things he found, all real:

1. **"The hugo site doesn't do anything with a like."** It does — the pages generate — but
   *nothing links to them*, so they are unreachable without typing the URL. Verified against
   his live data: `/interactions/2026-08-07-1/` renders "Liked a post by mistersql" with a
   correct `u-like-of`, and `grep interactions public/index.html` returns **0**.
2. **Reposts work.** `data/interactions/2026-08-07.json` holds both, with correct targets.
   No change needed.
3. **"The feeds have no option to click like or repost on an RSS feed item."** True, and by
   design — until now.

Plus the item deferred from sprint 3: delivery fires before the site rebuilds.

## Exit criteria

1. `/interactions/` is reachable from the site menu, and its index reads as a list of what
   you liked and boosted rather than the theme's default page listing.
2. A post on the blog shows how many likes and reposts it has *received*, from the
   webmention data pulled in by sprint 1.
3. With POSSE on, RSS and Twitter cards offer like and repost, recording to the blog only.
   With POSSE off, they are read-only exactly as today.
4. Delivery waits for the site build, so a receiver that verifies finds the source page.

## 1 & 2 — the blog (`mistersql`)

**Nav.** Ananke reads `site.Params.ananke.menu` / Hugo's own `[menus]`. One entry pointing
at `/interactions/`. Check which the theme version honours before writing it — the theme has
already surprised us twice (`custom_css` routing through a partial it does not ship;
`allowContent` replacing rather than extending).

**The section index.** `layouts/interactions/list.html`, grouped by day, each row reading
`★ Liked a post by @alice — "excerpt"` with the excerpt linking to the original and the
title linking to the interaction page. The theme's default list shows title + summary, which
for a page whose title *is* the sentence reads as duplication.

**Counts on posts.** Sprint 1 already pulls mentions into `data/webmentions/<slug>.json` and
`layouts/_partials/webmentions.html` already renders facepiles. What is missing is only that
nobody has sent one yet. No new code — but worth confirming the partial still renders once
real data arrives, since it has only ever been exercised against the fixture.

## 3 — likeable RSS items (Mawkingbird)

The interesting one, because it inverts a rule.

`PROVIDER_CAPS.rss` is `{ reply: false, favourite: false, reblog: false }` and the comment
on `twitter` explains why: *read-only by construction, not by omission* — there is no
authenticated account to write with, so the buttons would only ever fail.

POSSE changes the premise. A like on an RSS item cannot notify the author **through the
feed**, but it can be recorded on your own site — and if that item's page has a webmention
endpoint, it can genuinely be *delivered*. Which produces the irony this sprint fixes:

> The one provider where webmentions actually work is the one where you cannot click like.

**The rule: POSSE-only interactions are a distinct capability, not a relaxation of the
existing one.** Do not set `PROVIDER_CAPS.rss.favourite = true` — that flag means "the
network accepts a like", and it is consulted by `StatusActions` to decide what request to
make. Flipping it would send a Mastodon favourite request for an `rss:` id, which 404s
(exactly the trap `serverKnowsStatus` documents at `provider.ts:75-85`).

Instead: a separate predicate, something like `canPosseOnly(provider)`, true for `rss` and
`twitter`, false for `paste` and `blog` (your own content — liking your own writing is not a
thing worth recording). `StatusCard` shows the buttons when
`caps.favourite || (posseEnabled && canPosseOnly)`, and the handler branches: a POSSE-only
like **skips the network call entirely** and goes straight to the queue.

That branch is the whole risk, and it is why the tests matter: a POSSE-only like must issue
**zero HTTP requests**, and a normal Mastodon like must be byte-identical to today.

**State.** These cards have no server-side `favourited` flag to read back, so the button's
on/off state comes from the queue itself (`PosseQueue.has('like', url)`). That is also what
makes un-liking work: it removes the queued entry.

## 4 — delivery after the build

Sprint 3 left this deliberately. `HugoDeployWatch` (Hugo sprint 4) already reports
`live`/`failed`/`no-build`; `PossePublish` already returns `commitSha`. Wire them: publish →
watch → on `live`, deliver. On `no-build` deliver anyway (the site deploys some other way and
we cannot tell when); on `failed`, do not deliver at all — the source page will not exist.

The queue page already shows delivery results, so this is a change to *when* `notifyTargets`
runs, not to what it reports. Add a state to the UI for "waiting for your site to rebuild"
so the gap is explained rather than looking like a hang.

## Non-goals

- **No reply support still.** Same as sprints 2 and 3. It is a composer change and wants
  its own sprint.
- **No backfeed.** Mentions of your blog render on your blog, not in the Mawkingbird
  timeline.
- **No liking your own posts**, and no POSSE on `paste`/`blog` providers.
- **No retry loop for delivery.** Still one attempt, still manual retry only.

## Test notes

- The RSS/Twitter path: POSSE-only like issues zero requests (the important one); button
  state derives from the queue; POSSE off means no buttons at all; `paste`/`blog` never get
  them.
- Delivery timing: `live` delivers, `failed` does not, `no-build` does.
- Watch the two standing spec traps (`vitest-fetch-spec-traps` memory).
