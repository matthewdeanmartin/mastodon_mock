# Write — Epic overview: the writing workspace

Status: PLANNED (written 2026-08-08)

Builds directly on the completed `drafts-sprint01..03.md` epic. Read those first — this epic
assumes their vocabulary (four draft kinds, `DraftItem`, `toSnapshot`, handoff, thoughtful posting)
without re-explaining it.

## Product premise

**Upgrade the user's distractions.**

Mockingbird's reading surfaces are deliberately distracting in a *good* way: while you read a feed,
the right rail offers trending hashtags and new people to follow. That is the deal a social client
makes with you.

The writing surface currently makes the same offer, and it shouldn't. When you are writing, a
trending-hashtag rail is a tax. The distractions a writing surface owes you are *virtuous* ones:
your own notes, your own to-dos, a spellchecker, a readability score, the split preview of the
thread you are about to post. Same architecture, inverted content.

`/write` is that surface. It is the writing counterpart to the feed: full width, no rails, and
every writing-adjacent affordance visible at once — the draft list, the editor, the note list, the
to-do list.

And when even *those* are too much, **writing zen** turns off everything.

## The two zens (settled with the boss)

These are genuinely two different features and must not be merged:

| | Global zen (`ClientPrefs.zenMode`, exists today) | Writing zen (this epic) |
| --- | --- | --- |
| Scope | The whole app | `/write` only |
| Persistence | Persistent pref, survives reloads | Temporary, per-session, not persisted |
| Hides | The left and right rails | **Everything** — rails, universal header, footer, the workspace's own side panes |
| Leaves | Header, footer, the routed column | The text, an exit control, and Save draft |
| Purpose | Declutter reading | Remove every enticing feed to click on |

Both can be on at once and must not fight. Writing zen is a signal on the `/write` page that the
shell also reads; global zen keeps meaning exactly what it means today.

## The shape of `/write`

```
DEFAULT MODE (wide, no rails — like /search, /chat, /settings)
┌──────────────┬───────────────────────────────┬──────────────┐
│ DRAFTS       │ EDITOR                        │ NOTES        │
│ (list/board) │                               │ #NOTE        │
│              │  ┌─────────────────────────┐  │ #TODO        │
│ ▸ Ideas      │  │                         │  │              │
│ ▸ Writing    │  │   text                  │  │ ▸ note …     │
│ ▸ Editing    │  │                         │  │ ▸ todo …     │
│ ▸ Scheduled  │  └─────────────────────────┘  │              │
│              │  [Zen] [Save draft] [Publish▸]│              │
└──────────────┴───────────────────────────────┴──────────────┘

WRITING ZEN
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              text, and nothing else                         │
│                                                             │
│                        [Exit zen]  [Save draft]             │
└─────────────────────────────────────────────────────────────┘
```

## This epic's relationship to the PKM epic

**PKM is a separate, larger epic that has not been written yet.** Where it is going: a full workflow
manager, deeply integrated with the scheduler, a calendar, all posts, links, and bookmarks.

This epic implements **only the slice of PKM that touches writing** — the `#NOTE` / `#TODO` tag
model and a read view of it, so the writer's right pane can offer the user's own material instead of
somebody else's trending hashtags. Sprint 2 carries the full in-scope / out-of-scope table; the rule
for every session in this epic is that the PKM work here must be *extended* by the later epic, never
*migrated*. If a story starts growing toward workflow states, calendars, or bookmark integration,
stop and leave it for the epic.

`/pkm` is deliberately **not** claimed by this epic — it is the PKM epic's front door. Sprint 2's
feed is a tab inside `/write`, built as a component that can later be mounted at `/pkm` unchanged.

## Sprint sequence

Sprints do **not** run in parallel. Each is one Claude session; each ends green
(`npm run lint`, `npm run format:check`, `npm run test:ci`, `npm run build`).

| # | Sprint | File | Delivers |
| --- | --- | --- | --- |
| 1 ✅ | Workspace shell + zen | `write-1-workspace-and-zen.md` | **COMPLETE.** `/write` route, wide 3-pane layout, split-by-`---`, writing zen, the workspace sidecar, `Drafts.update()` |
| 2 ✅ | Notes and to-dos (writing slice of PKM) | `write-2-pkm-notes-and-todos.md` | **COMPLETE.** `#NOTE`/`#TODO`/`#CAL` model, configurable tag words, the notes pane and tab, jot box, Save-as-to-do, publish warning |
| 3 ✅ | Publish wizard | `write-3-publish-wizard.md` | **COMPLETE.** 4-step wizard: targets → preview/splits → quality checks → now/schedule; per-step config |
| 4 ✅ | Kanban board | `write-4-kanban.md` | **COMPLETE.** Ideas / Writing / Editing / Scheduled over the existing sidecar; a pop-open panel, built to survive being moved to its own screen |
| 5 | Sources | `write-5-sources.md` | **WRITTEN, ready to start.** GitHub Gist as a draft source; deeper Mataroa (list/edit existing posts) |

Sprints 3–5 are named here so nobody re-invents the sequence, but are **not yet written**. Write
each one at the start of its own session, grounded in what sprints 1–2 actually shipped.

## Standing constraints (unchanged from every prior epic)

- **Mockingbird target, `ui/` only.** No Python, no mock-server changes. Everything must work
  unchanged against real `mastodon.social`.
- **Must work anonymously.** An anonymous visitor has local drafts, local notes, and local to-dos,
  and every one of those paths must work with zero authenticated requests.
- **Client prefs live in `ClientPrefs`**, persisted to localStorage; per-account values go through
  `scopedKey()` (`account-scope.ts`).
- **No `ad-*` class names.** Ad blockers hide them; the boss runs uBlock.
- **Never say "X"** — it is Twitter. The nostalgia is the point.
- Feature-gated surfaces use `FeatureFlags`; user choices use `ClientPrefs`. `/write` is a
  `FeatureFlags` entry (`write`) so it can be dark-shipped; the prefs inside it are `ClientPrefs`.

## Decisions already made (do not relitigate)

- **`/write` is a new route.** `/drafts` keeps working exactly as it does today and links into
  `/write`. Rebuilding `/drafts` in place would have put a well-tested page at risk for no gain.
- **PKM items are both local and server-backed.** A note or to-do is either a local draft carrying
  the tag, or a real self-post (`direct`, no mentions) carrying it. Same both-kinds merge the drafts
  list already does — see `DraftSources`.
- **Kanban status is a localStorage sidecar map** (`draftKey → column`), not a field on the draft.
  Three of the four draft kinds live on a server that has nowhere to put it.
- **Spelling is browser-native.** The textarea's own `spellcheck` gives squiggles; the wizard's
  quality step ships repo-local heuristics only (readability, hashtag sanity, repeated words,
  ALLCAPS, unresolved links). **No bundled dictionary** — the bundle cost isn't worth it, and the
  browser already does the hard part.
- **Split default is `---`.** Explicit, predictable, matches the Markdown mental model and blog
  front-matter. Autosplit and split-on-demand are opt-in per draft.
- **Gist is sprint 5, not 1–2.** Sprints 1–2 are UI and model work over what already exists.
- **Two editors, on purpose. This is not duplication to be cleaned up later.** Confirmed by the
  boss after sprint 1. They answer to genuinely different constraints:

  | | `<app-compose>` (the quick editor) | The workspace editor |
  | --- | --- | --- |
  | Lives in | cramped space — a card, a rail, a reply box | a full-width pane |
  | Workflow | write → publish, in one go | write → split → check → publish, over days |
  | Owns | targets, polls, media, visibility, the gate | splitting, quality gates, notes |

  A future picture-focused composer (Instagram-shaped posts) would be a *third*, for the same
  reason. Do not "unify" these. Publishing stays single-pathed regardless: the workspace hands text
  to the composer via `Drafts.handoff()`, exactly as `/drafts`' "Edit for post" does, so there is
  one place that posts even though there are several places that write.
- **This epic does not build PKM**, only the writing slice of it. See the section above. `#CAL` is
  recognized as a tag but does nothing — no date parsing, no calendar, no scheduling.
