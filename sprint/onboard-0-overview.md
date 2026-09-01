# Onboarding — Epic overview: the stranger's first ten minutes

Status: PLANNED (drafted 2026-09-01). Four sprints, bugs first.

Source: hands-on testing of the shipped UI on a phone, including a first-time user who had never
seen the app. The findings below are that session's, restated against the code that causes them.
Nothing here is speculative UX theory — every item names the file that produces the behaviour.

## Product premise

**The app is honest with people who already understand it, and misleading to people who don't.**

Three distinct failures produce almost every item on the list:

1. **Capability lies.** `providers/provider.ts:36` declares
   `'anonymous-mastodon': { reply: true, favourite: true, reblog: true }`. An anonymous visitor
   therefore gets a fully live ♡ and 🔁 that call the network and fail. The button *promised*, and
   the promise was not the app's to make. Meanwhile bookmarking, share-to-Reddit, local drafts and
   the Eliza practice box genuinely *do* work anonymously — so this is not "anonymous is read-only",
   it is "three specific actions lie about themselves while the rest tell the truth."

2. **Affordance under-reach.** Things that look clickable are not, and things that are clickable
   are smaller than they look. The search result bio (`account-result-card.html`) is a plain
   `<div>` while the face and the name above it are links; the boost attribution
   (`status-card.html:12`) is plain text; a post's whitespace navigates but its own text is
   separately wrapped in a routerLink, which is why selecting text is hard. A new user reads
   "profile unavailable" where the truth is "the hit target is 40px wide."

3. **Choice presented before context.** The login page renders three `<section class="path">`
   blocks at once — sign in, sign up, stay anonymous — plus a server picker, on one 860px-wide
   column. And after a visitor picks "anonymous" in the first-run modal, they land on a Home with
   a big blue "you aren't following anyone" CTA, which the tester read as decoration rather than
   as the next step. Twitter and Mastodon both *force* a follow step before the first feed; we
   show an empty feed and hope.

**The fix is not one redesign.** It is a handful of small honest corrections (sprint 1), one real
flow change (sprint 2), and two rounds of polish (sprints 3-4).

### The one-line version of each finding

| Finding | Sprint | Root cause in code |
|---|---|---|
| Anonymous "write & quick post" is meaningless | 4.5 | `home.html:60`, `compose.ts:979` |
| Anonymous like / boost / reply flash and fail | 1.1, 1.2 | `provider.ts:36` |
| Search defaults to Accounts | 3.1 | `search.ts:652` |
| No way to search starter packs | 3.4 | `SearchType` has no kit member |
| Phone search looks like nothing happened | 3.2 | `search.css:45` collapses form above results |
| Facets cannot collapse | 3.3 | only the facet block is a `<details>` |
| Result bio not clickable | 1.4 | bio is a plain `div` |
| Post text hard to select | 1.5 | text wrapped in its own routerLink |
| Booster name not a link | 1.6 | `status-card.html:12` is plain text |
| New users see an empty Home | 2.1 | modal answer routes to `/home` |
| Kits vs collections split too early | 4.1 | `/find-friends` is a two-row fork |
| Starter kits hard to find again | 3.4, 4.1 | reachable only via that fork |
| Collections need a button press for posts | 4.2 | `loadSample()` is manual |
| Collection preview post → thread dead | 1.3 | `providerRef` incomplete → `threadLink` null |
| Login page too busy on a phone | 2.2 | three `section.path` blocks at once |
| "Ctrl + D" on a phone | 2.3 | `welcome-back.ts` `bookmarkHint` |
| Mockingbird vs Mawkingbird | 4.4 | three values across two env files |
| Slow actions give no feedback | 4.3 | `actionBusy` only sets `[disabled]` |

## What anonymous mode actually is

Settled during planning; the roadmap depends on it.

Anonymous is **read + every local-only action we can honestly offer**. It is deliberately *not*
minimal: share-to-Reddit works, local-storage bookmarking works, drafts work, and that breadth is
a feature. The line is drawn at **actions that require an identity on someone else's server** —
reply, favourite, boost. Those three get a "sign in to do this" call to action, not a failed
network request.

Two consequences shape later sprints:

- **The composer leaves the anonymous Home.** Writing while anonymous means notes-to-self and
  drafts, so it belongs on the Write screen, not at the top of a feed under a "Write / Quick post"
  pair that reads as "publish to the world." "Quick post" in particular is meaningless to a
  visitor with nowhere to post to.
- **Comments are deferred, not gated forever.** A future feature lets people comment via a
  Bluesky/Mastodon login *or* an anonymous textboard. That work is out of scope here; this epic
  only makes the current state honest ("sign in to reply") rather than broken.

## The four sprints

| # | Sprint | Theme |
|---|---|---|
| 1 | [[onboard-1-honest-actions]] | The confirmed bugs + capability honesty. All small, all localized. |
| 2 | [[onboard-2-first-run-path]] | Follow-first onboarding, and the mobile login wizard (TOP PRIO). |
| 3 | [[onboard-3-search-legibility]] | Search defaults, result feedback, facet collapse, mobile. |
| 4 | [[onboard-4-discovery-and-brand]] | Kits/collections merged surface, brand, loading feedback. |

Sprints 2.1, 3.4 and 4.1 all land on the same "find people" surface and should be sequenced with
that in mind: whatever 2.1 builds to satisfy the forced follow step is what 4.1 merges into.

Bugs lead because they are cheap, confirmed, and several of them (the dead thread links, the
un-clickable bio) are *read by users as "the feature is missing"* — they cost more trust than
their size suggests.

## Out of scope

- The comment/textboard feature itself.
- Any change to the Bluesky search panel beyond what the shared type-select touches.
- Retiring `/bundled-starter-kits` or `/bundled-collections` as routes. Sprint 4 merges the
  *surface*, not the routes — deep links keep working.
- Rebuilding `first-run-modal`. It works; sprint 2 changes only where its answer leads.
