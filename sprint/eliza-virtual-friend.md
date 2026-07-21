# Eliza — the virtual friend

A synthetic account you can follow and talk to, so that **anonymous users, brand-new
users, and the friendless** have someone in their feed and their chat on day one.
Eliza is a 1966 ELIZA chatbot wearing a Mastodon account: she pattern-matches
("…and how do you feel about that?"), answers FAQs by keyword, and gently reminds you
that none of this is really posting to Mastodon.

She is **not a real account and never touches the network.** She is an *interception
layer* the two feed providers share.

---

## 1. Who she's for, and what "following" unlocks

| User | Can find Eliza? | Can follow her? | Once followed |
|---|---|---|---|
| **Anonymous** (no account) | Yes — via **`… More` → Eliza**, and as a pseudo-post in the empty feed | Yes (local follow) | Local compose + Eliza feed replies + Eliza DM thread |
| **New authed user** (0 real follows) | Yes — same `… More` entry | Yes | Same, plus it coexists with real posts/chats |
| **Established authed user** | Yes — same `… More` entry | Yes | Same |

She is deliberately **not** in account search — she'd pollute real results and she isn't
a real handle. The only doors to her are the **More menu** and the **empty-feed pseudo-post**.

Her bio does the expectation-setting:

> 🐦 I'm Eliza, your practice friend. As an anonymous visitor you can't really follow,
> post, or reply on Mastodon yet — but you *can* do all of it **with me**, right here in
> your browser. Follow me and let's talk. (Nothing here leaves your device.)

---

## 2. The core idea: Eliza is an interception layer, not an account

The repo already has the exact shape we need. The **anonymous provider**
(`providers/anonymous/*`) is a localStorage-backed fake backend that intercepts network
calls and answers them from the browser. Eliza is the same trick, narrowed to one
"account", and **lifted so both providers can use it.**

```
                    ┌─────────────────────────────┐
   compose / send   │   ElizaService  (new)       │
   / follow / chat  │   - is this call about       │
   ──────────────▶  │     Eliza?  → handle locally │
                    │   - ELIZA engine + FAQ       │
                    │   - LocalPostStore (new)     │
                    │   - LocalDmStore   (new)     │
                    └─────────────────────────────┘
                          ▲                    ▲
          intercepts here │                    │ intercepts here
                          │                    │
              AnonymousProvider          Authenticated path
              (already intercepts)       (api.ts — new thin check)
```

`ElizaService` is **provider-agnostic** (`providedIn: 'root'`, pure client-side, no HTTP).
Both callers ask it *"is this yours?"* before hitting the wire.

### The two interception seams

1. **Anonymous provider** — already the interceptor. We add Eliza-awareness to
   `anonymous-follows`, the home feed merge, and a new local-DM path. This is the easy side.

2. **Authenticated path (`api.ts`)** — the harder side, because `api.ts` normally talks to
   real Mastodon. We add a **thin front-door check** on exactly three methods:
   - `postStatus()` — if `in_reply_to_id` targets an Eliza-authored local post → route to `ElizaService`, don't hit the network.
   - `conversations()` / DM send — if the target is Eliza → route to `ElizaService`.
   - follow/unfollow of Eliza's synthetic id → route to `ElizaService`.

   Everything else in `api.ts` is untouched and still hits real Mastodon. Eliza's synthetic
   ids use a reserved, un-real prefix (e.g. `eliza:self`) so the check is a cheap string test
   and can never collide with a real account id.

This is the "some other pattern" you flagged: for authed users we don't get free
interception, so we add a **minimal typed guard** at the top of three `api.ts` methods that
delegates to the same `ElizaService` the anonymous provider uses. One brain, two doors.

---

## 3. What the user actually experiences

### a. Discovery
- **`… More` menu** gets an `Eliza` entry (visible to *everyone* — anon and authed).
  Clicking it opens **her profile** at `/accounts/eliza:self` (or a dedicated
  `/eliza` route rendering the profile shell).
- **Empty feed:** alongside the existing starter-pack pseudo-post, add an
  **"Meet Eliza" pseudo-post** with a Follow button. (Same visual pattern as
  `anonymous-login-post` / `starter-pack-post` already in `home.html`.)

### b. Her profile
- Bio (above). Follower/following counts are cosmetic.
- **Pinned + timeline posts**: ~8–10 pre-written tips on using Mawkingbird and Mastodon
  (how to follow, what boosts are, keyboard shortcuts, the observability page, etc.).
  These come from the content datafile (§5) and render through the **normal
  `status-card`** — they look like real posts.
- A **Follow** button that works locally in both modes.

### c. Following her
- **Anon:** stored in `anonymous-follows` (already exists). Her posts now appear in the
  home feed merge.
- **Authed:** stored in a small `eliza-follow` local flag (their *real* following list on
  mastodon.social must not be touched). Her posts are merged into their feed locally.
- Following her is the **gate for the DM thread** (§d).

### d. Chat / DM — "How do you feel about that?"
- **Only if Eliza is followed** does a chat with her exist. On first follow, we seed the
  thread with one inbound DM: **"How do you feel about that?"**
- Anon users can't call the real chat API at all — so the chat **list and thread for Eliza
  are synthesized** from `LocalDmStore`, exactly like `conversations.ts` already synthesizes
  public chats client-side.
- Sending her a message → `ElizaService.reply(text)` runs the **ELIZA engine** (reflect
  pronouns, match a rule, fall back to "how do you feel about that?") *and* the **FAQ
  keyword matcher** (if the text hits a known topic, answer the FAQ instead). Reply is
  appended to `LocalDmStore` and rendered immediately.
- For anon users this means we finally give them a **reachable chat surface** — but scoped:
  it only ever contains the Eliza thread (the general chat guard stays for real DMs).

### e. Local compose + feed replies (general local compose — your v1 choice)
- Anon (and authed-talking-to-Eliza) users get a **working compose box** that writes to a
  new **`LocalPostStore`** (localStorage). These local posts render in the home feed merged
  with everything else, tagged subtly as local-only.
- **Every local post gets an immediate Eliza reply** threaded beneath it:
  > *Remember, this doesn't really post to Mastodon.* — followed by an ELIZA-style line
  > riffing on what you wrote.
- Replying to *her* posts works the same way (reply → local store → Eliza answers).

---

## 4. New building blocks (all client-side, all localStorage)

| Piece | Responsibility | Mirrors existing |
|---|---|---|
| `eliza/eliza.service.ts` | The brain: `reply(text)`, `faqMatch(text)`, `reflect(text)`; owns identity; the single delegate both providers call | — |
| `eliza/eliza-engine.ts` | Pure ELIZA reflection + rule matching (no Angular) | `sentiment.ts` (pure fn) |
| `eliza/eliza-content.ts` | **Datafile** — bio, tip posts, FAQ pairs, ELIZA rules (see §5) | `house-ads.ts`, `terminology.ts` |
| `eliza/local-post-store.ts` | localStorage feed of the user's own local posts + Eliza replies | `anonymous-bookmarks.ts` |
| `eliza/local-dm-store.ts` | localStorage Eliza DM thread + read state | `anonymous-lists.ts` |
| `eliza/eliza-follow.ts` | Follow flag (authed path) + bridges to `anonymous-follows` (anon path) | `anonymous-follows.ts` |

**Interception edits (small):**
- `api.ts` — three front-door checks (postStatus, conversations/DM send, follow).
- `anonymous-mastodon-provider.ts` — merge Eliza posts + local posts into the feed.
- `conversations.ts` — surface the synthesized Eliza chat; unlock it when she's followed.
- `home.html` — "Meet Eliza" pseudo-post; enable local compose for anon.
- `shell.html` — `Eliza` link in the More menu.
- Account resolution — teach the profile/account lookup to return Eliza's synthetic
  account for `eliza:self` without a network call.

**Capabilities:** `AnonymousCapabilities` stays the central policy. We don't loosen
`canCompose` globally — instead compose/reply/DM check *"is this Eliza-directed?"* and, if so,
bypass the real-network restriction via `ElizaService`. Real Mastodon actions stay blocked
for anon exactly as today.

---

## 5. Content datafile (you author-by-editing; I write the first full pass)

`eliza/eliza-content.ts` — plain typed data, isolated from logic, so you can rewrite copy
freely without touching code:

```ts
export const ELIZA_BIO = `…`;

export interface ElizaPost { id: string; body: string; pinned?: boolean; }
export const ELIZA_POSTS: ElizaPost[] = [ /* ~8–10 tips */ ];

export interface FaqPair { keywords: string[]; answer: string; }
export const ELIZA_FAQ: FaqPair[] = [ /* ~15 pairs */ ];

export interface ElizaRule { pattern: RegExp; responses: string[]; }
export const ELIZA_RULES: ElizaRule[] = [ /* classic reflections */ ];

export const ELIZA_FALLBACK = ['How do you feel about that?', /* … */];
export const LOCAL_POST_DISCLAIMER = `Remember, this doesn't really post to Mastodon.`;
```

I'll write production copy for all of it; you edit the strings, not the wiring.

---

## 6. Open risks / things to watch
- **Never write to the real following list.** Authed follow of Eliza is a *local* flag only.
- **Synthetic id namespace** (`eliza:*`) must be provably un-real so the `api.ts` checks can't
  intercept a real account.
- **status-card** must render a local/synthetic status without trying favourite/reblog/reply-to-network
  (reuse the anon `statusCaps` → `{reply:false…}` shaping, but allow local reply to Eliza).
- Keep the ELIZA engine pure and unit-tested (like `sentiment.spec.ts`) — deterministic given a seed.

---

## 7. Suggested build order (sprints)
1. **Brain + content**: `eliza-engine`, `eliza-content` datafile, `eliza.service` + specs. No UI.
2. **Identity + profile**: synthetic account resolution, `/eliza` profile with pinned tips, More-menu link.
3. **Follow + feed**: local follow (both modes), merge her posts + "Meet Eliza" pseudo-post in empty feed.
4. **Local compose + feed replies**: `LocalPostStore`, compose enabled for anon, Eliza auto-reply threaded.
5. **Chat**: `LocalDmStore`, unlock scoped Eliza chat on follow, seed "How do you feel about that?", wire send→reply.
6. **Authed interception polish**: the three `api.ts` front-door checks + tests proving real calls are untouched.
