# Onboarding sprint 1 — Honest actions and dead links

Status: PLANNED. Depends on nothing. Every item is confirmed in source.

The theme: **stop the app making promises it cannot keep, and stop it hiding destinations it
already has.** Nothing here is a redesign. Each item is a small correction whose absence a new
user reads as "this feature is broken or missing."

---

## 1.1 — Anonymous like / reply are inert lookalikes

**Corrected 2026-09-01 during implementation.** The overview and the first draft of this sprint
blamed `providers/provider.ts:36` (`'anonymous-mastodon': { reply: true, favourite: true,
reblog: true }`) and proposed flipping it to false. **That diagnosis was wrong and the fix would
have caused a regression.** The static table is deliberately permissive and is narrowed per-viewer
by `AnonymousCapabilities.statusCaps` (`providers/anonymous/anonymous-capabilities.ts:72`), which
calls `capabilitiesFor(provider, !this.active)` and returns `NO_WRITES` for every provider while
anonymous. That is already correct, already tested
(`anonymous-capabilities.spec.ts`, "disables identity-dependent and server-mutating actions"), and
flipping the table would have broken writes against our own textboard server — the exact
regression the comment at `provider.ts:20-30` records having already fixed once.

`toggleFavourite` (`status-card.ts:1478`) and `toggleReblog` (`status-card.ts:1546`) both guard on
`caps` and return early, so **an anonymous viewer cannot reach a failing network request through
these buttons.** No flash of a failed like is possible by this route.

**The actual defect:** because `caps.favourite`/`caps.reply` are false, the template falls through
to inert display branches that render `<span class="action">` — 💬 at `status-card.html:366`, ♡ at
`status-card.html:632`. Those spans carry the counts and nothing else. But `.action`
(`status-card.css:373`) sets `cursor: pointer`, and `.action:hover` (line 385) changes the colour.

So an anonymous viewer sees something that has a pointer cursor, lights up under the cursor, and
sits exactly where the working buttons sit on every other card — and tapping it does nothing at
all, with no message. On a phone, where there is no hover and no cursor to read, a tap that
produces no response is indistinguishable from a tap that missed. That is the reported
"confusing flash".

**Change:** these spans should either not look interactive, or should be interactive and offer the
thing the viewer actually needs — a way to sign in. The second is better: the count is worth
keeping and the tap is worth answering.

- Give the inert branches their own class (`.action-static` or similar) that keeps the layout and
  the muted colour but drops `cursor: pointer` and the hover shift.
- Make the ♡ and 💬 real buttons for anonymous viewers that open a small "Sign in to like this" /
  "Sign in to reply" prompt with sign-in and create-account links. One shared component; 1.2 uses
  it too.
- Do **not** touch `PROVIDER_CAPS`, `capabilitiesFor`, or `statusCaps`. They are correct.
- Leave the 🔁 branch alone: for anonymous viewers `shareMenuActions()` reduces to `['share']` and
  the button opens the share dialog, which genuinely works. Sharing anonymously is a real feature,
  not a lie.
- Bookmark likewise already routes to `AnonymousBookmarks` (`status-card.ts:1187`) and works.

**Files:** `status-card/status-card.{html,css,ts}`, new `sign-in-prompt/` component. Specs:
`status-card.spec.ts`.

## 1.2 — The comment button leads nowhere for anonymous

**Now:** same root cause as 1.1. The 💬 for an anonymous viewer is the inert span at
`status-card.html:366`, so "clicking the comment button does not take you to thread" is literally
true — it is not a control, it just looks like one.

**Change:** for anonymous viewers the 💬 becomes a real link to `threadLink`, so it does the
thing a reader expects: show the replies. Reading a thread never needed an account. The sign-in
prompt from 1.1 belongs on the *reply composer*, not on the path to reading.

Where `threadLink` is null (see 1.3), fall back to the sign-in prompt rather than rendering a dead
link.

## 1.3 — Bundles → Collection → post preview → thread

**Status: the original diagnosis is REFUTED. Verified 2026-09-01 by probe spec, not by reading.**

The first draft claimed the sampled statuses carried an incomplete `providerRef`, leaving
`threadLink` null and the card inert. Two throwaway probe specs disproved every step of that:

1. Driving `CollectionPage.loadSample()` against a shipped kit and flushing a realistic status
   yields a fully-formed post — `providerRef: { server: 'https://mastodon.art', statusId: '110',
   accountId: 'acc-1' }`, `id: 'anonymous-mastodon:mastodon.art:110'`. `anonymousApi.getAccountStatuses`
   maps through `adaptAnonymousStatus` (`anonymous-mastodon-provider.ts:112`), which always
   populates all three fields.
2. Rendering a `StatusCard` on that exact status as an anonymous viewer gives
   `article.status-clickable` **present**, and dispatching mousedown+click on the body navigates to
   `['/statuses', 'anonymous-status.eyJzZXJ2ZXI...']`. The card works.

So the sample → thread path is intact at the collection and card layers.

**What the probe did surface** is the likely real report. The anonymous action row renders as:

```
SPAN.action :: 💬 2 replies
SPAN.action :: 🔁 0 boosts
SPAN.action :: ⭐ 3 favourites
A.action.open-original :: ↗ Open original
BUTTON.action :: 🔖
```

There is **no thread affordance in the action row at all** for an anonymous viewer, and the 💬 —
the thing everyone taps to reach comments — is one of the inert spans from 1.1. A reader tapping
💬 on a preview post gets nothing and concludes the post has no thread. The card body does work,
but nothing indicates that the body is the target.

Note the 🔁 is inert here too: this status has no `display.url`, so the anonymous share branch
(`status-card.html:632`-ish) fell through to a bare span. The earlier claim that anonymous 🔁
always opens the share dialog holds only when the status carries a URL.

**Change:** folded into 1.1 and 1.2 — make 💬 a real link to `threadLink` for anonymous viewers.
No separate fix is needed here, and **no change to the collection sampler**.

**Keep** a regression spec asserting a sampled collection post yields a non-null `threadLink`: it
passes today and is worth locking in.

**If the boss can still reproduce a dead post in Bundles → View Collection → Posts Preview** after
1.1/1.2 ship, the remaining suspects are the thread *page* resolving
`anonymous-status.<base64>` (`anonymous-route-ref.ts:57`), and the non-shipped branch of
`loadSample()`, which takes `this.api.getAccountStatuses(account.id, …)` and does **not** adapt —
those statuses would keep raw ids and `provider: undefined`. That branch was not probed.

## 1.4 — The search result bio is not clickable

**Now:** `account-result-card.html` makes links of `.acct-avatar-link` (the face) and `.acct-name`.
The bio is `<div class="acct-bio" appRenderedHtmlLinks [innerHTML]="a.note">`. On a phone that
leaves a ~40px face and a short name as the only way to a profile, under several lines of text
that look exactly like a card body you should be able to tap. New users conclude the profile is
unavailable; the truth is the hit target is small.

**Change:** make the whole card open the profile, with the same decline-list discipline the status
card already uses. `status-card.ts:222` `INTERACTIVE_SELECTOR` and `onCardClick` are the pattern —
reuse the approach rather than re-deriving it. Specifically:

- The bio contains real links (`appRenderedHtmlLinks` renders the account's own `<a>` tags). Those
  must keep working: they are in the decline list by virtue of being `a`.
- The Follow button, the `•••` moderation `<details>`, and the "matched on" post cards inside
  `.acct-matches` must all keep their own clicks. `.acct-matches` needs to be *added* to the
  decline list — a nested `app-status-card` has its own navigation and must win.
- Text selection: honour the same `mousedown` snapshot the status card uses. See 1.5.

**Files:** `pages/search/account-result-card.{html,ts,css}`, spec.

## 1.5 — Text in posts is hard to select

**Now:** documented candidly at `status-card.ts:1055` — post text is wrapped in its own
`routerLink`, so a click on text navigates immediately, and a double-click navigates on the first
of the pair. `onCardMouseDown`/`onCardClick` correctly handle the *end-of-selection* click but
cannot help with text that is itself a link. On a phone, a long-press to select competes with the
link's own tap handling.

**Change:** remove the routerLink from the post *text* and let the card-level `onCardClick` be the
single navigation path. The card handler already exists, already declines interactive targets, and
already snapshots the selection — it was built to make image-only posts clickable and it
subsumes the text link's job entirely. Losing the anchor loses nothing a keyboard user has:
`onCardKeydown` handles Enter and `o`, and `threadLink` is unchanged.

**Watch for:** any spec asserting the text anchor exists, and any CSS keyed to it. Also check
whether the text anchor is what gives the post its visited-link colour, and restore that on the
card if so.

## 1.6 — "John Doe retweeted this" is not a link

**Now:** `status-card.html:12` renders `{{ boostedBy }}` as bare text inside `.boost-label`. The
booster's account is available — `status-card.ts:1181` has a `booster` getter returning
`s.reblog ? s.account : null`, already used for follow-trust. So the destination exists and simply
is not offered. A user who wants to mute this person's boosts has to go and search their name.

**Change:** wrap the name in a `routerLink` to the booster's profile, built the same way
`accountLink` builds one (`accountRoutePath` with the qualified handle, so it survives a change of
server). An `app-account-hover-card` on it would match the treatment the author's name already
gets, and answers "who is John Doe" without a navigation.

**Files:** `status-card/status-card.html`, `status-card.ts` (expose a `boosterLink`), spec.

---

## Definition of done

- `cd ui && make test` green.
- Anonymous: ♡ / 🔁 / reply never issue a failing network request; each offers a sign-in path.
- Anonymous: bookmark, share, drafts and the practice box are untouched.
- A sampled collection post opens its thread.
- The whole search result card opens the profile; its inner links and buttons still work.
- Post text can be selected by drag and by long-press.
- The boost attribution name is a link.
