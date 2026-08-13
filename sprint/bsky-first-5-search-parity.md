# Bluesky-first — Sprint 5: search parity

Status: **COMPLETE (2026-08-12)**

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Follows: [bsky-first-4b-bsky-rails.md](bsky-first-4b-bsky-rails.md)

> The roadmap has referenced this sprint since 2026-08-11 but the file was never
> written. Written now, at build time, from a read of the actual page.

## The problem, as the user put it

> "I hope on the roadmap is for the bsky-first experience that search defaults
> to bsky search instead of mastodon search."

It was not, and Sprint 4b flagged it on the way past. `pages/search/search.ts`
opens with `type = signal<SearchType>('accounts')` and `blueskyMode =
signal(false)`, so a Bluesky-primary account searching for anything gets Mastodon
results **from a connector that, after the Sprint 4 reversal, may not even
exist**. That is the worst version of the bug: not "the wrong network first", but
"a network you explicitly declined, returning nothing".

## What the read found

The previous developer's framing — quoted in the roadmap as *"didn't even try to
make them have feature parity"* — is **out of date**. The Bluesky panel
(`bluesky-search-panel.ts`, 338 lines) already has target switching, facets,
sorts, an advanced section, and it reuses the same `search-refine` primitives
(`filterLoaded`, `buildFacets`, `statusMatchesFacet`) the Mastodon panel uses. The
two engines already look substantially alike.

The real gaps are narrower and sharper than "parity", and they cluster in one
place. `search.html` line 55:

```html
@if (!blueskyMode()) {
  <button (click)="run()">Search</button>
  … Advanced ▾ … Saved (n) ▾ … Save … Share …
}
```

**Four features sit behind one guard**, and three of them have nothing to do with
which engine is running:

| Control | Why it is hidden | Should it be? |
|---|---|---|
| Search button / query box | The Bluesky panel brings its own | **Yes** — correct as-is |
| Saved (n) ▾ / Save | Incidental. `SavedSearch` is Mastodon-shaped | **No** — this sprint |
| Share | Incidental, but blocked by the URL gap below | **No** — this sprint |
| Advanced ▾ (search helper) | Mastodon query DSL, genuinely Mastodon-specific | **Yes**, for now |

### The URL gap, which is the load-bearing one

`blueskyMode` is **not serialized**. It is a component signal set only by the type
dropdown. Consequences, all live today:

- A Bluesky search cannot be linked to. `?type=bluesky-posts` is not a thing —
  `SearchType` is `'accounts' | 'statuses' | 'hashtags'`.
- **Back-navigation loses the panel.** Click a result, press back, and you are on
  Mastodon Accounts with your Bluesky query gone.
- `Share` would produce a link that opens the wrong engine, which is why leaving
  it behind the guard is defensible *until the URL is fixed* — and indefensible
  after.

Making the default follow the account kind without fixing this makes it worse,
not better: Bluesky-primary users would land somewhere they cannot link to or
navigate back to. **The default and the URL round-trip are one change.**

## Locked decisions (user, 2026-08-12)

**1. Default follows account kind, and the URL round-trips.**

```
bsky-primary   → /search opens the Bluesky panel
mastodon       → /search opens Accounts   (unchanged)
anonymous      → /search opens Accounts   (unchanged)
signed out     → /search opens Accounts   (unchanged)
```

An explicit `?type=` in the URL always wins over the kind default — otherwise a
shared Mastodon link would be hijacked for Bluesky-primary readers, and a shared
link that does not show what the sender saw is a broken link.

**2. Saved searches extend to Bluesky.** A `network` discriminator on
`SavedSearch`, `STATE_VERSION` 1 → 2, existing rows migrating to
`network: 'mastodon'`. This is the biggest *feature* gap: a Bluesky-primary user
who now lands on Bluesky search by default cannot save a single search.

**3. Parity beyond that is audited and reported, not chased.** Fix what is cheap;
write the rest down as evidence. The page is 2106 lines and a speculative
refactor of it is not what this sprint is for. Per the roadmap: *"You don't have
to create a codesharing monster to have feature parity."*

## Planned changes

### 1. `SearchType` stays three-wide; the URL learns a fourth value

The existing comment in `search.ts` is right and is **not** being reversed:

> "Deliberately *not* a fourth `SearchType`. `SearchType` is threaded through URL
> serialization, saved searches, the query serializers and the explain panel, all
> of which are Mastodon-shaped; widening it would put a '…or bluesky' case in
> every one of them."

So the URL carries `type=bluesky-posts` as a *wire value* that maps to
`blueskyMode = true`, and `SearchType` itself is untouched. One translation at the
URL boundary, rather than a fourth case in every Mastodon-shaped consumer.

### 2. The kind default, applied once

Only when the URL specifies nothing. Applied at the same place the URL restore
happens, so there is exactly one code path deciding which panel is up.

### 3. `SavedSearch` gains a network

```ts
interface SavedSearch {
  …
  network: 'mastodon' | 'bluesky';   // new; absent ⇒ 'mastodon'
  instance: string;                  // '' for bluesky — it has no instances
  search: MawkingbirdSearch | BlueskyPostSearch;
}
```

Version bump with a migration rather than a silent shape change: a saved search
that fails to load is a user's curation quietly disappearing, which is exactly
the class of bug the `logout-vs-leave` memory records the app already having had
once.

### 4. Move Saved / Save / Share out from behind the `blueskyMode` guard

The controls stay in the shared bar; they gain awareness of which engine is live.

## Explicit non-goals

- Widening `SearchType`. See above — the existing reasoning holds.
- The search helper / Mastodon query DSL for Bluesky. Bluesky has its own filter
  set and its own advanced panel; teaching the Mastodon DSL to speak Bluesky is a
  codesharing monster and the roadmap explicitly rejects it.
- The explain panel for Bluesky.
- Web-engine hand-off from the Bluesky panel.
- Any change for mastodon-primary or anonymous users. Standing regression clause.

## Risks

| Risk | Mitigation |
|---|---|
| **A shared Mastodon link opens the Bluesky panel** for a bsky-primary reader. | An explicit `?type=` always beats the kind default. Spec'd both ways. |
| **Existing saved searches vanish** on the schema bump. | Migration defaults absent `network` to `'mastodon'`; spec loads a v1 blob and asserts every row survives. |
| **A Bluesky saved search is re-run against Mastodon** (or the reverse) because the runner ignores `network`. | `runSaved` switches on `network` before applying; spec'd for both. |
| **The default fires on every navigation**, overriding a user who deliberately switched panels mid-session. | Applied only when the URL carries no type, and only on the first restore. |
| Widening `SearchType` by accident while wiring the URL. | The wire value is translated at the boundary; `SearchType` keeps three members and the spec asserts it. |

## Exit criteria

All met unless noted.

1. ✅ `npm run test:ci` green (4023/4023); manifest clean.
2. ✅ A Bluesky-primary account opening `/search` with no query params lands on
   the **Bluesky panel**.
3. ✅ A mastodon-primary, anonymous, and signed-out session all land on
   **Accounts**, exactly as today. Three separate specs — the signed-out case is
   the one a naive predicate breaks (see Sprint 4b, which made the same mistake).
4. ✅ An explicit `?type=statuses` opens the Mastodon panel **even for a
   Bluesky-primary account**.
5. ⚠️ **Partially.** The URL round-trip is done: `?type=bluesky-posts` reopens
   the Bluesky panel, and picking Bluesky from the dropdown now writes it, so the
   back button restores the panel instead of dumping you on Mastodon Accounts.
   **`Share` remains Mastodon-only** — it serializes the full structured search
   into query params via `encodeSearchToParams`, and the Bluesky criteria have no
   such serializer. The panel is now linkable, which was the actually-broken
   part; sharing a Bluesky search *with its filters* needs a serializer and is
   recorded below.
6. ✅ A Bluesky search can be **saved, listed and re-run**. `runSaved` routes on
   the saved `network`, so a Bluesky row opens the Bluesky panel rather than
   applying its definition to the Mastodon form.
7. ✅ v1 saved searches load, list, and default to `network: 'mastodon'`.
   Spec'd against a hand-written v1 blob.
8. ✅ A mastodon-primary session's search behaviour is otherwise byte-identical.

### Found while building

- **The type system located every Mastodon-shaped consumer.** Widening
  `SavedSearch.search` to a union produced exactly three errors — the deep-link
  handler, `runSaved`, and one spec assertion. That is the whole blast radius,
  and it is the argument for the union over a parallel store.
- **`!isMastodonSaved(x)` does not narrow.** A negated type predicate leaves the
  union intact in the `else` branch, so `isBlueskySaved` exists as its
  complement rather than as sugar.
- **`ng build` passes while the spec build fails.** The app compiled clean with
  a spec still assuming the Mastodon shape; only `test:ci` caught it. Worth
  remembering that the app build is not a full typecheck of the repo.

## Audit: what parity actually looks like after this sprint

Recorded as evidence for whether a further pass is ever worth it.

| Feature | Mastodon panel | Bluesky panel | After this sprint |
|---|---|---|---|
| Query box + run | ✅ | ✅ (its own) | unchanged |
| Target switching | types dropdown | posts/accounts toggle | unchanged, different shapes |
| Facets | ✅ | ✅ (shared primitives) | unchanged |
| Sorts | ✅ | ✅ | unchanged |
| Client-side refine bar | ✅ | ✅ | unchanged |
| Advanced criteria | ✅ (Mastodon DSL) | ✅ (Bluesky fields) | unchanged, deliberately different |
| **Saved searches** | ✅ | ❌ | **✅ both** |
| **URL round-trip** | ✅ | ❌ | **✅ both** |
| Share (with filters) | ✅ | ❌ | gap — needs a Bluesky criteria serializer |
| Numeric facets | ✅ | ❌ | gap, recorded |
| Explain panel | ✅ | ❌ | gap, recorded |
| Syntax help | ✅ | n/a | not applicable |
| Web-engine hand-off | ✅ | ❌ | gap, recorded |

## What a later parity pass would cost

In rough order of value per unit of work, for whenever this is picked up again:

1. **A Bluesky criteria serializer** (~small). Unlocks `Share` for Bluesky, and
   would let a Bluesky search carry its filters in the URL rather than just the
   panel selection. The single highest-value remaining item.
2. **Numeric facets** (~medium). The Mastodon side has follower/post-count
   sliders; Bluesky's `searchActors` returns the same counts, so the control
   could be reused against different fields.
3. **Explain panel** (~medium). Needs a Bluesky equivalent of the "why these
   results" copy; genuinely different text, not shared code.
4. **Web-engine hand-off** (~small but low value). Handing a Bluesky query to
   Google is unlikely to beat searching bsky.app directly.

Deliberately still rejected: teaching the Mastodon query DSL to speak Bluesky.
The roadmap's rule holds — *"You don't have to create a codesharing monster to
have feature parity."*
