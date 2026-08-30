# i18n Sprint 4 — Shell, feed, status card, compose

Status: PLANNED
Depends on: [[ui-i18n-3-settings]]

## Goal

Migrate the surfaces every user sees on every visit: `shell/` (nav, rails, menus), `status-card/`,
`compose/`, and `pages/home/`. After this sprint a forced locale looks genuinely translated rather
than a translated Settings page bolted to an English app.

## Why this is the risky one

Settings was leaves. This is the trunk — `shell.html` is 496 lines rendered on every route,
`status-card.html` is 1126 lines rendered once per post in every feed, and `compose.html` is 811.
A mistake here is on every page at once. Three specific hazards:

### 1. Terminology collision

`status-card` and `compose` are the heaviest consumers of `terminology.ts` — the post/tweet/florp
vocabulary — and `check-terminology.mjs` guards them. This sprint is where the two systems meet,
and the interaction must be handled deliberately rather than discovered.

Per [[ui-i18n-0-overview]], terminology stays English-only. Concretely:

- Strings that interpolate a `words()` value keep doing so under `en`.
- Under a non-`en` locale, the vocabulary resolves to the **canonical noun from that locale's
  dictionary** — `de.json` says `Beitrag`, and it does not vary by vocabulary setting.
- The Blue vocabulary picker renders only under `en`.

The composition problem is real and must not be papered over: `Boosted by {name}` with `Boost`
substituted from `words()` works in English and produces garbage in a case-marking language. Under
non-`en`, use a **fully-formed translated string** (`"status.boostedBy": "Geteilt von {name}"`) —
not an English template with a translated noun spliced in. Never build a sentence by concatenating
a translated noun into a translated frame.

### 2. Test exposure

`status-card` and `shell` are the most heavily specced components in the app, and `test-setup.ts`
already documents them as the ones that flake under worker contention. Most of the 279
English-text assertions live here. The [[ui-i18n-1-foundation]] harness keeps them passing by
resolving keys to English synchronously — this sprint is the real test of that claim. If it holds
here, it holds.

### 3. Density and truncation

Feed and nav are the tightest layouts in the app: icon buttons, counts, single-word nav labels.
This is where `max` budgets earn their place, and where German and Finnish will visibly overflow.
Set `max` on every button and nav label in this sprint's context entries — retrofitting them after
eight locales exist means re-checking eight files.

## Work

Order, safest first: `pages/home/` → `shell/left-rail` → `shell/right-rail` → `shell/shell.html`
→ `compose/` → `status-card/`.

`status-card` last, deliberately: it is the largest, the most specced, and the most
terminology-entangled, so it benefits from the convention being fully settled first.

Add each to `MIGRATED` as it lands.

**Not translated here:** post content, account display names, hashtags, handles, server-supplied
labels, RSS titles and article bodies. All of it is other people's text passing through. Mark
`dnt` where a key sits adjacent to one so the distinction is explicit in context.

## Done when

- [ ] `shell/`, `status-card/`, `compose/`, `pages/home/` are all in `MIGRATED`.
- [ ] The full suite passes with no changes to existing English-text assertions.
- [ ] `check:terminology` still passes; the two gates coexist without exemptions being loosened.
- [ ] Every button and nav label added in this sprint has a `max` budget in context.
- [ ] Forcing `de` (with the rehearsal dictionary) shows a coherent shell — no half-translated
      sentences, no concatenated nouns.
