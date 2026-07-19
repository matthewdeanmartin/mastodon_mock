# Anonymous Mastodon — Sprint 1: account and provider foundation

Status: COMPLETE (2026-07-19)

## Goal

Introduce one permanent browser-local Anonymous account that can enter the real
application and coexist with authenticated Mastodon sessions. Establish the
provider-owned identity boundary without implementing anonymous follows or feed
acquisition yet.

## Locked product decisions

- Login offers **Continue anonymously**.
- There is exactly one Anonymous account per browser for now.
- Anonymous has an editable home instance; the initial default is mastodon.social.
- Entering Anonymous never removes or logs out saved authenticated accounts.
- The default identity is **Anonymous** with the selected instance shown as its handle.
- Anonymous data is local-only and provider-owned.
- No automatic polling or background refreshes.
- The legacy `/demo` remains completely independent.

## Planned changes

- Add a versioned `providers/anonymous/` identity store.
- Add explicit authenticated/anonymous account modes to `Auth`.
- Keep authenticated session persistence backward compatible.
- Expose Anonymous as a permanent account-switcher choice.
- Allow Anonymous through the normal shell guard without a fake token.
- Skip credential verification and authenticated Home startup calls in Anonymous mode.
- Add the login entry point and focused tests.

## Exit criteria

- Anonymous enters the real shell and survives reloads.
- Switching to Anonymous preserves all authenticated sessions.
- Switching back restores the saved token and home instance.
- Anonymous startup does not call `verify_credentials` or the authenticated home timeline.
- Existing authenticated behavior remains green.
- Sprint 2 has an explicit handoff document before this sprint closes.

## Outcome

Shipped as planned:

- `Auth` now selects an explicit `mastodon | anonymous` account mode while the
  existing authenticated-session payload remains backward compatible.
- Entering Anonymous removes only the active-token mirror. Every saved Mastodon
  session remains in the stable and can be restored through the account switcher.
- The permanent switcher choice is synthesized rather than stored as a fake
  token or duplicated session.
- `providers/anonymous/anonymous-account.ts` owns the versioned local identity
  and selected home instance. The default display is `Anonymous` with the
  actual instance as its handle.
- Anonymous gets the stable `_anonymous` client-storage scope.
- Login has a prominent **Continue anonymously** path. The embedded mock build
  correctly defaults this path to the real `mastodon.social`, never the mock.
- The auth guard accepts Anonymous, while Shell skips credential verification.
- Home skips the authenticated Mastodon home timeline, announcements, compose,
  and live-stream control during Anonymous startup. Bluesky is excluded from
  Anonymous provider linkage.
- The legacy `/demo` route and UI were not touched.

## Verification

- Focused suite: 6 files, 28 tests passed.
- Full `npm run test:ci`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed.
- `npm run build:mockingbird`: passed.
- TypeScript application compilation: passed.

## Handoff

Continue with `anonymous-mastodon-sprint02.md`. Sprint 2 must finish the
capability-aware UI before public account feeds are introduced; otherwise
authenticated-only routes and controls can still be reached manually.
