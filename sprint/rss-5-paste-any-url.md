# Sprint 5 — Paste any URL

Status: **DONE** (written and shipped 2026-08-23)

Follows [[rss-0-overview]], whose four sprints are complete. This is the first of a
second wave, and the highest-priority item on the deferred list.

## Why this is the top priority

> "You know what I have to do to find the .rss feed? I have to view source! I can't ask
> anyone but a professional software developer to do that. My total addressable market
> for subs drops 99% as long as features like that exist."

That is the whole justification and it is correct. Every other RSS feature in this app
is gated behind a step that only a developer can perform. Starter kits (Sprint 4a) were
a partial workaround — they hand over 18 feeds nobody had to find — but they are a fixed
roster. The moment someone wants *their* blog, they are back in view-source.

`rss-discovery.ts` already deferred exactly this, in a comment that names the open
questions:

> It is not general feed discovery ("paste any URL, find its feeds"), which the epic
> defers: that needs its own design pass around caching, rate limiting and what to do
> with sites that declare twenty feeds.

This sprint is that design pass. **When it ships, that comment must be updated** — it
will be describing a limitation that no longer exists.

## The shape

One input. It accepts anything and works out what was meant. The user never selects a
type, never learns a vocabulary, and never opens view-source.

```
┌─────────────────────────────────────────────┐
│ Paste a link                                │
│ ┌─────────────────────────────────────────┐ │
│ │ https://someblog.example/               │ │
│ └─────────────────────────────────────────┘ │
│ A site, a feed, a handle — anything.        │
└─────────────────────────────────────────────┘
```

This **replaces** the current "Add a feed" input on `/rss`, rather than sitting beside
it. Two boxes where one takes a superset of the other's input is a choice the user
cannot make correctly, and the narrower box would be the one labelled with the jargon.
The existing `RssAddFeed` service stays exactly as it is — it remains the only path that
writes a subscription. What changes is what happens *before* it: the resolver decides
what the input is and hands `RssAddFeed` a feed URL, or hands the user a different
action entirely.

## Resolution order

Cheapest and most certain first. Every step that cannot be decided from the string alone
is a network call, and network calls are the budget (see "Cost").

| # | Input looks like | Action | Network |
|---|---|---|---|
| 1 | A Mastodon handle or profile URL | **Offer Follow** (see below) | 1 (`accounts/lookup`) |
| 2 | A URL ending `.xml`/`.rss`/`.atom`, or path containing `/feed`, `/rss`, `/atom` | Try as a feed directly | 1 (the feed fetch) |
| 3 | A YouTube channel/video/`@handle` URL | Resolve to the channel feed | 0–1 |
| 4 | Any other http(s) URL | Fetch it, read `<link rel="alternate">` | 1 (+1 if it *is* a feed) |
| 5 | Not a URL at all | Explain, don't guess | 0 |

Step 2 is a heuristic *about which fetch to try first*, not a claim. If a URL ending
`.xml` doesn't parse as a feed, it falls through to step 4 and gets probed as a page —
plenty of sites serve HTML from `/feed`. Likewise a step-4 page fetch that turns out to
return XML is handed to the feed parser rather than discarded. **The two paths must be
able to fall into each other**, because the extension is evidence and nothing more.

### Step 1: a Mastodon handle should offer Follow, not RSS

**This is a correction to how the earlier sprints thought about this.** Sprint 4a found
that any Mastodon account's `.rss` sends `Access-Control-Allow-Origin: *`, needing no
proxy, and treated that as a reason to reach for it. That was optimising the wrong
thing — no-proxy is *our* convenience, not the user's benefit.

Pasting `@alice@mastodon.social` into a fediverse client and getting an RSS subscription
is a worse outcome than following her. Following gets replies, boosts, notifications,
interaction, and the account appears everywhere accounts appear. The `.rss` feed gets
public top-level posts in a reader, and nothing else.

So:

- **Primary action: Follow.** Resolve via `api.lookupAccount(acct)`, show the account
  (avatar, display name, handle, follower count) and a Follow button calling
  `api.follow(id)` — the same call `account-hover-card.ts` makes.
- **Secondary, de-emphasised: "subscribe by RSS instead".** A small text link, not a
  button. It exists because it is occasionally the right answer — following a very
  high-volume account you want to *read* rather than *follow*, or an account on a server
  yours has defederated. Those are real cases and rare ones. The copy should not
  apologise for the option, but it must not compete with Follow either.
- **Anonymous visitors** have no token to follow with. There, RSS is the *only* action,
  so it becomes primary — and the panel should say why, linking to sign-in, rather than
  silently reordering. Reuse whatever `anonymous-follows.ts` does for local follows if
  that path is live; otherwise sign-in-or-RSS.

Handle forms to accept: `@user@host`, `user@host`, `https://host/@user`,
`https://host/users/user`. The bare-`user@host` form collides with an email address; that
is fine, since the lookup simply fails and it falls through to step 5's message.

### Step 3: YouTube

`https://www.youtube.com/feeds/videos.xml?channel_id=<id>` is stable and long-lived. The
work is getting `<id>`:

- `/channel/UC…` URLs contain it. Zero network.
- `/@handle`, `/c/name`, `/user/name` and video URLs do not. Fetch the page through the
  proxy and read the channel id from it — the canonical `<link>` or the embedded
  metadata carries it.

Prefer the generic step-4 probe first if it works: YouTube channel pages have historically
declared their feed via `<link rel="alternate" type="application/rss+xml">`, which needs
no YouTube-specific code at all. **Check this at implementation time.** Only add the
special case if the generic probe comes back empty — a special case that duplicates
working generic behaviour is a maintenance liability aimed at a third party who can
change the page whenever they like.

### Step 4: the general probe, and the multi-feed problem

This is the case that matters most, and the one the deferred comment worried about.
WordPress alone routinely declares three or more feeds on one page: the main feed, a
comments feed, and per-category or per-tag feeds.

**Decision (user, 2026-08-23): show all, pre-pick the best.**

Present every feed found, with the best guess already selected. One click subscribes the
pre-pick; the alternatives are visible for the minority who want a different one.

This was chosen over auto-subscribing silently (when the heuristic picks the comments
feed, the user gets a confusing subscription and no way to understand why) and over a
neutral list with no pre-pick (which is honest but pushes the exact decision onto the
user that this sprint exists to remove).

Ranking heuristic, in order — the first rule that discriminates wins:

1. **Demote comments feeds.** `/comments/feed`, `comments` in the title, `wfw` hints.
   These are near-never what someone means, and they are the single most common wrong
   pick.
2. **Demote narrower scopes.** A path segment naming a category or tag (`/category/`,
   `/tag/`, `?cat=`) means a subset feed. Someone who pasted the site root wants the site.
3. **Prefer the shortest path.** `/feed` beats `/blog/tech/feed` for a site-root paste.
4. **Prefer a title matching the page's `<title>`.** A feed named like the site is the
   site's feed.
5. **Prefer Atom over RSS on an exact tie**, which is arbitrary but must be *deterministic* —
   the same input has to produce the same pre-pick every time, or the pre-pick is noise.

Every rule is a heuristic and will sometimes be wrong. That is survivable **only**
because all candidates stay on screen. If a later change hides the alternatives, this
ranking stops being acceptable.

The `<link>` parsing is already built and tested: `feedLinksIn(html, baseUrl)` in
`rss-discovery.ts`. **Reuse it, do not fork it.** It already resolves relative hrefs
against the right base, filters non-feed `rel="alternate"` (translations, AMP,
canonicals), de-duplicates, and refuses non-http schemes — six spec'd behaviours a second
implementation would have to rediscover. Ranking is a new pure function *on top of* its
output, in its own file with its own spec.

### Step 5: not a URL

Say what was expected, with an example. Never guess a scheme onto a bare word and fetch
it — `foo` becoming `https://foo/` is a fetch the user did not ask for. A bare token that
looks like a domain (`example.com`, has a dot, no spaces) may be offered as a *suggestion*
to try — "did you mean https://example.com?" — but the fetch waits for the click.

## Cost

Every probe is a cross-origin fetch through the shared CORS proxy — the same budget
article expansion and friend-link discovery draw on. Compared to Sprint 4b this is
*cheaper per run* (one site, not ten) but potentially more frequent, since it is
user-initiated typing rather than a button press.

- **One resolve at a time.** A resolve in flight disables the input; no queue, no
  parallel probes.
- **Never on keystroke.** Resolution happens on submit or paste-then-blur, never on
  input. A debounced resolver would fetch every prefix of a URL somebody typed by hand.
- **Cache by resolved URL for the session.** Pasting the same site twice — which happens
  constantly while someone is trying to get this to work — must not cost two fetches.
  In-memory is sufficient; this does not need to survive a reload, and a persistent cache
  of "what feeds does this site have" would go stale in a way nobody could diagnose.
- **No proxy, no probe.** Steps 2 and 4 need the proxy. Step 1 does not (it is our own
  API) and neither does the step-2 attempt on a CORS-friendly feed. When the proxy is
  absent, say so once and keep the paths that still work — do not disable the whole box.

## Files

| File | What |
|---|---|
| `providers/rss/paste-resolve.ts` | **New.** The resolver: classify, probe, return candidates. |
| `providers/rss/paste-resolve.spec.ts` | **New.** Classification + fallthrough + cache. |
| `providers/rss/feed-ranking.ts` | **New.** Pure ranking of `feedLinksIn` output. |
| `providers/rss/feed-ranking.spec.ts` | **New.** Each rule, and determinism on ties. |
| `providers/rss/rss-discovery.ts` | Update the "not general feed discovery" comment. |
| `pages/rss/paste-box/` | **New.** The input + result panel (feeds, account, error). |
| `pages/rss/rss-page.html` | Swap "Add a feed" for the paste box. |

`RssAddFeed`, `RssSubscriptions`, `feedLinksIn`, `CorsProxy` are all **used unchanged**.

## Done when

- Pasting a site root that declares one feed subscribes in one click.
- Pasting a WordPress site root shows its feeds with the main one pre-picked and the
  comments feed present but not selected.
- Pasting a direct feed URL subscribes without a page probe.
- Pasting `@user@host` offers Follow first, with RSS available as a secondary link.
- Pasting a YouTube channel URL yields the channel feed.
- Pasting nonsense explains itself and fetches nothing.
- The same paste twice costs one network round trip.
- Runtime-verified in a browser against a local fixture site, per the `verify` skill.

## What changed during implementation

Four things the plan above did not anticipate. All are in the code with comments;
recorded here because each was a decision, not a detail.

1. **The dialog was reworked, not replaced.** The plan said the paste box replaces "Add
   a feed". It does — but by rewriting `AddFeedDialog` in place rather than building a
   new component beside it. `AddFeedDialog` already carried the entitled-proxy
   auto-adopt-and-retry (a Plus subscriber who never configured a proxy gets one
   silently on a failed direct fetch), and a fresh component would have quietly dropped
   it. Its spec is the reason that was caught, and that test still guards it.

2. **The resolver adopts an entitled proxy too.** Probing a site needs a proxy, so a
   Plus subscriber without one hit "needs a CORS proxy" at the *resolve* step — one
   screen earlier than the add path's adoption could help. `probePage` now performs the
   same adoption before giving up. Without this the entitlement was real but unreachable
   for exactly the input this sprint is about.

3. **A feed-ish URL that fails both fetches is still offered as a candidate.** If
   `/feed.xml` fails as a feed *and* its page probe finds nothing, reporting the page
   failure ("couldn't reach that site") is misleading — the user pasted something that
   looks like a feed. It is handed back as a single candidate so the subscribe path runs
   and shows its own error, which is also where the retry lives. `needsProxy` is set from
   `proxy.available()` there, since the direct attempt already failed and repeating it
   would be a fetch we know does not work.

4. **Local handles (`@grace`) resolve.** The planned regexes required a host, so a
   handle on this server did not match — caught in runtime testing, not by the specs.
   The leading `@` is mandatory for this form: `@grace` is unambiguously a handle, where
   bare `grace` is a typo or an unfinished domain and must keep falling through to the
   explanation.

### Runtime verification (2026-08-23)

Against a fixture WordPress-shaped site (three declared feeds, no `ACAO` on its HTML, so
the probe genuinely needs the proxy) plus a single-feed site and a no-feed site:

| Case | Result |
|---|---|
| Site root, 3 feeds | 3 candidates shown; **main feed pre-picked**, category second, comments last; Subscribe took the pre-pick |
| Site root, 1 feed | Subscribed in one step, no choice shown |
| Site with no feed | "No feed found on that page. It may not publish one." |
| `@grace` | Account card + **Follow** button, RSS as a text link; Follow succeeded and **the subscription list was unchanged** |
| `example.com` | "Did you mean https://example.com?" — no fetch made |
| `what is rss anyway` | Explained; no fetch made |

No console errors. Screenshots: `s5-multi.png`, `s5-account.png`.

**Note for the next runtime test:** `PYTHONIOENCODING=utf-8` is needed when a check
prints dialog text — the "Following ✓" state contains a character `cp1252` cannot encode,
and the script dies on the assertion rather than the app failing.

## Not in this sprint

- **Reddit** — deliberately dropped. `r/name → .rss` is a trivial transform, but Reddit
  rate-limits and blocks proxies aggressively enough that the subscription would work at
  add time and fail at read time. That is a worse experience than not offering it.
- **Substack** — no special case. Substack declares its feed via `<link rel=alternate>`,
  so step 4 already covers it. Revisit only if runtime testing shows otherwise.
- **Feed directories / search by topic.** Pasting is not searching.
- **Bulk paste** (many URLs at once). OPML import already covers the bulk case.
