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
   `type === 'mention'` notifications, grouped by **participant set**
   (author + mentions, minus me). No per-thread context fetches just to build
   the list; context is fetched lazily when a chat is opened. Tradeoff:
   two distinct threads with the same people merge into one chat — that's
   deliberate, it reads like an IM history with those people.
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
- Specs rewritten (`conversations.spec.ts`) — run via `npm run test:ci` only.

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
