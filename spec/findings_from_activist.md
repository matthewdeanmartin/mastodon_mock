# Findings from proving the mock against the `activist` bot

Date: 2026-06-14. Context: `activist` (an unpublished, deliberately-not-yet-live
Mastodon bot) was wired to publish against this mock instead of a real instance,
so its write/publish path could be tested without risking a server ban. Driving
the **write** surface this way surfaced divergences the existing read-focused
contract tests didn't.

## Fixed

### 1. Status creation accepted invalid bodies (returned 200 instead of 422)

`POST /api/v1/statuses` performed **no validation**. A real Mastodon returns
`422 Unprocessable Content` (`{"error": "Validation failed: ..."}`) for:

- an **empty** status with no media/poll, and
- a status **longer than `max_characters`** — which the mock *advertises* as
  `500` on `/api/v1/instance` but did not enforce.

For a consuming bot this is dangerous: an accidental empty or over-long draft
got a phantom `200` and a blank/garbage toot, masking a bug that would be loud
against a real server.

**Fix:** `routers/statuses.py` now validates before persisting (empty text,
over-length text, and >`max_media_attachments` media), returning a
Mastodon-shaped 422. The length/media limits are pulled from the **same**
constants the instance serializer advertises (`serializers/instance.py: MAX_STATUS_CHARACTERS`, `MAX_MEDIA_ATTACHMENTS`) so the advertised and enforced
limits can't drift. Regression coverage: `tests/test_contract_status_validation.py`.

## Noted, not changed (working as designed)

### 2. No `X-RateLimit-*` headers on normal responses

`activist`'s `MastodonReader._respect_rate_limit` reads `X-RateLimit-Remaining` /
`X-RateLimit-Reset` to pace itself, but the mock omits these on ordinary
responses. This is **intentional**: rate limiting is opt-in via
`RateLimitConfig.enabled` (see `spec/01-architecture.md`). A consumer that wants
to exercise rate-limit handling must enable it in config. Worth a docs callout
so consumers don't assume the headers are always present.

### 3. Error body shape: `detail` vs `error`

Auth/404 errors raised via FastAPI `HTTPException` serialize as
`{"detail": ...}`, whereas real Mastodon (and the mock's own middleware/validation
paths) use `{"error": ...}`. Mastodon.py tolerates both (it keys off the HTTP
status), so this is cosmetic today — but a consumer that parses the body text
would see a difference. Candidate for a future global exception handler that
normalizes everything to `{"error": ...}`.

## Things that already worked well

- `Idempotency-Key` dedupe on `POST /statuses` — correct replay of the prior
  status. This is the single most important property for a poster that retries
  after a crash, and the mock got it right.
- `in_reply_to_id` threading + reply visibility propagation.
- `DELETE /statuses/:id` round-trip (the bot's "oh no" / retract tool).
- Bad/missing token → `401`.
