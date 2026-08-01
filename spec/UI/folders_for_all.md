# Folders for all

**Status:** proposal, not yet implemented.
**Written:** 2026-08-01, out of the OPML import/export work.

## Why this exists

Two features arrived at the same missing concept from opposite directions:

- **RSS.** OPML — the format every feed reader exports — is a *tree*. Real
  files nest feeds under "Tech", "News", "Friends' blogs". Our importer
  (`ui/src/app/providers/rss/opml.ts`) parses that tree, records the folder path
  on each feed, and then throws it away, because there is nowhere to put it.
- **Bookmarks.** A saved-post library past a couple of hundred items is not
  browsable as one list. `bookmark-groups.ts` already answers this with
  *computed* shelves — by author, by hashtag — which is genuinely good and is
  not the same thing as folders.

Categories are a core RSS experience: the folder is how people think about their
reading, and a reader that flattens the tree on import has lost the user's own
organisation of their own subscriptions. Folders for bookmarks are the paid-tier
("Mawkingbird Blue") answer to a library that has outgrown its shelves.

The two want the same primitive, so this specifies it once.

> **Assumption to confirm:** "Mawkingbird Blue" is used here to mean the paid
> tier. Nothing in the repo defines it yet. If it means something else, the
> gating in §6 is the only part that changes.

## 1. The primitive

A **folder** is a user-created, user-named, user-ordered container. Three
properties define it, and each one distinguishes it from what we already have:

1. **Explicit.** Someone made it and named it. A computed shelf ("by author")
   appears and disappears as the data changes; a folder persists because a
   person said so.
2. **Assigned.** An item is in a folder because it was put there — on import,
   on subscribe, or by a later move. Never inferred.
3. **Ordered.** Both the folders themselves and (for bookmarks) the items
   inside them. An organisation you cannot arrange is half an organisation.

Computed shelves stay. They are not competing: shelves answer "show me this
library sliced by author", folders answer "show me the pile I made". A bookmarks
page should offer both, and the existing `groupByAuthor` / `groupByHashtag` are
untouched by this proposal.

## 2. Shared model

One module — `ui/src/app/folders/folders.ts` — owning the shape and the storage,
with one instance per domain rather than one global folder tree. RSS folders and
bookmark folders are different organisations of different things and must not
share a namespace.

```ts
export interface Folder {
  /** Stable id. Survives renames — assignments reference this, not the name. */
  id: string;
  name: string;
  /** Parent folder id, or null at the top level. */
  parentId: string | null;
  /** Sort position among siblings. */
  position: number;
  /** Collapsed in the UI. A view preference, stored with the folder. */
  collapsed?: boolean;
}

/** What a domain must supply to get folders. */
export interface FolderDomain {
  /** Namespace for storage: 'rss' | 'bookmarks'. */
  readonly domain: string;
  /** The key an item is filed under — feed URL, status id. */
  itemKey(item: unknown): string;
}
```

Assignments live beside the folders as `Record<itemKey, folderId>`, not as a
list of ids inside each folder. That direction matters: an item whose folder was
deleted resolves to "unfiled" by a failed lookup rather than needing a cleanup
pass, and moving an item is one write instead of two.

### Nesting

Support it, but cap the depth (**3 levels**). OPML files nest arbitrarily and
the importer must not lose data — but a tree deep enough to get lost in is a
tree nobody maintains. Deeper imports flatten by joining the path with " / " at
the cap: `Tech / Rust / Async / Tokio` becomes `Tech / Rust / Async — Tokio`.
Lossy in the display name only; nothing is dropped.

### Storage

Account-scoped via `scopedKey()`, exactly like `RssSubscriptions` — one
person's organisation is not another's, and the Anonymous account gets its own.
Two keys per domain: `mockingbird_folders_<domain>` and
`mockingbird_folder_items_<domain>`.

## 3. RSS: what changes

- **Import** stops flattening. `parseOpml` already returns `folders: string[]`
  per feed; the importer creates the folders it needs and files each feed. This
  is the entire reason the parser records paths it currently cannot use.
- **Export** writes the tree back out, so a round trip through Mawkingbird
  preserves the user's organisation instead of quietly levelling it. `buildOpml`
  gains a folder-aware branch; the flat path stays for users with no folders.
- **Settings → RSS feeds** groups the list by folder, with drag-or-menu moves
  and a folder picker on the add-feed form.
- **The feed itself is unaffected.** Folders organise the subscription list;
  they do not filter the merged timeline. "Show me only Tech" is a *filter*, and
  a valuable one, but it is a separate feature and should not be smuggled in
  here — see §7.

## 4. Bookmarks: what changes

- A folder rail alongside the existing computed shelves, with "All" and
  "Unfiled" always present.
- Save-to-folder at bookmark time, defaulting to wherever the last one went.
- Multi-select move, because retrofitting folders onto an existing library of
  400 bookmarks one at a time is not something anyone will finish.
- Raindrop.io already has collections. If a Raindrop connection is present,
  offer to seed folders from its collection names — *offer*, never sync. Two-way
  sync between a local tree and a remote one is a conflict-resolution project,
  and this is not that.

## 5. What this must not become

- **Not tags.** One item, one folder. Multi-parent filing is a different feature
  with a different UI and a much worse deletion story. Hashtag shelves already
  cover "this post is about two things".
- **Not smart folders.** A folder holds what was put in it. Rule-based
  auto-filing is `bookmark-groups.ts`'s job, and it already does it.
- **Not a filter.** See §3.
- **Not server state.** Mawkingbird is client-side (see the client-side
  constraint that governs every feature here). Folders are localStorage, exported
  through OPML for RSS and through the existing bookmark export for bookmarks.
  A user who clears site data loses them, and the export is the answer to that.

## 6. Gating

RSS folders ship to everyone. They are not a premium feature — they are
*correctness* for OPML import, and shipping an importer that knowingly discards
the user's own categories is a bug we would be choosing.

Bookmark folders are the Blue feature. The free tier keeps the computed shelves,
which are genuinely useful and unlimited.

If that split is uncomfortable, the honest alternative is a cap rather than a
wall: everyone gets folders, free accounts get some small number of them. Worth
deciding before building, because it changes where the checks live.

## 7. Deliberately out of scope

- Filtering the home timeline by folder ("only show me Tech this morning").
  Wants folders to exist first; likely the best follow-up.
- Sharing a folder as a public OPML link.
- Per-folder refresh intervals.
- Reordering by drag on touch devices — ship the menu-based move first, add drag
  once the model is proven.

## 8. Order of work

1. `folders.ts` + storage + specs. No UI.
2. RSS: settings-page grouping, add-feed picker.
3. RSS: OPML import files into folders; export writes the tree.
4. Bookmarks: rail, save-to-folder, multi-select move.
5. Raindrop collection seeding.

Steps 1–3 stand alone and are worth shipping without 4–5. That is the intended
cut line if this gets shortened.
