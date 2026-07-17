# Sprint 14 — ✨ Algo: a consumer-centric algorithmic feed

New epic. Standing constraints unchanged: Mockingbird target, `ui/` only (mock
server is for integration tests), must work against mastodon.social, prefs are
client-side in `ClientPrefs`/localStorage, no `ad-*` class names.

## Product vibe (from the request)

An algorithmic feed that serves the reader, not engagement metrics:

- Show content the user *already asked for* (follows, followed hashtags),
  sorted by quality signals — likes × boosts × replies.
- Not network-focused; **no trending injection** ("if it's really good it will
  reach my feed organically").
- Toggle between friends content and platform (hashtag-discovered) content.
- A client-side sentiment ("rage") filter, because raw engagement also rewards
  inflammatory content.

## Decisions made (with the boss)

- **Sentiment engine**: `@tensorflow-models/toxicity` rejected — ~25–28 MB
  model (Universal Sentence Encoder) + tfjs runtime, multi-second cold start.
  Instead: a small embedded VADER/AFINN-style lexicon (`sentiment.ts`), zero
  dependencies, synchronous.
- **Rage filter behavior**: a toggle chip; when on, flagged posts are hidden
  entirely (transparent + reversible; no shadow downranking).
- **Friends vs platform**: friends = mutuals' top posts + top boosts/originals
  from the home feed; platform = hashtag-bucket posts by accounts the user
  doesn't follow. Hashtag posts from followed accounts count as friends.
- **API budget** (hard cap 20 calls, stop early at 100 posts):
  ~2 discovery (following + followers → mutuals), ~8 mutual samples,
  ~5 home-timeline pages (~100 posts, feeds both boost and original buckets),
  1 followed-tags + ~2 pages of one randomly chosen followed hashtag.
- **Caching**: feed is built once and held in the injectable service; nav
  back/forward is instant; explicit 🔄 Refresh rebuilds.
- **Ranking**: smoothed product `(favs+1) × (boosts+1) × (replies+1)` on the
  boost *target* — a literal product would zero anything with no replies.
- **Nav**: `✨ Algo` slots between Home and Notifications; the topbar
  Notifications entry is relabeled **Inbox** (label only — routes, variable
  names, and every other surface keep "notifications").

## Planned changes

- `ui/src/app/api.ts`: add `accountFollowing()` (mirror of
  `accountFollowers`).
- `ui/src/app/sentiment.ts` (+spec): lexicon, `rageScore()`, `isHeated()` —
  word weights plus ALL-CAPS and exclamation-density cues.
- `ui/src/app/algo-feed.ts` (+spec): the budgeted builder service; buckets
  tagged `mutual | boost | original | hashtag`; dedupe by boost target;
  cached result + `refresh()`.
- `ui/src/app/client-prefs.ts`: `algoAudience` (`all | friends | platform`)
  and `algoCalm` (rage filter on/off), persisted.
- `ui/src/app/pages/algo/` (+spec): the page — chips, per-post "why you're
  seeing this" source line, refresh, empty/error states.
- `ui/src/app/app.routes.ts`: `/algo` inside the authed shell.
- `ui/src/app/shell/shell.html`: nav entry + Inbox relabel.

## Outcome

Shipped and verified. All planned changes landed as designed; nothing was cut.

### Verification

- `npm run format` / `lint` / `build` / `build:mockingbird`: all clean.
- `npm run test:ci`: **78 files, 645 specs, all green** (3 new spec files:
  `sentiment.spec.ts`, `algo-feed.spec.ts`, `pages/algo/algo.spec.ts`).
- Runtime (Playwright vs `serve --in-memory --demo`): nav order is
  Home → ✨ Algo → Inbox; `/algo` builds from 5 API calls on the demo seed,
  renders ranked cards with per-post source lines ("Top post from a mutual",
  "Top post from your feed"); Everything/Friends/Platform/Calm chips and
  Refresh all work without errors.

### Implementation notes

- The build is one RxJS chain of budgeted phases; a shared `budget()` closure
  meters every fetch against the 20-call cap and swallows individual failures
  (a dead bucket contributes nothing — no whole-feed error).
- Dedupe is keyed on the boost *target* id, and the most specific source wins
  (a mutual's post found again as a home boost stays "mutual").
- Replies and the user's own posts are excluded from the pool.
- Calm mode checks the boost target's content **and** its content warning.

### Known gaps / follow-ups

- Mutual discovery reads one page (80) of following/followers each — heavy
  followers lists undercount mutuals. Acceptable at budget; could paginate.
- The rage lexicon is English-only and blunt by design; no per-word user
  tuning UI.
- No pagination/infinite scroll on `/algo` — it's a fixed ranked batch of up
  to 100, by spec.
- `demo` (logged-out) mode has no Algo feed — it needs an account for
  mutuals/home, so the nav entry only exists inside the authed shell.
