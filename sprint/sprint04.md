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

### Sprint A — foundation + theming + blue checks
1. [ ] `client-prefs.ts`: localStorage-backed signals service — themeMode
       ('light'|'dark'|'auto'), accent preset id, undoSend (bool), readerFontSize (later).
2. [ ] Dark palette + accent presets: `:root[data-theme='dark']` var overrides in
       `styles.css`; accent presets as `[data-accent='...']` overrides. Applied on
       `document.documentElement` by an effect in the prefs service (works on every route).
3. [ ] Appearance settings page: theme selector + accent swatches drive ClientPrefs
       (instant apply); non-theme prefs still save to mock blob only when `server.isMock`
       (guarded so the page also works on mastodon.social).
4. [ ] Blue check: `verified-badge` shared component; shown in status-card header +
       profile page when `followers_count >= 50000` or account is the viewer's own
       (self-check gets the "only you can see this" tooltip + subtle style variant).
5. [ ] Specs for prefs service + badge rules.

### Sprint B — compose powers
6. [ ] Delete & Repost on own statuses in status-card: getStatusSource → deleteStatus →
       composer seeded with text, new post emitted so containers swap it in.
7. [ ] Auto-split: if text > 500 chars, split at word boundaries into (i/n)-suffixed chunks;
       first chunk posted with original options, rest chained as self-replies. Preview hint
       in composer ("will post as a thread of N").
8. [ ] Undo-send: when pref enabled, submit → confirm prompt → 30s countdown banner with
       Cancel; POST deferred until countdown elapses. Pref toggle in Appearance settings.
9. [ ] Specs: split algorithm, undo-send timer (fake timers), delete&repost flow.

### Sprint C — reader mode + bookmark library
10. [ ] Reader mode: toggle on thread page; renders the same-author chain (root author's
        posts, in order) as a clean article — larger serif type, no action bars, media
        inline; font-size control persisted via readerFontSize pref.
11. [ ] Bookmark library: bookmarks page gets computed group tabs — All / By author /
        By hashtag / With media — pure client over the fetched list.
12. [ ] Specs for grouping + reader chain logic.

### Wrap-up
13. [ ] Full check: `npm test`, `ng build` (both configs), lint; one commit per sprint.

## Status log
- 2026-07-13: Sprint doc created; decisions confirmed with user via Q&A. Work not started.
