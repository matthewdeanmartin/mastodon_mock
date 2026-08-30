# i18n Sprint 5 — The long tail, and closing the ratchet

Status: PLANNED
Depends on: [[ui-i18n-4-shell-and-feed]]

## Goal

Migrate every remaining template, then **invert the `check-i18n` allowlist**: instead of listing
directories that are checked, list the few that are exempt, and check everything else by default.

That inversion is the point of the sprint. Until it happens, a brand-new directory is silently
unchecked and can ship hardcoded English without anyone noticing — the exact "breaks quietly when
a feature lands" failure the epic exists to prevent.

## Work

Everything not covered by Sprints 3 and 4. Roughly 90 templates across:

- `pages/` — search, write, profile, thread, explore, notifications, bookmarks, lists,
  conversations, observability, login, credits, about, algo, drafts, collection, posse, and the
  rest
- `admin/` — accounts, reports, trends, domains, announcements, blocks, metrics
- Dialogs and widgets — `confirm-dialog`, `list-dialog`, `history-dialog`, `lightbox`,
  `command-bar`, `emoji-picker`, `bulk-*`, `account-hover-card`, `feed-analytics`,
  `account-analytics`, `first-run`, `fail-whale`, `eliza`, `chat`, `invites`, `announcements`,
  `a11y`, and the remainder

Group into batches of related directories rather than one file at a time; each batch is a
reviewable commit that adds to `MIGRATED`.

## Priority within the tail

Not all of it matters equally, and the sprint may be split if it runs long:

- **High** — `first-run`, `login`, `fail-whale`, `command-bar`, `confirm-dialog`. First-run and
  login are a new user's *first* screens, which is exactly when browser-locale negotiation
  matters most; an untranslated first-run page defeats the negotiation feature entirely.
- **Medium** — the main `pages/`.
- **Low** — `admin/`, `observability/`, `pages/development`. Operator-facing surfaces used by
  people who chose to run a server. Reasonable to leave for last, and defensible to leave
  English-only long-term if the tail runs long — say so explicitly rather than leaving it
  ambiguous.

## Closing the ratchet

Once every directory is migrated, change `check-i18n.mjs` from an opt-in `MIGRATED` list to an
opt-out `EXEMPT` list, in the same style as `check-terminology.mjs`'s `ALLOWED` — each entry
carrying a `why`.

Expected exemptions:

- Generated files (`bundled-starter-kits.generated.ts`, `api-docs.generated.ts`) — text from
  elsewhere, per [[ui-i18n-0-overview]].
- Dev-only diagnostics not shown to end users.
- Anything genuinely untranslatable (ASCII art, the whale).

After this, a new component with hardcoded text fails `npm run check` by default. That is the
durable answer to "won't break the whole app when there is some new feature": the guard is on by
default, and turning it off for a directory is a visible, justified line in a reviewed file.

## Done when

- [ ] Every user-facing template renders from keys.
- [ ] `check-i18n.mjs` is opt-out; `MIGRATED` is gone.
- [ ] Every `EXEMPT` entry has a `why`.
- [ ] A deliberately added hardcoded string in a new directory fails `npm run check`.
- [ ] Full suite green; `en.json` regenerates clean.
