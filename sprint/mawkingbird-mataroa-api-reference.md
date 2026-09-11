# Mataroa API — compact reference

Captured 2026-08-08 from the Mataroa API docs page. Condensed for implementation; see
<https://mataroa.blog/api/docs/> for the authoritative version.

## Basics

- Base: `https://mataroa.blog/api/`
- **Every path ends in a trailing slash.**
- `Content-Type: application/json`
- Auth: `Authorization: Bearer <api-key>` — the key is on the account's API page.
- No rate limiting.
- Every response carries `"ok": true`.

> **The key is a full-access credential**: it can create, rewrite, and delete every post, page and
> comment on the blog. Mockingbird stores it under `mockingbird_mataroa_connection` (`secret`,
> account-scoped) and routes calls through a consented CORS proxy, which necessarily sees it —
> that is why the connection page says so in as many words.

## Posts

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/api/posts/` | `title`\*, `body`, `published_at` | `slug`, `url` |
| `GET` | `/api/posts/<slug>/` | — | `slug`, `title`, `body`, `published_at`, `url` |
| `PATCH` | `/api/posts/<slug>/` | `title`, `slug`, `body`, `published_at` (all optional) | `slug`, `url` |
| `DELETE` | `/api/posts/<slug>/` | — | `ok` |
| `GET` | `/api/posts/` | — | `post_list[]` |

\* required.

- `published_at` is a **date**, `YYYY-MM-DD` — not a timestamp.
- `published_at: null` in a listing means the post is a draft. Sending **empty** unpublishes.
- `PATCH` accepts a new `slug`, so renaming changes the post's URL.
- `GET /api/posts/` returns **full bodies**, not just metadata — one call is enough to populate an
  editor, with no per-post follow-up.

```json
// GET /api/posts/
{
  "ok": true,
  "post_list": [
    { "title": "On life", "slug": "on-life", "body": "What is life?", "published_at": null,
      "url": "https://<user>.mataroa.blog/blog/on-life/" }
  ]
}
```

## Pages

Same shape as posts, at `/api/pages/`, with two differences: `slug` is **required** on create, and
there is `is_hidden` (a boolean; hidden pages stay off the blog header) instead of `published_at`.

| Method | Path | Body |
| --- | --- | --- |
| `POST` | `/api/pages/` | `title`\*, `slug`\*, `body`, `is_hidden` |
| `GET` | `/api/pages/<slug>/` | — |
| `PATCH` | `/api/pages/<slug>/` | `title`, `slug`, `body`, `is_hidden` |
| `DELETE` | `/api/pages/<slug>/` | — |
| `GET` | `/api/pages/` | — → `page_list[]` |

## Comments

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/comments/` | every comment on your posts |
| `GET` | `/api/comments/pending/` | awaiting approval |
| `GET` | `/api/posts/<slug>/comments/` | one post's comments |
| `GET` | `/api/comments/<id>/` | one comment (wrapped in `comment`) |
| `POST` | `/api/comments/<id>/approve/` | approve a pending one |
| `DELETE` | `/api/comments/<id>/` | delete |

Comment fields: `id`, `post_slug`, `post_title`, `post_url`, `url`, `created_at` (ISO timestamp),
`name`, `email` (nullable), `body`, `is_approved`, `is_author`.

Listing endpoints return `comment_list[]`; the single-comment and approve endpoints return
`comment`.

## What Mockingbird uses today

`providers/mataroa/mataroa-api.ts` implements **two** of these: `listPosts()` (`GET /api/posts/`)
and `createPost()` (`POST /api/posts/`). `listPosts()` has one consumer — the connection settings
page, which calls it to prove the credentials work.

Unimplemented, and each unlocking something concrete:

- **`PATCH /api/posts/<slug>/`** — editing a published post. Sprint `write-5-sources.md` (S5.3) was
  written unsure whether this endpoint existed; it does, so "edit a published post" is a genuine
  update rather than a create-and-delete with two copies on failure.
- **`GET /api/posts/`, consumed for real** — pulling posts back into the editor. Bodies come with
  the listing, so this is one request.
- **`published_at: null`** — Mataroa has real drafts. They are a plausible sixth draft source
  alongside the four kinds and the paste providers.
- **Comments** — nothing in Mockingbird reads them yet.
- **Pages** — no use case identified.
