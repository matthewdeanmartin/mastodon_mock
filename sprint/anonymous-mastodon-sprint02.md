# Anonymous Mastodon — Sprint 2: local profile and capability-aware real UI

Status: COMPLETE (2026-07-19)

## Starting point

Sprint 1 established one provider-owned Anonymous identity, explicit account
modes, login/switching, a stable local namespace, and a safe empty Home startup.
It deliberately did not retrofit every page or status action. Anonymous can
therefore enter the real shell, but deep links can still reach components that
assume an authenticated Mastodon user.

## Goal

Make the existing real UI intentionally read-only and locally configurable in
Anonymous mode. Centralize capability decisions so later feed, list, tag, and
bookmark work does not scatter `isAnonymous` checks through feature code.

## Product constraints

- One Anonymous account only.
- All profile fields are editable and local.
- Inbox, Chat, and Favourites are unavailable and hidden.
- Writing, replying, boosting, favouriting, editing, deleting, and reporting
  are unavailable.
- Bookmarks remain visible as a promised local capability; persistence lands
  with the local collections sprint.
- Search, Lists, Tags, Home, Algo, profile, and appropriate settings remain in
  the real shell.
- No Bluesky connection or anonymous Bluesky data.
- No background polling.

## Planned changes

### 1. Central capability policy

- Add a provider-owned Anonymous capability policy/facade covering navigation,
  compose, status actions, relationships, streaming, and server mutations.
- Expose neutral app-level queries where shared components need them; keep
  Anonymous implementation details under `providers/anonymous/`.
- Audit status-card menus, hover cards, profile actions, keyboard shortcuts,
  command-bar actions, and compose entry points against the policy.

### 2. Navigation and route safety

- Hide Inbox, Chat, and Favourites from the top/More navigation.
- Hide authenticated-only settings and development/admin surfaces.
- Add an Anonymous-aware route guard or page adapter so direct URLs never fire
  authenticated requests before redirecting or explaining the limitation.
- Keep Bookmarks routed, with a local-ready empty state until its store lands.
- Ensure the old `/demo` remains independent.

### 3. Local profile editor

- Adapt the existing profile settings UI through the Anonymous provider.
- Persist display name, username, bio, avatar, header, and metadata fields.
- Preserve the selected instance independently from customized identity data.
- Validate URLs and field sizes locally; sanitize rendered bio/field HTML using
  the same trust boundary as remote profile content.
- Add reset-to-default behavior without deleting follows or other future state.

### 4. Read-only shell polish

- Add concise local-only/anonymous context where needed.
- Remove posting suggestions from empty states.
- Prevent keyboard shortcuts from opening compose.
- Ensure account/profile links for the local identity never call
  `/api/v1/accounts/anonymous`.
- Keep public instance information and trends best-effort and token-free.

## Acceptance criteria

- No visible or keyboard-accessible writing UI remains in Anonymous mode.
- Inbox, Chat, and Favourites are absent, and direct navigation is safe.
- No Anonymous interaction invokes authenticated mutation endpoints.
- Every supported profile field persists across reload and instance switching.
- Demo and authenticated account behavior remain unchanged.
- Focused tests cover the capability policy, route behavior, local profile
  persistence, navigation, and keyboard/StatusCard gates.
- Full lint, test, admin build, and Mockingbird build pass.

## Deferred to Sprint 3

- Local Follow/Unfollow interception.
- The 20-account store and relationship facade.
- API-first public account resolution and status acquisition.
- Feed merging, caching, timeouts, and RSS fallback.

## Outcome

- Added a central `AnonymousCapabilities` policy for compose, relationships,
  status interactions, server mutations, bookmarks, and Bluesky. Shared UI now
  asks this policy instead of duplicating provider rules.
- Added an Anonymous route guard and a friendly unavailable page. Direct links
  to authenticated-only features are intercepted before their components can
  issue API calls.
- Hid Inbox, Chat, Favourites, Drafts, Analytics, and Observability navigation,
  and reduced Settings to local-safe pages.
- Removed reply, quote, boost, favourite, bookmark, poll, report, edit, delete,
  mute, translate, and history actions from Anonymous status cards. Defensive
  method guards also prevent calls from keyboard/programmatic entry points.
- Disabled compose and authenticated navigation shortcuts in Anonymous mode.
- Kept Search available and token-free. Its authenticated bulk-follow prompt is
  suppressed until local follows land.
- Kept Bookmarks visible with a safe local placeholder; the store remains part
  of the local collections sprint.
- Adapted the real Public profile settings page for the provider-owned local
  identity. Display name, handle, bio, avatar, header, and four metadata fields
  persist locally; text is size-limited and HTML-escaped. Reset retains the
  selected home instance.
- Adapted the real profile page to render `_anonymous` locally without calling
  `/api/v1/accounts/anonymous`. Remote profiles remain anonymously readable,
  but relationship controls are withheld until Sprint 3.
- Anonymous Connections exposes RSS but not Bluesky.
- The legacy `/demo` remains independent.

## Verification

- TypeScript application compilation: passed.
- Focused Anonymous/UI suite: 6 files, 77 tests passed.
- Search/provider regression suite: 4 files, 22 tests passed.
- Full `npm run test:ci` coverage-enabled Angular suite: passed.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed.
- `npm run build:mockingbird`: passed.
- Repository-wide format check remains red on seven pre-existing/unrelated
  files; every Sprint 2 file was formatted and `git diff --check` passed.

## Handoff

Continue with `anonymous-mastodon-sprint03.md`. The capability policy currently
reports relationships as unavailable. Sprint 3 should turn that one capability
on only after local follow storage and the API-first feed provider are wired
through the existing relationship and feed facades.
