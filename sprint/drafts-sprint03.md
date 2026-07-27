# Drafts — Sprint 3: thoughtful posting

Status: COMPLETE (implemented and verified 2026-07-27)

Depends on `drafts-sprint01.md` and `drafts-sprint02.md` — both **complete**.

## What Sprints 1–2 leave you

- `Drafts.handoff()` / `takeHandoff()` — the one-shot composer handoff. S3.4's drafts-top editor
  should reuse this rather than inventing a second path into the composer.
- `Compose.acceptsHandoff()` — already answers "is this a top-level composer?" by checking
  `contextKey() === 'new'`. **That is exactly the predicate the gate needs**, and it already
  distinguishes replies from everything else. S3.2 should extend this idea rather than re-deriving
  it per mount.
- `ClientPrefs` — where the pref goes; `blue-controls.html` is the shared control cluster surfaced
  by both the Blue and Appearance settings pages.
- `/drafts` already has a working row → composer flow, so "save here, post later" is a path the
  user can already walk. S3 removes the *other* path rather than building a new one.

Note the composer has eight mount sites (home, thread ×2, status-card ×3, conversations, pastes).
`contextKey()` distinguishes `new` / `reply:<id>` / `quote:<id>`, which covers the reply exemption
cleanly — but the /pastes share composer and the conversations composer are both `new`-context
mounts that probably should not be gated. Check each against the real template list.

## Product premise

**Thoughtful posting** is a Mockingbird Blue feature that removes the ability to post
impulsively. When it is on, there is no writing box on Home — just a `[✍ Write]` button that
takes you to an editor at the top of `/drafts`. That editor has **no Post button**. It saves.
Posting happens later, deliberately, from a draft row's "Edit for post".

The point is the gap. Every top-level post must survive the interval between writing it and
coming back to it.

**Replies are exempt**, and only replies. A reply is time-sensitive by nature — mellowing it in a
drafts queue destroys the thing it is for. Quotes, DMs, and the paste-share composer are gated
along with everything else (the boss chose the strict variant over the more-exemptions one).

```
HOME                            /DRAFTS
┌──────────────────────┐        ┌──────────────────────────┐
│  [ ✍ Write ]         │   →    │ (editor)                 │
└──────────────────────┘        │              [Save draft]│
                                └──────────────────────────┘
                                  ↓ later, deliberately
                                  row → [Edit for post] → composer w/ Post
```

## Stories (outline)

### S3.1 — The pref

A `ClientPrefs` toggle surfaced in `blue-controls.html` (shared by the Blue and Appearance
settings pages, so it is findable in both). Client-side, instant, per-browser — consistent with
every other Blue feature. Not a `FeatureFlags` entry: this is a user preference, not a rollout.

### S3.2 — Gate the composer

An opt-in `gateable` input on `<app-compose>`. When the pref is on *and* a mount opted in, the
Post and schedule affordances are absent and Save draft is primary. Per the table above, only Home
and the quote composers opt in; every other mount is untouched and unaware.

Opt-in rather than opt-out because the failure directions are not symmetric: a surface that should
have been gated but isn't just behaves as it does today, while a surface that shouldn't have been
gated but is silently blocks someone from replying.

### S3.3 — Home's `[✍ Write]` button

Replaces `<app-compose>` on Home when the pref is on, and routes to `/drafts` with the editor open
and focused. Home remains the landing route — the button is the entry to the write → draft → edit →
publish cycle, not a redirect away from the timeline. Keyboard shortcut parity with the existing
compose hotkey. No draft count on it.

### S3.4 — The drafts-top editor

A composer mounted at the top of `/drafts` in save-only mode, collapsed by default and expanded by
`[✍ Write]` or by a "New draft" affordance on the page itself. Saving drops the new draft into the
list below it without a reload.

### S3.5 — Escape hatches and honesty

Turning the pref off must not strand anything. Decide and document: does an in-progress gated
editor survive the toggle, and does the existing 30-second undo-send interact with the gate at all
(it should be orthogonal — the gate is about *when* you decide to post, undo-send is about the
seconds after).

### S3.6 — Coverage

Pref persistence, per-mount gating (a test that asserts the reply mount is *not* gated), Home
button routing and focus, save-only editor behavior, and a test that no gated surface can reach
`api.postStatus`.

## Decisions (from the boss)

- **Home stays the landing route.** The pref doesn't move where you start. You land on Home, and
  *if the urge to write strikes*, that urge enters a write → draft → edit → publish cycle instead of
  a text box. The gate is about what happens when you want to write, not about hiding the timeline.
- **The anonymous local composer is gated too**, purely for consistency. Noted side benefit: someone
  may well turn this mode on for anonymous read-only browsing precisely because it declutters the
  screen, and that is a fine reason to use it.
- **The /pastes share composer is not gated.** The deliberation already happened when you made the
  paste; posting its link is not the impulsive act this feature guards against.
- **Conversations, chat, and replies are never gated.** Rough-to-publish is allowed there because
  replies are urgent — mellowing them in a queue destroys what they are for.
- **Reply-to-self is not gated either**, for now. It is arguably a thread-continuation and arguably
  a fresh thought, and the honest answer is that nobody knows yet. Revisit after this has been in
  production a while.
- **No draft count on the [✍ Write] button.** A running total of unpublished work is an anxiety
  feature. Revisit in a year, once there is real data on what the high-water mark for unpublished
  drafts actually looks like, and whether it needs managing at all.

## The gating table

| Surface | Context | Gated? |
| --- | --- | --- |
| Home composer | `new` | **yes** — replaced by [✍ Write] |
| Anonymous local composer | (own component) | **yes** — consistency + declutter |
| Quote composer (status-card) | `quote:<id>` | **yes** |
| Reply (thread, status-card) | `reply:<id>` | no — urgent |
| Reply to self | `reply:<id>` | no — undecided, allow for now |
| Conversations / chat | `new` | no — urgent |
| /pastes share composer | `new` | no — already deliberate |

Note that `contextKey()` alone does **not** decide this: three `new`-context mounts land on
different sides of the line. The gate needs an explicit per-mount input, defaulting to off, with
Home and the quote composers opting in. A component that never passes it is never gated, which is
the safe direction to fail.

## Delivered

- `ClientPrefs.thoughtfulPosting`, off by default, surfaced in `blue-controls.html` (so it appears
  on both the Blue and Appearance settings pages).
- `<app-compose [gateable]>` — opt-in, with `gated = gateable && thoughtfulPosting`. Only Home and
  the quote composer opt in.
- **The gate is enforced in `submit()`, not just the template.** A hotkey, an Enter handler, or a
  future call site must not be able to publish around it; a gated `submit()` saves a draft and
  returns. The specs assert the *absence* of a request, which is the only thing that really proves
  it.
- Home swaps its composer for a `[✍ Write]` link to `/drafts?write=1`, and `/drafts` gained a
  save-only editor at the top, open on arrival or on the page's own Write button.
- The schedule affordance is hidden when gated — scheduling is a way to publish without deciding
  now, which is the one thing a gated composer must not offer.
- The anonymous local composer needed no change of its own: it lives inside Home's composer branch,
  so the gate hides it along with the main box. That is both the requested consistency and the
  declutter side effect.

## Found while implementing

**The gate would have broken its own publish step.** "Edit for post" routes to `/home?draft=<id>`
to do the actual publishing — but with the pref on, Home has no composer, so the cycle had no way
to finish. Home now un-gates its composer when it is opened *holding* a draft (a `?draft=` param or
a pending handoff). The deliberation already happened, in the gap between saving it and coming back.

That flag is latched at construction rather than computed live: the composer drains the handoff as
it seeds, so a live read would swap the composer back out from under the user mid-edit.

## Also done this sprint

**Quiet page text.** The descriptive blurbs on /drafts and /pastes were nested inside `.page-head`,
which sets `font-size: 18px; font-weight: 800` — so a paragraph of reference text rendered as loud
as the title above it. Added a shared `.page-note` class (13px, normal weight, muted) matching the
register of the compact empty states, and moved both blurbs out of the head. The drafts empty state
came down to the same size. Only those two pages nested text this way; the other sixteen
`.page-head` users are title-only and were left alone.

## Verification

- `npm run lint`, `npm run format:check` — pass.
- `npm run test:ci` — pass (170 files, 1470 tests; 9 added this sprint).
- `npm run build` / `npm run build:mockingbird` — pass.
- Still not smoke-tested against a live mastodon.social account (see below).

## Carried forward — the epic's one real gap

Nothing across all three sprints has been verified against a live mastodon.social account. Every
server interaction is covered by `HttpTestingController` only. Specifically unproven:

- Whether a 99-year `scheduled_at` is accepted at all. The park path treats refusal as ordinary
  error handling, so this is survivable either way — but nobody has watched it happen.
- Whether `GET /api/v1/accounts/:id/statuses` returns the caller's own `direct` posts, which is the
  entire basis of the self-draft kind.
- Whether the self-draft predicate produces false positives against a real DM history.

These are all read-path assumptions that a single session against a real account would settle.
