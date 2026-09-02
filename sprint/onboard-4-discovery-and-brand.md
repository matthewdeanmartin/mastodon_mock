# Onboarding sprint 4 — Discovery, feedback and the name of the app

Status: **COMPLETE** (2026-09-01). 19 tests added; `make test` green (5623 tests, 0 missing).

Decisions and corrections made during implementation:

- **4.1 merged onto `/bundled-starter-kits`**, which is where first-run already lands.
  `/bundled-collections` and `/starter-kits` are redirects to it, so every existing link works.
  The `BundledCollections` component became dead code and was deleted; its two tests and three of
  the old kits-page tests are gone from the manifest **deliberately**, and the baseline was updated
  with `check-test-manifest.mjs --update`. Coverage was re-checked first: the member-count and
  provenance assertions were carried into the merged page's spec rather than dropped.
- **The brand sweep renamed one i18n *key*** (`storageDiagnostics.keyNoteMockingbird`) as well as
  its value, and missed the matching `transloco.translate(...)` call — which would have shipped a
  visibly missing translation. Caught by `check:i18n`, and the key restored. Keys are storage-like
  identifiers: only values were meant to change.
- **Deleting English keys leaves orphans in every translated locale.** `de/fr/id/ja.json` each
  carried the removed `bundledCollections.*` and `pages.findFriends.bundledCollections.*` keys, and
  `check:i18n` treats an orphan as fatal. Pruned by hand — there is no tooling for it, which is
  worth knowing before the next feature deletion.
- **4.2's auto-sample fires on the Posts tab, not on arrival.** A shipped collection opens on
  *members* (`collection.ts:382`), so hooking page load would have done nothing.

The leftovers, which have less in common with each other than the first three sprints did. What
unites them is that each one costs a new user confidence rather than functionality.

---

## 4.1 — One place to find people

**Now:** `/find-friends` (`pages/find-friends/find-friends.html`) is a two-row menu. Row one goes
to `/bundled-starter-kits`, row two to `/bundled-collections`. The comment above them is honest
about the reasoning — starter kits lead because they work with no prior data — but the page still
asks a stranger to choose between two words they have no way to distinguish. `app.routes.ts:592`
records that `/starter-kits` once held both and was deliberately split, "because they are two
different things." They are. That distinction is real and it belongs to us, not to a new user.

**Change (settled):** **merge the surface, keep the routes.** One "Find people" page lists both
kinds in a single browsable, searchable list. `/bundled-starter-kits` and `/bundled-collections`
keep working as deep links and keep their own pages.

Specifics:

- The merged list is one set of cards. If the two kinds need to be distinguishable at all, that is
  a quiet secondary label on the card, never a fork in the road placed before the content.
- This page is where sprint 2's forced follow step lands, so it must have real people and real
  Follow buttons visible without a further click — see 2.1's first design question. Whichever
  answer that sprint picks, this page is the destination.
- Sprint 3.4 makes kits searchable; the corpus it searches should be this merged one.
- Ordering note: if sprint 2 ships first, it may build a temporary inline picker on
  `/find-friends`. Fold that into this page rather than leaving two.

**Files:** `pages/find-friends/*`, `pages/bundled-starter-kits/*`, `pages/bundled-collections/*`,
`starter-kits.ts`, `starter-collection.ts`, routes (redirects only).

## 4.2 — Collections should show posts without being asked

**Now:** `pages/collection/collection.html:146` puts a `.sample-box` above the feed: a size select
and a "Show me posts" button. Nothing loads until the button is pressed. The reasoning in the
template comment is sound — sampling costs one request per member, so it is the reader's choice.

But a first-time visitor to a collection sees a control panel where they expected a preview, and
"a list of names says little about whether you want these people in your timeline" is exactly the
argument for loading a small sample *by default*.

**Change:** load a small sample automatically on first view of the feed tab — three members, not
the current default — and keep the size select and "Sample again" for readers who want more. The
cost argument survives: three requests on a page someone deliberately opened is proportionate, and
the existing controls still gate anything larger.

Guard: `loadSample()` shuffles and slices `members().filter(m => m.state === 'accepted')`, so an
auto-sample must not fire before members have loaded, and must not re-fire on every tab switch.
`sampled` (line 454) is the flag to key off.

**Files:** `pages/collection/collection.{ts,html}`, spec.

## 4.3 — Slow actions give no sign of life

**Now:** `actionBusy` (`status-card.ts:1468`) is set around favourite, boost and one other action,
and the template uses it in exactly one way: `[disabled]="actionBusy()"` at five call sites
(`status-card.html:414, 440, 485, 572, 725`). A disabled icon button on a phone looks identical to
one that has not been pressed. So a tap that landed and a tap that missed produce the same
picture, and a slow network produces the same picture as both.

**Change:** give `actionBusy` a visible form on the button that is acting — a spinner, a pulse, or
an optimistic state change — and keep `[disabled]` for the correctness it already provides.

Two things worth getting right:

- **Optimistic update is the better answer where it is safe.** Favourite and boost both have a
  server-truth reconciliation path already (the subscribe blocks at `status-card.ts:1489` and
  `1553` set state from the response), so flipping the icon immediately and reverting on error
  gives instant feedback with no lie that lasts. Do this in preference to a spinner where the
  action is idempotent and cheap to revert.
- **Only the pressed button should react.** `actionBusy` is one signal for the whole card, so
  today it disables *all five* controls at once. If it drives visible state it must be
  per-action, or the card will appear to be doing five things.

The tiny-tap-target half of the complaint is real too: check the action row's hit areas against
the 44px guidance on a phone viewport.

**Files:** `status-card/status-card.{ts,html,css}`, spec.

## 4.4 — The app has three names

**Now:**

| Name | Where |
|---|---|
| `Mawkingbird` | `ui/src/index.html:5` (page title), `first-run-modal.ts` welcome copy, `pages/home/home.html` pinned anonymous post, shell menu |
| `Mocking Bird` | `environments/environment.mockingbird.ts:12` — `brand: 'Mocking Bird'` |
| `mastodon_mock` | `environments/environment.ts:12` — `brand: 'mastodon_mock'` |

`pages/login/login.ts:172` renders `environment.brand` as the `<h1>`, so the login page says one
thing while the browser tab and the first-run modal say another. A visitor who is deciding whether
to trust this app with an account is shown two different product names in the first two screens.
Beyond the UI, `mockingbird_*` is baked into every localStorage key (`account-data.ts` and its
spec) — those must not be renamed casually, since renaming them orphans existing users' data.

**Change:** pick the canonical user-facing name — the evidence says **Mawkingbird**, since it holds
the tab title, the first-run copy and the shell — and make every visible surface agree. Then:

- `environment.mockingbird.ts` `brand` becomes the canonical name.
- `environment.ts` keeps a dev-distinct brand *only if* the dev build should be visibly
  distinguishable; if so make it obviously a dev marker rather than a third product name.
- **Leave the storage keys alone.** Add a comment at `account-data.ts` recording that
  `mockingbird_` is a legacy prefix retained for data compatibility, so the next person to notice
  the mismatch does not "fix" it and wipe everyone's follows.
- Sweep for the name in i18n dictionaries, docs, the manifest, and the canary brand mark
  (`login.ts:175`).

**Files:** `environments/*.ts`, i18n dictionaries, `ui/src/index.html`, `public/` manifest, docs.

## 4.5 — Move the anonymous composer off Home

**Now:** `pages/home/home.html:60` gives every visitor a "Write" and a "Quick post" button at the
top of the feed. For an anonymous visitor with no account, "Quick post" names an action with no
destination, and the pastebin target behind it (`compose.ts:979` —
`this.auth.isAnonymous && this.featureFlags.enabled('pastebin')`) is a surprising answer to a
button that looked like it meant "post to my followers." The boss's reading: it should be framed
as **"Note to self."**

**Change:** for anonymous visitors, Home shows no "Write / Quick post" pair. Writing while
anonymous means notes and drafts, and that belongs on the Write screen, where the framing can be
honest and the pastebin target is one deliberate choice among several rather than a hidden
default.

- The Eliza practice box (`home.html`, `auth.isAnonymous && eliza.following()`) is a separate
  thing and stays; it is already framed as practice.
- Signed-in users are unaffected.
- If anything replaces the CTA on an anonymous Home, it is the sign-in invitation from sprint 1.1,
  not a second composer.

The textboard/comment feature this eventually connects to is **out of scope** — this sprint only
stops the current surface from over-promising.

**Files:** `pages/home/home.{html,ts}`, `pages/write/write-page.*` (framing), spec.

---

## Definition of done

- One page lists starter kits and bundled collections together; both old routes still resolve.
- Opening a collection shows sample posts without a button press.
- Tapping like or boost visibly does something within one frame.
- The app has one user-facing name; storage keys are untouched and the reason is written down.
- An anonymous Home has no "Quick post" button.
- `cd ui && make test` green.
