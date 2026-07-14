# Sprint 04–06 — "Blue" features for Mockingbird (client-side only)

## Goal
Give the Mockingbird UI the client-side features Twitter Blue users got. **Everything must
work against mastodon.social as well as the local mock** → no new backend endpoints, no
`_mock` API usage for these features. Prefs persist in **localStorage**.

## Decisions (user-confirmed 2026-07-13)
- **Blue check — both rules**: any account with `followers_count >= 50000` shows a check to
  everyone; additionally the logged-in user's own account always shows a (self-only) check,
  tooltip along the lines of "verified: you know it's really you". Efficient: follower count
  already ships on every Account object — pure render rule.
- **Bookmark library — auto-group only, pure client**: no folder management; the bookmarks
  page presents computed groupings (by author, by hashtag, with-media). Zero storage.
- **Undo send — opt-in, client-side, localStorage**: Preferences toggle enables a
  "do you really want to post that?" confirm + 30s countdown with Cancel before the POST fires.
- **Theming — light/dark/auto + accent presets, localStorage** (NOT the server settings blob;
  that blob is mock-only and doesn't exist on mastodon.social).
- Reader mode: distraction-free article view of a thread's same-author chain.
- Delete & Repost: fetch source text, delete status, reopen composer seeded with the text.
- Auto-split: posts over the 500-char limit are split at word boundaries into a self-reply
  thread with (i/n) markers, posted sequentially.

## Key facts
- UI: Angular 21, signals, standalone components. `ui/src/app/`.
- `Server` service (`server.ts`) holds instance base URL; `environment.allowThisServer`
  distinguishes mock-embedded vs standalone Mockingbird build. localStorage patterns already
  used in `auth.ts` / `server.ts`.
- Theming hooks: global CSS vars in `ui/src/styles.css` (`--bg`, `--col-bg`, `--border`,
  `--text`, `--muted`, `--accent`, `--accent-hover`, `--accent-soft`, `--hover`).
- Existing appearance page (`pages/settings/appearance/`) saves `theme` to
  `/api/v1/_mock/settings` but never applies it — theme/accent move to the new client prefs
  service; the rest of that page (media/motion/spoilers) stays on the mock blob.
- `status-card/` renders every post; `compose/` is the composer (no char limit currently).
- Thread page: `pages/thread/`. Bookmarks: `pages/bookmarks/` (flat list).
- Commands: `cd ui && npm test` (vitest via `ng test`), `npx ng build`. Python side untouched.

## Task board

### Sprint A — foundation + theming + blue checks — DONE
1. [x] `client-prefs.ts`: localStorage-backed signals service — themeMode
       ('light'|'dark'|'auto'), accent preset id, undoSend (bool), readerFontSize.
2. [x] Dark palette + accent presets in `styles.css` (`data-theme`/`data-accent` on <html>,
       applied by an effect in ClientPrefs; service eagerly injected in `app.ts`).
3. [x] Appearance settings page: theme radios + accent swatches drive ClientPrefs (instant
       apply); undo-send toggle added here too (task 8 pref); server-backed rows (media/
       motion/spoilers) hidden unless `server.isMock`.
4. [x] Blue check: `verified-badge/` component in status-card header + profile h2;
       >=50k followers → public check; own account → self-only check w/ tooltip.
5. [x] Specs: client-prefs.spec.ts (7), verified-badge.spec.ts (5), appearance spec updated.

### Sprint B — compose powers — DONE
6. [x] Delete & Repost (♻️ button on own statuses): getStatusSource → deleteStatus →
       inline composer seeded (preserves visibility + in_reply_to); posting emits
       changed(new) so containers swap in place; discarding emits deleted(old).
7. [x] Auto-split via `compose/post-splitter.ts` (`splitPost`, iterated (i/n) suffix
       budgeting, word-boundary cuts, hard-cut giant words); chained sequential posting
       in compose.send()/postRest(); "thread of N" hint + red over-limit counter.
8. [x] Undo-send: confirm + 30s setInterval countdown banner w/ Cancel (draft kept);
       canSubmit blocked while pending; timer cleared on destroy. Pref toggle was
       already added to Appearance in Sprint A.
9. [x] Specs: post-splitter.spec.ts (8), compose.spec.ts +7 (split chain, undo timers
       via vi.useFakeTimers, decline/cancel paths), status-card.spec.ts +4 (redraft).

### Sprint C — reader mode + bookmark library — DONE
10. [x] Reader mode: `pages/thread/reader-chain.ts` (readerChain: root + same-author
        self-reply chain, skips others' replies and author side-replies); Reader toggle
        appears when chain > 1; serif article view w/ author header, inline media,
        A−/A+ font control via prefs.readerFontSize (clamped 15–24px).
11. [x] Bookmark library: `pages/bookmarks/bookmark-groups.ts` (groupByAuthor,
        groupByHashtag incl. "no hashtags" shelf, withMedia; hashtags regex-parsed from
        rendered HTML; boosts group by original). Tabs All/By author/By hashtag/With media.
        Bookmarks onChanged switched from index-based to id-based patching.
12. [x] Specs: reader-chain.spec.ts (6), thread.spec.ts +3, bookmarks.spec.ts +4.

### Wrap-up — DONE
13. [x] Full check after each sprint: 50 spec files green, lint + prettier clean, both
        builds (`build`, `build:mockingbird`) pass. One commit per sprint on main.

## Status log
- 2026-07-13: Sprint doc created; decisions confirmed with user via Q&A.
- 2026-07-13: Sprint A done + committed ("feat(ui): client-side theming, accent colors, and
  blue verification checks"). 352 tests green, lint clean, both builds pass. Note: two spec
  files (shell, status-card) can flake with 5s timeouts under load — rerun before blaming
  your change. Next: Sprint B task 6 (Delete & Repost).
- 2026-07-13: Sprint B done + committed ("feat(ui): auto-split threads, undo-send countdown,
  delete & repost"). 49 spec files green, lint clean, both builds pass.
- 2026-07-13: Sprint C done + committed ("feat(ui): reader mode for threads and auto-grouped
  bookmark library"). ALL SPRINTS COMPLETE. Possible follow-ups (not requested): reduce_motion
  pref actually applying CSS, reader mode for CW posts, per-accent dark soft-tint tuning.
- 2026-07-13: Feedback round (commit a7be105): 📖 reader deep-link on status cards
  (?reader=1), Reader toggle always visible on threads, readerChain follows reply-to-root
  storms, blue-check threshold 50,000 → 9,728 (top-10,000 account), Appearance nav item
  un-mockOnly'd (theme buttons were invisible in the Mockingbird build — that was the "where
  are the theme buttons" bug), password form replaced with an /auth/edit link on real
  instances (Mastodon has no password-change client API).
