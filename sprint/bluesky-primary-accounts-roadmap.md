# Bluesky-primary accounts roadmap

## Phase 1 — account model and alts (implemented)

- Store Bluesky-primary identities as DID-keyed profile and credential collections.
- Keep an explicit active DID and migrate the former singleton records in place.
- Show every inactive Bluesky alt in the account switcher and switch by DID.
- Let `/login?add=1` choose Mastodon or Bluesky; expose both choices directly in the account menu.
- Let `/login/bluesky?add=1` add or replace one DID without replacing other Bluesky identities.
- Include Bluesky identities in Signed-in accounts and Local storage, including DID-scoped cleanup.
- Keep the existing app-password transport temporarily so the account-model change is independently shippable.

## Phase 2 — AT Protocol OAuth transport (implemented)

- Add `@atproto/oauth-client-browser` and a public HTTPS OAuth client-metadata document.
- Implement discovery, authorization redirect, callback handling, PKCE/PAR/DPoP, refresh, and restored sessions through the SDK.
- Store OAuth session references by DID behind the Phase 1 identity-store API; consumers should not care whether a session came from OAuth or the legacy login.
- Make OAuth the default Bluesky login and offer app passwords only as an explicitly labelled compatibility path during migration.
- Add production, preview, mirror, and localhost redirect coverage. Each static deployment stamps its own discoverable metadata document; the final live authorization-server smoke test is a deployment check because it requires a real account approval.

## Phase 3 — connector parity and paid-product hardening

- Move Bluesky connector login to OAuth as well, with scopes appropriate to connector capabilities.
- Request the narrowest permission sets needed for reading, posting, media, chat, and moderation; explain incremental grants in product copy.
- Harden refresh/revocation/re-auth UX per DID, including self-hosted PDS and handle-change cases.
- Decide which encrypted material, if any, may sync across devices without creating multi-device token-rotation conflicts.
- Add account-level diagnostics, accessibility passes, telemetry that never records handles/DIDs, and multi-alt browser E2E coverage.
