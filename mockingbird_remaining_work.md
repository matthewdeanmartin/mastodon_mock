# Mockingbird completion audit and remaining work

**Audit date:** 2026-08-29  
**Source:** `MockingBird.md` lines 1–1298  
**Verdict:** **No—the issues are not all done.** Before reconciling repeated notes, 110 of 220 grouped findings are Done, 88 are Partial, 7 are Not done, and 15 require manual/external validation or are policy/design/obsolete notes. The 220 groups are source-note audit units, not 220 unique features.

## Scope and method

Mockingbird is the general-purpose Mastodon client in `mastodon_mock/ui`, built with Angular's `mockingbird` configuration. It can connect to any compliant Mastodon backend. The same UI source tree also serves the separate `mastodon_mock` mock-server experience, but the Python `mastodon_mock` server is a distinct product/test fixture and is **not** evidence that a Mockingbird client feature is complete.

MIMB (`mastodon_is_my_blog` and `mimb_co`) is a separate product and is excluded. `mawkingbird` is a generated mirror/deployment name. Its Auth, Profile, CORS, and Plus services count only where the Mockingbird Angular client has an explicit integration.

The audit traced routes, reachable templates, services, build replacements, feature gates, and colocated tests. Status meanings:

- **Done:** a reachable Mockingbird client workflow and implementation evidence exist.
- **Partial:** a meaningful slice exists, but requested scope, UX, reliability, or proof remains incomplete.
- **Not done:** no reachable implementation matching the note was found.
- **Manual/external/policy:** source inspection cannot decide it, or the note is not an implementation requirement.

The production replacement deserves a narrow statement. `angular.json:86–100` replaces `environment.ts`, `mock-routes.ts`, and `mock-api.ts`; the Mockingbird environment disables `mockTooling` and `allowThisServer`, removes the mock-only child control-plane routes, and stubs the `MockApi` control plane. It does **not** remove every direct mock-only settings route or every `_mock` method from the shipped graph. Direct URLs under `app.routes.ts:520–596` still lazy-load deletion/account/notifications/invites/development settings, and `api.ts:1077–1110` still contains calls to `/api/v1/_mock/...`; some navigation is merely hidden by `settings-shell.ts:156–165`. Those paths cannot be used as Mockingbird product-completion evidence.

## Corrected totals

| Audit section | Source lines | Done | Partial | Not done | Manual / policy / obsolete | Total |
|---|---:|---:|---:|---:|---:|---:|
| A | 1–443 | 30 | 33 | 2 | 3 | 68 |
| B | 444–850 | 50 | 24 | 3 | 1 | 78 |
| C | 851–1298 | 30 | 31 | 2 | 11 | 74 |
| **Pre-dedup total** | **1–1298** | **110** | **88** | **7** | **15** | **220** |

Part A includes the required QA corrections: `tags.pub` is Done (A03), while the two Storage Diagnostics navigation findings are Partial (A29–A30). Thus A is 30/33/2/3, not the uncorrected 31/31/3/3.

## What is verified complete

The Done count is substantial and should not be lost behind the backlog:

- **Feeds and discovery:** server-feed shortcuts, capability probing, followed tags and `tags.pub`, client lists, tag bundles, saved searches, and the Feeds hub are reachable (A02–A05, A14–A19, B01–B03, B29–B32, B63, C33, C48, C50).
- **Core writing and drafts:** compact compose/reply parity, opt-in preview, target validation, split modes, publish wizard, local/scheduled/self/paste drafts, and writing zen are implemented (A35, A38, B05, B09–B12, C15, C17, C29–C30).
- **RSS baseline:** the dedicated reader, typography/themes, read/star behavior, OPML/folders, feed health, synthetic profiles, and article reading are real client workflows (A07, A10, A12, A27, B51, B69).
- **Accounts and local data:** non-destructive logout, dead-session reauthentication, multi-account preservation, account-scoped inspection/deletion, image preferences, and import/export foundations are present (A23, A26, A68, B24, C24–C28, C52, C54–C55).
- **Profiles, posts, and conversations:** profile search/lightbox, relationship hover cards, follow requests, quote cards, link rewriting, post mutation state, notification-to-chat routing, and public-mention chat paths are implemented (A05, A17–A18, A38, A47, A60, B08, B19–B20, B54–B56, B74, C30, C40, C43, C45, C56).
- **Diagnostics and resilience:** feed capability fallback, Feed Doctor, fail-whale/page diagnostics, observability, and user-visible compose errors are reachable (B02, B19, B22, B26, B63, C29, C64).
- **Bluesky and provider foundations:** Bluesky search/feed/profile/notifications/chat, link shorteners, bookmarks/Raindrop, CORS consent restrictions, and explicit connectors exist (B58, B64, B66–B71, C07–C08, C11).

Appendix A preserves every Done group, including completed bug-specific and obsolete-completed notes.

## Reconciled remaining backlog

The source repeats several epics. The sections below are canonical work themes, not a second count. Each theme cites all related audit IDs so repeated notes remain traceable. A finding can legitimately appear in more than one theme when it spans concerns.

### P0 — boundary and small concrete regressions

1. **Remove mock-server leakage from the standalone client graph** (boundary finding outside the 220 source groups). Remove or product-gate the direct mock settings routes and `_mock` API calls described above. Acceptance: `build:mockingbird` contains neither those lazy routes nor `/api/v1/_mock/` strings; direct navigation returns the ordinary not-found flow; mock-server builds retain required tooling.
2. **Remove the remaining thoughtful-posting self-talk** (A37, `MockingBird.md:185`). Acceptance: `pages/home/home.html` no longer renders “Posts go through Drafts first,” and a focused template/component test proves the intended replacement or absence.
3. **Make Storage Diagnostics honestly reachable** (A29–A30, `MockingBird.md:116–120`). Today it is More → Observability → Storage Diagnostics. Acceptance: either add a deliberate direct navigation entry and test it, or amend the product requirement so the two-step path is explicitly accepted; do not claim a right-rail link that does not exist.
4. **Add a regression for the pinned/stale last Home item** (A13, A62–A63; `MockingBird.md:50,406–408`). Acceptance: a deterministic `HomeTimelineFeed`/aggregator fixture covers paging, caps, filtering, refresh, and stable ordering without pinning a stale tail item.

### P1 — feeds, search, profiles, and reading reliability

- **Search quality and server capability:** close the production scenarios for multi-page status search, search-server fallback, two-server rules/ToS, and degraded results (A16, C02, C23, C42, C47). Evidence should land in `pages/search/search*.spec.ts`, `search-capability`, `search-server-probe`, and a live-server matrix.
- **Feed correctness and anti-flood:** define the desired cap/cooldown policy and certify end-of-feed behavior rather than relying on implementation-adjacent diagnostics (A13, A46, A62–A63, C65). Add fixtures to `home`, `feed-aggregator`, and `feed-doctor` for >20 sources, duplicates, filtered windows, cancellation, and incremental paging.
- **Profile/card mobile behavior:** certify whitespace-to-thread navigation, follower/following pagination termination, arbitrary long profile fields, large counts, and narrow popup geometry (A39, A57–A59, A61). Use responsive browser tests and representative Link-header/privacy fixtures.
- **RSS/read-later epic:** finish feed discovery/search, friend-shared synthetic feeds, comments if still desired, 90-day read-state cleanup, multi-link article selection, hostile-page policy, and annotation/read-later scope (A31, A34, A42, A45, B61, C58). Core RSS is already Done; this item concerns only the missing expansion.
- **Performance contract:** decide and test HTTP cache/ETag, navigation cancellation, deduplication, and no-unnecessary-refetch invariants (C65). Evidence paths: `dedupe.interceptor`, `metrics.interceptor`, `streaming`, `providers/feed-aggregator`, and browser network tests.

### P1 — writing, publishing, and data durability

- **Unify Write and compact Compose affordances** (A24, A36, C14). Acceptance: target/visibility/media/alt/poll/language/translation/preview/scheduling/thread behavior is either shared or intentionally documented, and visibility survives every draft/target conversion.
- **Resumable export and sync** (A22, A28, A49, C52). Preserve partial friend-export progress and produce a downloadable partial result after failure; test resume/idempotence. Define which config/profile/domain objects sync, what never leaves the browser, and how ETag/conflict/offline failures recover.
- **Anonymous/blog/paste publishing** (B25, B27, B35, B46, B52, C31, C36–C38). Decide the supported provider set and identity rules; add end-to-end target-availability, draft, publish, share, error, and history tests. Do not equate paste history with a full Pastebin identity/product model.
- **PKM lifecycle** (B13, B27, B48, B57). NOTE/TODO/CAL parsing exists; bookmarks/calendar/contacts/reminders, completion/garbage collection, quote-to-self, and full-text local-blog RSS do not. Specify a smaller shippable lifecycle before implementation.

### P2 — onboarding, discovery, and social breadth

- **Coherent first-run flow:** consolidate preview lifetime, starter kits, special-interest packs, contact import, saved-search/tag samples, login prompts, and empty-state actions (A20, A33, A44, A46, B45, B77, C13, C35, C41, C49, C60). Acceptance should be one testable anonymous/new-account journey, not a list of unrelated surfaces.
- **Cross-network friend discovery:** extend or explicitly limit GitHub/Twitter/contact/bridge correlation, Google Contacts/YouTube matching, OPML semantics, and bounded follow scheduling (C06, C12, C59–C60). Require confidence explanations and per-row failures; do not silently follow uncertain matches.
- **Bluesky parity:** core client support is Done, but provider-specific write/moderation semantics, Bsky-first defaults, anonymous completeness, Mastodon correlation, and cross-provider trends remain Partial (A54, A64, B44, C37–C38).
- **Connections and Plus:** settle the supported client contract for profile/config sync, secrets, paid/free gating, translation, Twitter/Nitter, CORS proxy choice, and provider health (A28, A49–A50, A52, A64–A67, B36, B43, B49–B50, B60–B62). External service success must be tested separately from UI reachability.

### P2 — language, accessibility, chat, and moderation

- **Internationalization/translation:** Esperanto detection/selection and per-post translation are Done; full label localization, German/Japanese UI, language-specific onboarding, bulk translation rules, caps, and provider policy are not (A09, A61, A66, B28, B40, B53, B72, B78, C53, C63, C70).
- **Accessibility:** finish the formal lint/review and responsive/device matrix, certify alt text on every card/lightbox/notification variant, and decide whether an alt-text assistant is in scope (B53, B78, C57, C63, C67).
- **Conversation controls:** add durable hide/trash/mute-conversation semantics, clarify public-reply/unread retention policy, and decide whether Mastodon chat emoji reactions are required (B59, C44, C51, C71).
- **Trust and restricted-operation modes:** content trust settings are Done; a global authenticated read-only/opsec mode and Spectrum moderation states are not (A53, B42, C46). These require explicit product semantics before code.

## Seven explicitly Not done findings

These are separate source requirements, even where product triage may reject them:

| Audit ID | Source | Missing requirement | Minimum acceptance criterion |
|---|---:|---|---|
| A37 | 185 | Remove thoughtful-posting self-talk | Copy absent/replaced in reachable Home; focused test. |
| A53 | 376 | Global opsec/read-only mode | One reachable control disables all writes/chat while preserving authenticated reads; route/action guards tested. |
| B42 | 622–627 | Spectrum moderation states | Client model and reachable UX for the specified no-index/noise/reach/hashtag states, backed by a documented server contract. |
| B47 | 644 | Paid/gifted CORS plan | Reachable entitlement, gifting, expiry, failure, and billing-state UX with sandbox contract tests. |
| B68 | 775–778 | Pastebin account/object graph | Reachable account view relating pastes, short links, and linked pastes with persistence tests. |
| C04 | 874–877 | Grammar checker with non-rewriting highlights | Reachable checker highlights issues and exposes explanations without silently rewriting; accessibility and error tests. |
| C10 | 905 | Encrypted public-post workflow | Threat model, key exchange/storage, encrypt/decrypt UI, failure/revocation semantics, and interoperability tests. |

The last six are not automatically release blockers. Product owners should accept, defer, or reject each one rather than letting “Not done” imply accidental commitment.

## Manual and external verification queue

The 15 non-implementation findings must not be counted as Done:

- **Manual/device:** A43 (anonymous/connected/free/paid/lapsed scenarios) and B07 (mobile chat chrome). Run signed-out, connected, free, active paid, lapsed, narrow-phone, keyboard, and screen-reader matrices against a deployed Mockingbird build.
- **External/browser:** C26 (cookie visibility) and C39 (survey/provider response). Verify against deployed headers, browser storage/cookie policy, and real provider responses.
- **Policy/recommendation:** A01 and A32. Convert these to explicit acceptance tests only if endorsements or “no autoplay/infinite scroll/nudges” are binding product policy.
- **Obsolete/background/design:** C16, C18, C66, C74. Archive or rewrite these notes; absence of code is not a defect.
- **Product/taxonomy/strategy:** C09, C20–C21, C72–C73. Keep these in product strategy, not the engineering completion denominator.

Partials that depend on live providers also need a separate contract matrix: Mastodon servers with differing search/tag/list capabilities, Bluesky, Auth/Profile/Plus, RSS targets, paste providers, shorteners, CORS proxies, OpenRouter, Mataroa, Raindrop, GitHub, Twitter/Nitter, and bridge discovery. A client route rendering is not proof that those integrations work in production.

## Duplicate reconciliation

No “unique issue” number is asserted because the repeated notes have different breadth. Instead, related groups are merged operationally while their original audit IDs remain in Appendix A:

| Canonical cluster | Source groups reconciled |
|---|---|
| RSS, articles, and read-later | A07, A10, A12, A27, A31, A34, A42, A45; B51, B61, B69–B70; C08, C58 |
| Feeds, lists, tags, and diagnostics navigation | A02–A03, A13, A29–A30, A46, A62–A63; B01–B03, B21–B22, B26, B29–B30, B63, B73, B75; C33, C48, C64–C65 |
| Search and discovery/onboarding | A05, A14–A20, A44; B17–B18, B45, B65, B77; C05–C06, C11–C13, C35, C41–C42, C47, C49–C50, C59–C60, C69 |
| Compose, Write, drafts, and publishing | A24, A35–A38; B05, B09–B13, B27, B33, B35, B40, B52, B57; C14–C17, C29–C31, C36–C38 |
| Auth, accounts, storage, and sync | A22–A23, A28, A49, A68; B24; C24, C27–C28, C52, C54 |
| Bluesky and cross-network providers | A54, A64–A67; B34, B44, B49, B58; C03, C06–C07, C22, C37–C38, C59 |
| Language and accessibility | A09, A61, A66; B28, B31–B33, B37, B39–B40, B53, B72, B78; C53, C57, C63, C67, C70 |
| Profiles, cards, notifications, and chat | A08, A17–A18, A39, A57–A60; B08, B19–B20, B54–B56, B59, B74; C30, C40, C43–C45, C51, C56, C71 |

## Verification performed and limitations

The corrected audit inputs record these successful checks on 2026-08-29:

- `npm run build:mockingbird` passed and emitted `dist-mockingbird`; only existing bundle/style-budget and CommonJS warnings were reported.
- Part A focused run: 24 test files / 586 tests passed for RSS, search, profile search, compose, import/export, and auth.
- Part A QA run: `src/app/tags-pub.spec.ts`, 1 file / 5 tests passed.
- Part B focused run: 37 test files / 911 tests passed across collections, lists, tags, search, Write, profiles, notifications, Feed Doctor, bookmarks, conversations, links, and status cards.
- Part C focused run: 37 test files / 587 tests passed across server-only mode, search, drafts, muted posts, analytics, observability, accounts, import/export, collections, and starter collections.

These are separate focused runs and may overlap; their test counts must not be summed as a unique-test total. The complete UI gate (`cd mastodon_mock/ui && make test`) was not recorded, nor were deployed-provider, browser/device, billing, security, or end-to-end matrices. The report itself does not rerun interrupted jobs and makes no claim beyond the recorded successful checks.

## Recommended close-out order

1. Fix standalone-build mock leakage and the small concrete A37/A29–A30 issues.
2. Add deterministic Home/feed/search/profile regression fixtures and run the complete UI gate.
3. Turn the broad RSS, Write, sync, onboarding, i18n, and accessibility epics into bounded acceptance stories.
4. Triage all seven Not done requirements as accept/defer/reject.
5. Execute the manual/device/provider matrix, then update statuses only from recorded evidence.

## Appendix A — complete 220-group traceability inventory

The inventory below applies the Part A QA corrections. `D` = Done, `P` = Partial, `N` = Not done, and `U` = manual/external/policy/obsolete. Theme codes are `POL` policy/strategy, `FEED`, `SEARCH`, `SOC` profiles/social/chat, `WRITE`, `RSS`, `NAV`, `DATA`, `AUTH`, `EXT` external/providers/Plus, `BSKY`, `I18N`, `A11Y`, `PKM`, `MOD`, `OBS`, `PERF`, `ONBOARD`, `ANON`, `SETTINGS`, `DESIGN`, `SECURITY`, `MANUAL`, `BACKGROUND`, and `OBSOLETE`. Detailed evidence remains in `.mockingbird_audit/corrected_part_a.md`, `corrected_part_b.md`, `corrected_part_c.md`, with the A corrections in `qa_part_a.md`.

### Part A — source lines 1–443 (68 groups)

| ID | `MockingBird.md` lines | S | Theme |
|---|---:|:---:|---|
| A01 | 1–4 | U | POL |
| A02 | 8 | D | FEED |
| A03 | 12 | D | FEED/EXT |
| A04 | 16–22 | D | SOC |
| A05 | 26 | D | SEARCH/SOC |
| A06 | 30–32 | D | WRITE |
| A07 | 38 | D | RSS |
| A08 | 39 | D | SOC |
| A09 | 40 | P | I18N/DESIGN |
| A10 | 44 | D | RSS |
| A11 | 45–48 | D | NAV/FEED |
| A12 | 49 | D | RSS/DESIGN |
| A13 | 50; 406 | P | FEED/PERF |
| A14 | 52–54 | D | SEARCH |
| A15 | 55 | D | SEARCH |
| A16 | 56 | P | SEARCH/EXT |
| A17 | 57 | D | SEARCH/SOC |
| A18 | 58 | D | SOC/A11Y |
| A19 | 59 | D | ONBOARD |
| A20 | 61–78 | P | ONBOARD/SEARCH |
| A21 | 81 | D | EXT |
| A22 | 83 | P | DATA |
| A23 | 84 | D | DATA/ONBOARD |
| A24 | 86 | P | WRITE |
| A25 | 88 | D | AUTH/EXT |
| A26 | 90 | D | DATA/ANON |
| A27 | 94–100 | D | RSS |
| A28 | 104–110 | P | DATA/EXT |
| A29 | 116–120 | P | NAV/OBS |
| A30 | 118–120 | P | NAV/OBS |
| A31 | 124–145; 261–280; 289–309 | P | RSS |
| A32 | 149–153 | U | POL |
| A33 | 155–173 | P | ONBOARD/EXT |
| A34 | 175–179 | P | RSS/WRITE |
| A35 | 181 | D | WRITE |
| A36 | 183 | P | WRITE |
| A37 | 185 | N | WRITE |
| A38 | 187 | D | WRITE/SOC |
| A39 | 189 | P | SOC/A11Y |
| A40 | 191–216 | D | NAV/SETTINGS |
| A41 | 220 | D | SOC |
| A42 | 222–224 | P | RSS/EXT |
| A43 | 226–232 | U | EXT/MANUAL |
| A44 | 236–259 | P | NAV/ONBOARD |
| A45 | 261–280 | P | RSS/BSKY/EXT |
| A46 | 282–287 | P | FEED/NAV |
| A47 | 311–315 | D | SOC |
| A48 | 317–327 | P | SOC/DESIGN |
| A49 | 329–334 | P | DATA/EXT |
| A50 | 336–351 | P | EXT/PKM |
| A51 | 353–359; 375 | D | MOD/SETTINGS |
| A52 | 361–373 | P | EXT |
| A53 | 376 | N | AUTH/MOD |
| A54 | 378–385 | P | BSKY/FEED |
| A55 | 389 | D | EXT |
| A56 | 390 | D | EXT |
| A57 | 391 | P | SOC |
| A58 | 392 | P | SOC/EXT |
| A59 | 393–398 | P | SOC/A11Y |
| A60 | 399 | D | SOC/NAV |
| A61 | 401–405 | P | DESIGN/A11Y |
| A62 | 406–407 | P | FEED/PERF |
| A63 | 408 | P | FEED/PERF |
| A64 | 410–420 | P | BSKY/AUTH |
| A65 | 422–430 | P | EXT/DATA |
| A66 | 432–435 | P | I18N/EXT |
| A67 | 437–441 | P | EXT/SOC |
| A68 | 443 | D | AUTH/DATA |

### Part B — source lines 444–850 (78 groups)

| ID | `MockingBird.md` lines | S | Theme |
|---|---:|:---:|---|
| B01 | 447 | D | FEED/SOC |
| B02 | 448–450 | D | FEED/EXT |
| B03 | 451–453 | D | FEED/SEARCH |
| B04 | 454, 518, 821–824 | D | MOD/SOC |
| B05 | 455 | D | WRITE/BSKY |
| B06 | 456–457 | D | DESIGN |
| B07 | 458 | U | MANUAL/A11Y |
| B08 | 459, 463 | D | SOC/PERF |
| B09 | 467–470 | D | WRITE/DATA |
| B10 | 473–475 | D | WRITE/DESIGN |
| B11 | 479–485 | D | WRITE |
| B12 | 489–491 | D | WRITE/PKM |
| B13 | 492–501, 505–506 | P | PKM |
| B14 | 510, 670 | D | FEED/SETTINGS |
| B15 | 512 | D | SOC/DESIGN |
| B16 | 514 | D | FEED/DESIGN |
| B17 | 515 | D | SEARCH |
| B18 | 516 | D | SEARCH/SOC |
| B19 | 520–521 | D | SOC/OBS |
| B20 | 523 | D | SOC |
| B21 | 525 | D | FEED |
| B22 | 528–530, 573 | D | OBS/FEED |
| B23 | 534 | D | SOC/DATA |
| B24 | 535 | D | AUTH/DATA |
| B25 | 536 | P | ANON/FEED |
| B26 | 540–542 | D | OBS/FEED |
| B27 | 546–551 | P | WRITE/PKM/RSS |
| B28 | 555–558 | P | I18N/EXT |
| B29 | 562–564 | D | FEED |
| B30 | 568–571 | D | FEED/SOC |
| B31 | 575–578 | D | I18N |
| B32 | 581–583 | D | I18N/FEED |
| B33 | 585 | D | I18N/WRITE |
| B34 | 587 | D | ANON/BSKY |
| B35 | 589, 618 | P | ANON/WRITE |
| B36 | 593–595, 609 | P | EXT/SETTINGS |
| B37 | 598 | D | I18N |
| B38 | 600 | D | FEED |
| B39 | 602 | D | SEARCH/I18N |
| B40 | 603–604 | P | I18N/EXT |
| B41 | 613–614 | D | ANON/FEED |
| B42 | 622–627 | N | MOD |
| B43 | 631–633 | P | DATA/EXT |
| B44 | 637 | P | BSKY |
| B45 | 638–640 | P | ONBOARD/FEED |
| B46 | 641–643 | P | ANON/EXT |
| B47 | 644 | N | EXT |
| B48 | 645 | P | PKM |
| B49 | 646 | P | EXT |
| B50 | 647–648 | P | EXT/NAV |
| B51 | 649 | D | RSS |
| B52 | 650–653 | P | ANON/EXT |
| B53 | 655–661 | P | A11Y/I18N |
| B54 | 664 | D | SOC/A11Y |
| B55 | 665 | D | SOC |
| B56 | 667–668 | D | SOC/EXT |
| B57 | 674–682 | P | PKM |
| B58 | 684–690 | D | BSKY/SOC |
| B59 | 692–704 | P | SOC/MOD |
| B60 | 706–712 | P | OBS/EXT |
| B61 | 714–717 | P | RSS/EXT |
| B62 | 719–726 | P | EXT |
| B63 | 728–733 | D | FEED/SEARCH |
| B64 | 735–737 | D | EXT |
| B65 | 739–746 | D | ONBOARD/NAV |
| B66 | 748–767 | D | EXT |
| B67 | 771–773 | D | RSS/DATA |
| B68 | 775–778 | N | EXT/DATA |
| B69 | 780–786 | D | RSS/EXT |
| B70 | 788–790 | D | RSS |
| B71 | 792–796 | D | EXT/SECURITY |
| B72 | 799–803 | P | I18N |
| B73 | 805–808 | D | FEED/DATA |
| B74 | 810–814 | D | SOC |
| B75 | 816–819 | D | FEED/SOC |
| B76 | 825–826 | D | MOD |
| B77 | 830–836 | P | ONBOARD/FEED |
| B78 | 838–850 | P | EXT/A11Y/I18N |

### Part C — source lines 851–1298 (74 groups)

| ID | `MockingBird.md` lines | S | Theme |
|---|---:|:---:|---|
| C01 | 852–860 | P | FEED/MOD |
| C02 | 862–863 | P | SEARCH/EXT |
| C03 | 865–873 | D | SEARCH/SOC/I18N |
| C04 | 874–877 | N | WRITE/A11Y |
| C05 | 881–883 | D | ONBOARD/SOC |
| C06 | 887–890 | P | ONBOARD/EXT |
| C07 | 892–895 | D | EXT/AUTH |
| C08 | 897–899 | D | RSS/ANON |
| C09 | 901–903 | U | POL |
| C10 | 905 | N | SECURITY/WRITE |
| C11 | 907–911 | D | SEARCH/EXT |
| C12 | 913–915 | P | ONBOARD/EXT |
| C13 | 917–923 | P | ONBOARD/DATA |
| C14 | 924 | P | WRITE |
| C15 | 928–936 | D | WRITE/DATA |
| C16 | 937–938 | U | OBSOLETE |
| C17 | 939 | D | WRITE |
| C18 | 941–948 | U | BACKGROUND |
| C19 | 950–953 | D | OBS |
| C20 | 955–960 | U | POL/EXT |
| C21 | 962–973 | U | POL/AUTH |
| C22 | 975–978 | P | DATA/EXT |
| C23 | 981–987 | P | SEARCH/EXT |
| C24 | 989 | D | AUTH/DATA |
| C25 | 991 | D | DESIGN/A11Y |
| C26 | 993 | U | MANUAL/SECURITY |
| C27 | 995 | D | AUTH/DATA |
| C28 | 997–999 | D | AUTH |
| C29 | 1001–1002 | D | WRITE/OBS |
| C30 | 1004 | D | SOC |
| C31 | 1006–1010 | P | WRITE/EXT |
| C32 | 1012; 1088 | D | NAV/ANON |
| C33 | 1016–1043 | D | NAV/FEED |
| C34 | 1045–1047 | D | ONBOARD/MOD |
| C35 | 1049–1052 | P | ONBOARD |
| C36 | 1056–1063 | P | ANON/WRITE |
| C37 | 1065–1074 | P | WRITE/EXT |
| C38 | 1076–1083 | P | WRITE/EXT |
| C39 | 1085–1086 | U | MANUAL/EXT |
| C40 | 1090 | D | SOC |
| C41 | 1092–1094 | P | ONBOARD/SEARCH |
| C42 | 1096–1098 | P | SEARCH/EXT |
| C43 | 1100–1104 | D | SOC/RSS |
| C44 | 1106–1108 | P | SOC/MOD |
| C45 | 1110–1111 | D | SOC/MOD |
| C46 | 1115–1117 | P | AUTH/MOD |
| C47 | 1119–1121 | P | SEARCH/EXT |
| C48 | 1125–1132 | D | FEED/NAV |
| C49 | 1133–1139 | P | ONBOARD/FEED |
| C50 | 1143–1149 | D | SEARCH |
| C51 | 1150–1154 | P | SOC/DATA |
| C52 | 1155–1162 | P | DATA |
| C53 | 1164–1168 | P | I18N/ONBOARD |
| C54 | 1169–1170 | D | DATA/OBS |
| C55 | 1171–1172 | D | DESIGN/A11Y |
| C56 | 1173–1174 | D | SOC/NAV |
| C57 | 1175–1177 | P | A11Y |
| C58 | 1178–1182 | P | RSS/EXT |
| C59 | 1183–1187 | P | ONBOARD/EXT |
| C60 | 1190–1196 | P | ONBOARD/FEED |
| C61 | 1198–1200 | D | ONBOARD/SOC |
| C62 | 1204–1210 | D | FEED/SOC |
| C63 | 1214–1219 | P | I18N/A11Y |
| C64 | 1221–1225 | D | OBS |
| C65 | 1227–1234 | P | PERF/OBS |
| C66 | 1236–1238 | U | BACKGROUND/PERF |
| C67 | 1242–1245 | P | A11Y/SOC |
| C68 | 1247–1250 | D | MOD/SOC |
| C69 | 1252–1255 | D | SEARCH |
| C70 | 1257–1261 | P | I18N/ONBOARD |
| C71 | 1263–1266 | P | SOC/AUTH |
| C72 | 1268–1275 | U | POL/MOD |
| C73 | 1277–1295 | U | POL |
| C74 | 1297–1298 | U | OBSOLETE |

## Source artifacts

- `MockingBird.md`
- `.mockingbird_audit/corrected_part_a.md`
- `.mockingbird_audit/corrected_part_b.md`
- `.mockingbird_audit/corrected_part_c.md`
- `.mockingbird_audit/qa_part_a.md`

The obsolete `.mockingbird_audit/part_a.md`, `part_b.md`, `part_c.md`, and the prior contents of this report were not used as evidence.
