# Sprint 6 — Share to any ecosystem

Status: **DONE** (written and shipped 2026-08-23)

Second item of the second wave, after [[rss-5-paste-any-url]]. Named by the boss as
important and under-rated: *"We're not mastodon supremacists, so like the 'post to what
ecosystem?' dialog, we should offer sharing to a variety of ecosystems."*

## What already exists (and why this sprint is smaller than it sounds)

Two share systems are already built. Neither is wrong; they answer different questions,
and **nothing currently joins them**.

| | `ShareDialog` (`share-dialog.ts`) | `post-targets.ts` |
| --- | --- | --- |
| What it does | Opens a web-intent URL in a new tab | Composes a real post from this app |
| Destinations | Reddit, Bluesky, Tumblr, LinkedIn, Hacker News | Mastodon, Bluesky, both, paste, Mataroa, Blogger, Hugo |
| Needs an account? | No — the destination site handles it | Yes, a stored connection |
| Who sees it today | **Signed-out users only** | The composer and publish wizard |

So a signed-in user cannot share anything, anywhere. On a status card the share button
sits inside `@if (auth.isAnonymous)`, where it *replaces* the Boost button. And an RSS
item is worse off still: `rss-adapter.ts` reports `reblogs_count: 0` with no reblog
capability, so the whole branch is dead — a signed-in reader on `/rss` has no share
affordance at all. That is the actual gap.

## The decision: one dialog, connectors first, intents behind

Boss's call: *"it would be a killer feature to do the actual post when a connector is
available and an intent when not. Obviously 2 intents can't be done with single click."*

One Share dialog with two sections:

1. **Post it** — destinations where a connector is configured. Uses `usableTargets()`
   from `post-targets.ts`, so this section shows exactly what the composer would accept.
   Opens the composer prefilled. **A real post; never one-click.**
2. **Send it to** — everything else, via web intent, opening in a new tab. This is where
   Reddit, Hacker News, LinkedIn and Tumblr live, plus Bluesky and Mastodon when *not*
   connected.

**A destination appears in exactly one section.** Bluesky connected → section 1, posting
through the app. Bluesky not connected → section 2, handing off to `bsky.app`. The same
is true for Mastodon. Deciding per-destination-per-session is what makes the dialog
honest: every button does the best available thing for that destination right now.

That last sentence of the boss's answer is a constraint, not an aside: **one press = one
destination**. Two intents cannot be a single click, so there is no "share everywhere"
button, no multi-select, and no queue. Section 1 could technically post to several
targets at once (the composer's `both` target already does Mastodon+Bluesky), but it
still ends at the composer with the user pressing Post.

## The action-bar problem, and the flag

> "On the small posts tho, we have already used up the horizontal space budget and we're
> getting wraps on the tools. So we want a feature flag (simple boolean) to make the
> retweet a share dialog, with option to retweet, quote tweet, or share cross platform."

Correct, and it inverts the cost. Adding a sixth icon to the action bar would make the
wrapping worse. Instead the flag **collapses three controls into one**: Boost, Quote and
Share become one 🔁 button that opens a small menu.

- New flag `unified-share`, `group: 'features'`, `defaultState: 'test'`.
  Default off — this changes the action bar on every post in the app, so it earns its way
  to production rather than starting there.
- **Off**: today's behaviour exactly. Boost and Quote as they are, share still
  anonymous-only. Nothing moves.
- **On**: one 🔁 opens a menu — *Boost* / *Quote* / *Share elsewhere…* — and the second
  and third rows disappear from the bar. Net **−1 control** on a bar that is already
  wrapping.

Non-negotiables while the flag is on:

- **Boost stays one press from the bar for the common case.** A menu that turns the app's
  most-used action into two presses is a regression however tidy it looks. The menu opens
  with Boost focused and `Enter` boosts, so keyboard flow is unchanged.
- **`b` and `q` keep working** (`status-card.ts` handles them in `onKey`). They call
  `toggleReblog`/`toggleQuote` directly and must not be routed through the menu.
- The menu **delegates**. `toggleReblog`, `toggleQuote` and `showShare` already exist;
  the menu sets them. No copied logic, no second boost path.

## Highlight-to-quote

> "Yes, selection becomes the quote."

When Share is pressed and text is selected inside the item being shared, the selection is
prefilled as a blockquote above the link:

```
> the selected passage, trimmed

Title of the thing — https://example.com/article
```

Details that decide whether this works:

- **Capture the selection before the dialog opens.** Opening a modal and moving focus
  collapses the selection; read `window.getSelection()` in the click handler and pass the
  string in. This is the whole trick.
- **Only a selection inside the shared item counts.** Compare against the card's own
  element (`Node.contains`) — otherwise selecting text in one post and sharing another
  quotes the wrong thing, silently.
- **Cap it.** Long selections truncate with an ellipsis; a 4000-word "quote" is not a
  quote. Cap the quote so the whole compose body stays inside the tightest target's limit
  (Bluesky's 300 characters is the binding one — `blueskyText()` already shortens for it).
- **No selection is the normal case**: fall back to title + link. Never block on it.
- Intents get the same text where the intent has a text field (Bluesky, Tumblr); Reddit,
  LinkedIn and HN take a URL and title only, so the quote is dropped for those. That is
  the destination's shape, not a bug — but the dialog should not imply the quote survived.

## Placement

Boss picked all three, plus the flag for the general case.

| Where | What |
| --- | --- |
| RSS full-density cards | Via `app-status-card`'s action bar. The signed-in gap. |
| The article view (`rss-article`) | Below a fetched article — where someone has actually read the thing, and the natural home for highlight-quoting. |
| All posts, not just RSS | Via the `unified-share` flag, so the blast radius is opt-in. |
| RSS headline rows | **Not** in this sprint — a 34px dense row has no space, and the expanded state already renders a full card. |

## What gets shared

An RSS item's `url` is the publisher's article, not a Mawkingbird permalink — which is
what makes RSS sharing worth having. `ShareDialog` already models the choice ("This post"
vs. "Linked page") in `shareableContentLinks()`; for an RSS item the item link *is* the
target, so the existing radio group collapses to one option and no choice is shown.

`shareContext()` builds `From @acct: text` today, which is right for a post and wrong for
an article. It needs an RSS-shaped variant: title, publisher, link — no `From @`, because
the feed's synthetic account handle (`rss:<url>`) is not something to show a human.

## Files

| File | What |
| --- | --- |
| `share-dialog/share-dialog.ts` | Two sections; accept a `quote` input; RSS-shaped context. |
| `share-dialog/share-targets.ts` | **New.** Which section a destination lands in, from `TargetAvailability`. Pure, testable. |
| `share-dialog/share-selection.ts` | **New.** Capture + validate + truncate a selection. Pure. |
| `status-card/status-card.html` | Unified 🔁 menu behind the flag; share reachable when signed in. |
| `pages/rss/rss-article/` | Share control under a fetched article. |
| `feature-flags.ts` | `unified-share`, default `test`. |
| `compose/post-targets.ts` | Reused unchanged — it already answers "what can I post to". |

## Done when

- A signed-in user can share an RSS item, and lands in the composer for a connected
  target or a new tab for an unconnected one.
- A destination never appears in both sections.
- Selecting text then sharing quotes that text; selecting nothing shares title + link;
  selecting text in a *different* post does not leak into this one.
- With `unified-share` off, the action bar is byte-identical to today.
- With it on, the bar has one fewer control, Boost is still one press, and `b`/`q` work.
- Runtime-verified per the `verify` skill, including a real intent URL opening with the
  quote in it.

## What changed during implementation

1. **`TargetAvailability` gained a service.** The plan assumed `post-targets.ts` could
   answer "what can I post to" on its own. Its *rules* are pure, but the **snapshot** they
   read was built inline in `Compose` — one method, one caller. A share dialog building
   its own would be two lists that drift, so the snapshot moved to
   `compose/target-availability.ts` (`TargetAvailabilitySource`) and `Compose` now calls
   it. One gatherer, one rule set, two callers.

2. **`Compose` gained an `initialTarget` input.** Without it the dialog could name a
   destination and the composer would open on its default, silently discarding the answer
   the user had just given. Passed through `restorableTarget`, so a target that stopped
   being usable between the two screens falls back rather than showing an empty picker.

3. **The compose text always carries the URL; the intent text does not have to.** Caught
   by a test. Intents take `url` as their own parameter, so the legacy context string
   never included one — but a composer receives only the text, and a post about an article
   that does not link it is the whole point missed.

4. **Focus is moved in code, not with `autofocus`.** The a11y lint rejects the attribute,
   correctly in general. Boost still has to be one press for keyboard users, so
   `toggleShareMenu` focuses the first menu item via `afterNextRender`.

5. **`FeatureFlagId` is a closed union** that must be extended alongside `FEATURE_FLAGS`.
   Note that `tsc --noEmit` does **not** catch a missing member — only the Angular
   compiler does, so a flag added without it fails at `test:subset`/`build`, not at
   typecheck.

### Runtime verification (2026-08-23)

| Check | Result |
| --- | --- |
| Flag **off** | Separate Boost button present, no menu — action bar unchanged |
| Flag **on** | One control; menu is *Boost / Quote / Share elsewhere…*, **focused on Boost** |
| Two sections | Post it: **Mastodon, Paste service**. Send it to: Reddit, Bluesky, Tumblr, LinkedIn, Hacker News |
| No duplication | Bluesky appears only as an intent (unlinked in this session) |
| Post it | Composer opened prefilled, **nothing published**; dialog closed |
| Article share | Button present under a fetched article |
| Highlight | Selected paragraph shown as a quote block in the dialog… |
| …and it travels | Bluesky intent text began `> Paragraph 0 of the article…` |
| Honesty | "Some of these take only a link — your highlight won't travel." shown |

No console errors. Screenshots: `s6-menu.png`, `s6-dialog.png`, `s6-article-share.png`.

**Runtime-testing note:** the fixture server sets `allow_reuse_address`, so restarting it
leaves *stacked* listeners on the port and stale routes keep answering. Symptom is a 404
for a route you just added. `netstat -ano | grep :8877` then `taskkill //PID <pid> //F`
for each, rather than trusting `pkill`.

## Not in this sprint

- **Sharing to a connector that has no composer path** (Raindrop, GitHub, Dropbox). Those
  are storage, not audiences.
- **Multi-destination share.** One press, one destination — the boss's constraint.
- **Headline-row sharing.** No room; expand the row instead.
- **Remembering a preferred destination.** Wait until the dialog has been used.
