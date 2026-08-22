# mastodon_mock bugs

## `expand_spoilers` is writable on the mock but not on real Mastodon

**Found:** 2026-08-16, while adding trust levels to the UI's Settings → Content page.

The mock server accepts a writable `expand_spoilers` account preference, and
`ui/src/app/pages/settings/appearance/settings-appearance.ts` has a checkbox
bound to it (`expandSpoilers`, saved via the account-update call).

Real Mastodon does not work this way:

- The equivalent preference is `reading:expand:spoilers`, exposed **read-only**
  on `GET /api/v1/preferences`. Verified against mastodon.social — it comes back
  in the payload alongside `reading:expand:media` and `reading:autoplay:gifs`.
- There is **no API to write it**. It is settable only from the instance's own
  web UI (`/settings/preferences/other`), behind a session cookie.
- Related: `/settings/exports/follows.csv` is the same kind of route. A Bearer
  token gets `401 "You need to login or sign up before continuing"`, and it
  carries no `access-control-allow-origin`, so it is unusable from a browser app
  even with a cookie. Worth remembering before anyone proposes it as a fast path
  to a follow list.

So the Appearance checkbox does nothing against a real server: it writes a field
mastodon.social ignores, and nothing reads back. It has always been mock-only.

**Impact:** low but confusing — the box looks like a working preference and
silently has no effect off the mock.

**Options:**

1. Hide the checkbox unless the connected server is the mock.
2. Drop it from Appearance entirely, and rely on the read-only status row now on
   Settings → Content, which reports the real server value and links out to the
   page that can change it.
3. Leave it, and keep the mock deliberately more capable than upstream.

Not decided; left as-is for now. The UI's Content page no longer claims the
Appearance box is "saved to your Mastodon account for other apps to honour",
since that is not true.

---

## RSS avatars throw NG02952 in dev mode (`ng serve`, tests)

Found 2026-08-22 while building the RSS split pane (sprint/rss-2-split-pane-shell.md),
which was the first thing to render `app-status-card` inside a component test.

`rss-adapter.ts` gives every synthetic feed account an inline SVG `data:` URI as its
avatar (`RSS_AVATAR`), deliberately, to avoid external favicon fetches. But
`status-card.html` binds the avatar through `[ngSrc]`, and `NgOptimizedImage`
*throws* on a `data:` URI:

    NG02952: ... `ngSrc` is a Base64-encoded string ... NgOptimizedImage does not
    support Base64-encoded strings.

The assertion is inside `if (ngDevMode)`, so:

- **Production builds are fine** — verified at runtime: `/rss` and
  `/accounts/rss:<url>` both render RSS cards with no console error against a
  production build of the UI.
- **`ng serve` and component tests are not** — the throw fires on every RSS card.

So this is invisible in the shipped app and hits developers only. It predates the
RSS reading epic; nothing about it is new, it simply had never been rendered in a
test before.

**Workaround in place:** `rss-page.spec.ts` stubs `app-status-card`. That is the
right call for those tests on its own merits (the page's job is choosing *which*
statuses to show, not drawing them), but it is also sidestepping this.

**Options:**

1. In `status-card.html`, bind `[src]` instead of `[ngSrc]` when the avatar is a
   `data:` URI. Narrow, but splits one `<img>` into two branches.
2. Stop using a `data:` URI for `RSS_AVATAR` — ship the RSS icon as a real asset
   file. Loses the "no external fetch" property that motivated the data URI, though
   a bundled same-origin asset is not really an external fetch.
3. Leave it. Dev-only noise, and `ng serve` is not how this app is usually run.

Not decided. Out of scope for the RSS sprints; recorded so the next person who
renders an RSS card in a test knows why it explodes.

