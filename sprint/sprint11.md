# Sprint 11 — Chat: the DM/Replies window becomes an IM client

Target: **Mockingbird**. Standing constraints: client-side only, must work
against real mastodon.social; prefs in localStorage via ClientPrefs; never use
`ad-*` class names (uBlock). Supersedes the sprint10 draft (not started —
ignore it per owner instruction).

## Goal

Rebuild `/conversations` as a full-width IM client ("Chat"). One conversation
list holding **both** kinds of chat, loudly badged:

- **🔒 Private** — Mastodon direct-visibility conversations from
  `/api/v1/conversations` (the only thing the old page showed).
- **📢 PUBLIC** — reply threads you're mentioned in, synthesized client-side
  from mention notifications, displayed in the same chat format. These get a
  **big honking banner** across the open thread ("every message here is
  visible to everyone") so nobody has a Representative Weiner moment.

Killer feature: instant-feedback IM feel. While the chat page is open, the
`direct` + `user` streams are connected (WebSocket, works against
mastodon.social per `streaming.ts`); leaving the page closes them. Nothing
else on the site changes — Home keeps its manual Live toggle.

## Decisions (owner Q&A, 2026-07-15)

1. **Public chat = threads I'm mentioned in.** Built from
   `type === 'mention'` notifications, grouped **by author (the reply guy)**.
   First cut grouped by participant set (author + mentions), but reply chains
   auto-mention different upthread people per message, so one thread splat
   into several rows. Owner's call: skip reply-graph identification entirely —
   all public mentions from steve are one chat with steve; public-steve and
   private-steve stay separate; my own replies join whichever chat they were
   sent from (they have no author key). Context is fetched lazily on open.
2. **One list, loud badges** (not tabs/sections). Rows sorted by last
   activity, badged 🔒 / 📢.
3. **Bubble actions**: Like, Bookmark, Open-as-post (link to
   `/statuses/:id`), Boost **on public chats only**. Reply is the composer
   itself. No boost on private (nonsensical for direct visibility).
4. **Streaming auto-on** while the page is open; auto-off on leave.

## Facts discovered (keep for next session)

- `/api/v1/conversations` returns **only** direct-visibility convs, and only
  `last_status` — the old page's "lost thread" bug. Real thread =
  `GET /statuses/:id/context` on the last status.
- **Private DMs are group chats**, but membership is just "who is
  @-mentioned" — a reply can silently add/drop people by editing mentions.
  The UI shows a hint about this above the private composer.
- `Status.mentions` existed on the wire but not in `models.ts`; added
  `Mention` + `mentions?` (the mock serializes them too —
  `serializers/statuses.py`).
- `api.ts` had `block()`/`unblockAccount()`/`unmuteAccount()` but **no
  account mute**; added `muteAccount()`.
- Full-width mode: `shell.ts` `wide` signal keyed on the URL; now
  `/settings` **or** `/conversations`.
- Read-state for public chats has no server side; stored in localStorage
  (`mockingbird_chat_read`, map chatKey→ISO of last seen).
- No Bluesky chat integration (owner: "is what it is") — bsky DMs need a
  different lexicon + service proxy, out of scope.

## Deliverables

- `pages/conversations/*` rewritten: list pane + thread pane, chat bubbles
  (mine right/accent, theirs left with avatar), mini-profile header with
  participant avatars and a ••• menu per participant (Mute / Block / Report —
  reuses `ReportDialog`), PUBLIC banner, composer pinned at bottom seeded
  with @mentions and correct visibility (direct for private; thread's own
  visibility for public replies).
- Streaming: `direct` stream (`conversation` events) upserts private rows and
  appends to an open private thread; `user` stream mention notifications
  upsert public rows / append to an open public thread; `update` events
  append replies to an open public thread.
- Chat-list filter toggles above the list: **Everyone | Mutuals** and
  **All | 🔒 Private | 📢 Public**, persisted as ClientPrefs (`chatAudience`,
  `chatKind`). Mutuals needs `/api/v1/accounts/relationships`; fetched lazily
  only when the toggle is first switched on (keeps request count down against
  mastodon.social).
- Leading `@mention` runs are elided from list previews AND bubbles
  (`stripLeadingMentions`, handles h-card markup and plain text; falls back to
  the original when a message is nothing but mentions).
- Specs rewritten (`conversations.spec.ts`) — run via `npm run test:ci` only.

## Round 3 (2026-07-15, owner feedback; runtime NOT verified — build+tests only)

- Private chat composer visibility is **locked to direct** (new Compose
  `lockVisibility` input renders a 🔒 label instead of the picker). No more
  accidentally-public replies from a DM.
- **Private chats now group by participant set** (`priv:<sorted accts>`),
  merging the API's one-row-per-thread conversations; mark-read marks every
  merged conv, thread view merges the merged convs' last statuses.
- Chat bubbles render **all** media attachments (the `type === 'image'`
  filter was dropping mock/real attachments).
- **Bluesky thread view**: `BlueskyApi.getPostThread` + thread page handles
  `bsky:at://…` ids (ancestors = parent chain, descendants = flattened reply
  tree); StatusCard now links bsky posts to `/statuses/:id` (`threadable`),
  RSS keeps "open original". Interactions on the bsky thread page still go
  through the Mastodon api service — known gap.
- Hover card hides the zero-filled stats row for foreign accounts
  (id contains `:`), rather than showing "0 posts, 0 followers" lies.
- Notifications page: **All | Friends | Followers** segmented filter
  (friends = I follow them; lazy `/accounts/relationships` fetch) plus a
  notification-type dropdown built from the types actually present.

## Verify live (next session, if not done)

1. Mock server + UI: open Messages — old direct seeds appear as 🔒 rows;
   thread shows full context as bubbles, not just the last message.
2. Post a mention to yourself from a second account → 📢 row appears
   without reloading (user stream), PUBLIC banner on open.
3. Reply from the composer in a public chat → posts with the thread's
   visibility (not direct), appears as a right-side bubble instantly.
4. Boost button absent on private bubbles, present on public.
5. Against mastodon.social: list loads, streams connect (check WS in
   devtools), no CORS surprises.
