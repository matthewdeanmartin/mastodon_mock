# Sprint 12 — Collections in the Lists tab (UI)

Mini-sprint: Mastodon 4.6 **Collections** support in the Angular UI (`./ui`),
plus a long-missing **Members view for Lists**. Code is written; **testing,
linting, and compiling are deliberately left to a follow-up bot** (token
budget). This doc is the handoff.

## What was built

### 1. Models — `ui/src/app/models.ts`
New interfaces after `UserList`: `CollectionItem`, `Collection`,
`CollectionWithAccounts`. Shapes taken from
`mastodon-openapi/dist/schema.json` (`Collection`, `CollectionItem`,
`CollectionWithAccounts`, `CollectionItemStateEnum`).

### 2. API client — `ui/src/app/api.ts`
New `--- collections ---` section:

| Method | Endpoint |
| --- | --- |
| `accountCollections(accountId)` | `GET /api/v1/{account_id}/collections` |
| `accountInCollections(accountId)` | `GET /api/v1/{account_id}/in_collections` |
| `getCollection(id)` | `GET /api/v1/collections/{id}` → `CollectionWithAccounts` |
| `createCollection(name, description?)` | `POST /api/v1/collections` (JSON) → `{collection}` |
| `updateCollection(id, changes)` | `PATCH /api/v1/collections/{id}` |
| `deleteCollection(id)` | `DELETE /api/v1/collections/{id}` |
| `addCollectionAccount(collectionId, accountId)` | `POST /api/v1/collections/{id}/items` body `{account_id}` |
| `removeCollectionItem(collectionId, itemId)` | `DELETE /api/v1/collections/{id}/items/{itemId}` (owner removes member) |
| `revokeCollectionItem(collectionId, itemId)` | `POST .../items/{itemId}/revoke` (member removes self) |

⚠️ **Assumption to verify**: `POST /items` body field is `account_id`, and the
responses are wrapped (`{collection: ...}` / `{collection_item: ...}`). The
OpenAPI dump was truncated when I read it — confirm against
`mastodon-openapi/dist/schema.json` (`postCollectionItems` requestBody) and
adjust `api.ts` if the field is `account_ids` or the wrapper key differs.

### 3. Lists page — `ui/src/app/pages/lists/*`
Below the existing lists, two new sections:
- **Collections**: create-by-name input, rows linking to `/collections/:id`
  with member count and a delete (✕) button.
- **Collections featuring me**: read-only rows from `in_collections`
  ("who has me in a collection").
Uses `Auth.account()` for the account id; if the auth snapshot isn't verified
yet it calls `verifyCredentials` first (and `setAccount`s the result). A
failing collections fetch flips `collectionsSupported=false` and shows a
"server does not support collections" note (pre-4.6 servers 404 here).

### 4. New Collection page — `ui/src/app/pages/collection/*` (`CollectionPage`)
Route added in `app.routes.ts`: `collections/:id` (inside the authed shell).
- Header: name, description, curator link, member count. Owner sees
  **Delete collection**; a featured non-owner sees
  **Remove me from this collection** (revoke).
- **Feed tab**: there is *no server collection-timeline endpoint*, so the feed
  is synthesized client-side — `forkJoin` of
  `GET /accounts/{id}/statuses?exclude_replies=true&limit=20` for each
  *accepted* member, merged, sorted by `created_at` desc, capped at 40.
  (Consistent with the Mockingbird client-side-only constraint.)
- **Members tab**: rows for each item (resolves `item.account_id` against the
  `accounts` array; pending items get a "pending" tag). Owner gets a
  search-and-add box (`/api/v2/search?type=accounts&resolve=true`) and per-row
  remove. After add/remove the page re-fetches the collection (the server
  assigns item ids).

### 5. List members view — `ui/src/app/pages/list-timeline/*`
Posts | Members tabs. Members are **lazy-loaded on first tab click**
(`GET /api/v1/lists/{id}/accounts`) — deliberately, so the existing
`list-timeline.spec.ts` passes unchanged. Each member row links to the profile
and has a remove button (`DELETE /api/v1/lists/{id}/accounts`).
New file: `list-timeline.css`.

### 6. Spec updates already made — `ui/src/app/pages/lists/lists.spec.ts`
`Lists.ngOnInit` now also fires `verify_credentials` (+ two collection GETs on
success). `setUp()` was patched to error the `verify_credentials` request so
the pre-existing tests are unaffected, and one new happy-path collections test
was added.

## For the follow-up bot (in `ui/`)

1. `npm run format` — new files were written by hand; prettier may reflow.
2. `npm run lint` (`ng lint ui --max-warnings 0`).
3. `npm run build` **and** `npm run build:mockingbird` — templates are only
   type-checked at build; expect possible errors in the new
   `collection.html` / `list-timeline.html` / `lists.html`.
4. `npm run test:ci` — the ONLY way to run specs (raw vitest fails; no
   targeted runs). All existing specs must stay green — `lists.spec.ts` and
   `list-timeline.spec.ts` are the ones my changes could break.
5. Do NOT rename any CSS class to `ad-*` (ad-blocker constraint) — none used.
6. No git commit was made; commit after the above passes.

## Testing plan (write these specs)

### `pages/collection/collection.spec.ts` (new — highest value)
Use `HttpTestingController` + `ActivatedRoute` override with
`paramMap: of(convertToParamMap({id: 'C1'}))` (copy the pattern from
`list-timeline.spec.ts`). Fixture data: a `CollectionWithAccounts` with owner
`O`, accepted member `A`, pending member `P`.
- init: GETs `/api/v1/collections/C1`; loading clears; curator/members
  computed correctly (pending + accepted both listed, pending tagged).
- feed synthesis: default tab is feed → after collection flush, expects one
  `/api/v1/accounts/A/statuses` request per **accepted** member only (not P,
  not O); statuses from multiple members are merged sorted by `created_at`
  desc and capped at 40; a per-member HTTP error contributes `[]` without
  killing the whole feed.
- feed caching: switching members→feed again does NOT refetch (feedLoadedFor
  guard).
- 404 on load → error message about server support, no crash.
- owner-only affordances: with `Auth.account()` set to owner id, `isOwner()`
  true; `addMember` POSTs `/items` then re-fetches; `removeMember` DELETEs
  `/items/{itemId}` then re-fetches; `remove()` DELETEs the collection and
  navigates to `/lists`.
- non-owner featured: `myItem()` found; `revokeSelf()` POSTs
  `.../items/{id}/revoke`.
  (Auth is a root injectable backed by localStorage — set the account via
  `TestBed.inject(Auth).account.set(...)` or `setAccount`.)

### `pages/lists/lists.spec.ts` (extend)
- pre-auth path: verify_credentials success → account persisted via
  `setAccount`, then `/api/v1/{id}/collections` + `/in_collections` fire
  (one test exists; add error case: collections GET 404 →
  `collectionsSupported()` false).
- `createCollection()`: POSTs `{name}`; wrapped real payload appends to the
  signal; the mock's stub `{collection: null}` triggers a reload instead of
  appending `null`.
- `removeCollection()`: DELETE then row disappears.

### `pages/list-timeline/list-timeline.spec.ts` (extend)
- default tab posts; NO `/lists/{id}/accounts` request on init.
- `setTab('members')` first time → GET `/api/v1/lists/{id}/accounts`, rows
  render; second visit → no refetch.
- `removeMember`: DELETE `/api/v1/lists/{id}/accounts` and row removed.
- route param change resets tab to posts and clears the members-loaded guard.

### Manual / runtime verification (use the `verify` skill)
- Against the local mock: collection endpoints are **stateless stubs**
  (`mastodon_mock/routers/misc.py`) — `GET /collections/{id}` always 404s and
  the account collections lists are always `[]`. So locally you can only
  verify: Lists page renders both new sections with empty states, create
  POST fires without crashing, and `/collections/bogus` shows the friendly
  404 message. List Members tab IS fully testable locally.
- Real behavior (Mockingbird build) needs a Mastodon 4.6+ server
  (mastodon.social); optional follow-up: make the mock's collection routes
  stateful so this is locally testable end-to-end.

## Known gaps / follow-ups (not done, by design)
- No "Add to collection" entry on profile pages (lists have one via
  list-dialog); adding members currently only via the collection page search.
- `updateCollection` (rename/description/discoverable) is in the API client
  but has no UI.
- Feed has no pagination/load-more; fixed 20-per-member / 40-total window.
- Mock server collections are stateless; consider implementing persistence.
