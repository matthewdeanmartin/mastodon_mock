# Roadmap — POSSE and webmentions

Status: **Sprints 1–3 COMPLETE** (2026-08-06; 3360 tests, lint, prettier and both builds
clean). Follows `hugo-0-overview.md`, whose sprints 1–4 are complete. Decisions below are
answered — see "Decisions taken".

| Sprint | Repo | Status |
|---|---|---|
| 1 — receive | `mistersql` | COMPLETE (live: sprint-1 work is committed and deployed) |
| 2 — queue | Mawkingbird | COMPLETE |
| 3 — send | both | COMPLETE (blog side staged in `mistersql`) |

**Two things deliberately left for a follow-up**, both recorded in `posse-3-send.md`:

1. **Replies are never queued.** The data model, the queue page and the blog template all
   handle `reply`, but no composer path puts one in. Likes and boosts are what POSSE
   records today.
2. **Delivery does not wait for the site build.** A receiver that verifies will fetch the
   `source` URL and find a 404 until Actions finishes. `HugoDeployWatch` (Hugo sprint 4)
   already knows when a build goes live; wiring delivery behind it is a few lines and
   should happen before relying on delivery to indieweb targets.

## The pitch, and one correction worth making first

Matthew's framing, roughly: *"if I want to like a Mastodon post, I post something on my
blog saying this blog likes that post, then call Mastodon to tell it — probably to find out
Mastodon doesn't support webmentions."*

The mechanism is **exactly right**. A like is a page on your site carrying a machine-readable
marker (`class="u-like-of"` on a link to the target), plus a `POST` telling the target to
come look. Publish, then notify.

The conclusion is **right too, and it is load-bearing**: Mastodon does not accept
webmentions and will not. It federates over ActivityPub, which has native `Like` and
`Announce` activities, so there is no gap for webmention to fill. A webmention sent to a
Mastodon post is a POST into a void — there is no endpoint to discover.

But the thing that follows from that is *not* "so this is pointless", and it is also not
Matthew's other framing — *"a way to like a Mastodon post without logging into Mastodon"*.
Mawkingbird holds a Mastodon token; it can already like that post properly. Access was
never the problem.

**The actual point is durability.** Today, the record that you liked something lives only
on someone else's server, and disappears with it. POSSE means:

> Your like, your reply, your boost exists on a site you own, permanently, whether or not
> mastodon.social does.

That is worth building on its own, and it is worth building *even where no webmention can
be delivered* — which is most of the time.

## The asymmetry that shapes every sprint here

| Target | Your interaction reaches them | Recorded on your own site |
|---|---|---|
| Mastodon post | ✅ — but via the **Mastodon API**, which we already do | ✅ |
| Indieweb blog (has a webmention endpoint) | ✅ — via webmention, and it appears on their page | ✅ |
| Bluesky | ✅ — via the **Bluesky API**, which we already do | ✅ |
| RSS item, Twitter, a paste | ❌ nothing to notify | ✅ |

So webmention *sending* is genuinely useful for exactly one audience: people with indieweb
blogs. That is a small audience and an honest one. For everyone else the value is the
archive, and the UI must not imply otherwise — a "sent!" message for a webmention that went
nowhere would be a lie of the same family as sprint 4's "published".

## What ships

| Sprint | What you get | Where the code lives |
|---|---|---|
| 1 | Your blog receives mentions: webmention.io wired up, a scheduled Action pulling them into `data/`, templates rendering likes/reposts/replies under each post | **`mistersql` repo** |
| 2 | Interactions queue locally and publish on demand: a pending badge in the shell, a `/posse` page, and one commit for the batch | Mawkingbird |
| 3 | Sending: discover a target's webmention endpoint and POST to it, honestly reporting when there is nothing to notify | Mawkingbird |

Receiving first, deliberately (decision 1): it is the half with visible results and zero
risk to a working app, and once it is live you can *watch your own sent webmentions arrive*
— which is the only real end-to-end test this feature has.

## Decisions taken (from Matthew, 2026-08-06)

1. **Both repos, receiving first.** Sprint 1 touches `mistersql` only. Sprints 2–3 touch
   Mawkingbird only. Nothing in this roadmap requires changing both at once.
2. **Liking does both, and it is opt-in via a checkbox on the Hugo connector page.**
   The heart keeps favouriting on Mastodon exactly as it does today *and* records to the
   blog — but only once the user ticks the box, because **the target blog has to be
   webmention-ready first**. Off by default; nothing changes for anyone who has not opted
   in. This is Matthew's refinement of the original proposal and it is the right shape: the
   setting is not a preference, it is an assertion that the blog is set up.
3. **Queue locally, publish on demand, with a prominent pending indicator.** My draft
   raised "the record is not durable until you push it" as an objection to queueing;
   Matthew's answer — a visible pending count — is what dissolves it. Twenty hearts must not
   be twenty commits and twenty site rebuilds.
4. **The pending queue is a shell badge plus a `/posse` page.** Same pattern as Drafts.
   Listing each queued item with *Publish all* and per-item remove. Visible enough that
   nothing sits forgotten; quiet enough that it never nags.
5. **webmention.io as the receiver, IndieAuth via GitHub.** Free, the de-facto standard,
   and its read API takes a token. Self-hosting a receiver is out for the reason every
   server is out in this project. "Skip receiving" was rejected — it is the half Matthew was
   most interested in.

## Non-goals

- **No Mawkingbird backend, still.** The scheduled job runs in *the user's own blog repo*
  as a GitHub Action. That is the one piece of always-on infrastructure in this design, and
  it belongs to the user, not to us.
- **No pretending a webmention was delivered when it was not.** A target with no endpoint
  gets "recorded on your blog — this site does not accept webmentions", not "sent".
- **No receiving inside Mawkingbird.** It has no server and never will. Mentions are
  collected by webmention.io and rendered by Hugo; the app is not in that path at all.
- **No ActivityPub implementation.** We are not making the Hugo blog a fediverse actor.
  That is a real and interesting project (`bridgy-fed` territory) and it is not this one.
- **No backfeed into the Mawkingbird timeline.** Mentions of your blog appear on your blog.
  Piping them back into the app as notifications is a tempting stretch goal and a separate
  argument about what the timeline is for.
- **No comment moderation UI.** What webmention.io collected is what renders. If that turns
  out to need filtering, it needs a design, not a quick flag.

## Reality check: what runs where

The one genuinely new thing in this roadmap is that **some of it is not client-side code at
all.** Worth stating plainly, because it is the first exception to a rule this project has
held since `roadmap-providers.md`:

| Job | Runs where | Why it cannot be in the browser |
|---|---|---|
| Publish a queued batch | Browser → `api.github.com` | (it can — this is ordinary sprint 1–2 machinery) |
| Discover + POST a webmention | Browser → arbitrary host | needs the **CORS proxy**; no CORS contract exists |
| Collect incoming mentions | webmention.io | requires a server that is listening |
| Pull mentions into the repo | **GitHub Action, on cron** | must run when no browser is open |
| Render them | Hugo, at build time | — |

The rule the project actually holds is "no backend *of ours*", and this respects it: the
cron job is a file in the user's repo, running on the user's Actions minutes, doing
something they could do by hand.

## Sprints

1. `posse-1-receive.md` — the `mistersql` repo: `<link>` tags, the scheduled pull, templates.
2. `posse-2-queue.md` — Mawkingbird: the local queue, the badge, `/posse`, batch publish.
3. `posse-3-send.md` — Mawkingbird: endpoint discovery and delivery, honestly reported.
