# Findings from proving the mock against `mastodon-finder`

Date: 2026-06-14. Context: `mastodon-finder` (a read-only account discovery +
enrichment tool) was pointed at this mock to add test coverage and to surface
mock gaps. Because the finder only reads, there was no ban risk — this exercised
the **read/discovery** surface end to end (search, hashtag timelines, account +
statuses, follower/following pagination, dossier enrichment).

## Good news: the read surface the finder needs is solid

All verified correct against the mock:

- `search(result_type="statuses"|"accounts")` buckets; keyword + profile-term
  discovery resolve real candidates.
- `timeline("tag/<tag>")` + `fetch_next` for hashtag pagination.
- `account()` serializes every field the enricher reads: `note`, `fields`,
  the three counts, `created_at` (real `datetime`), `bot`, `last_status_at`.
- `account_statuses(exclude_reblogs=True)` actually filters boosts; statuses
  carry `in_reply_to_id` so a reply-vs-original split works.
- `account_followers` / `account_following` pagination + `fetch_remaining`.

No mock bugs were found on the read path (contrast the write-path validation gap
found via `activist`, see `findings_from_activist.md`).

## Limitation worth a future enhancement: no federated `resolve`

`GET /api/v2/search?resolve=true` is local-only — a remote handle like
`@user@remote.example` returns zero accounts (documented in
`routers/search.py`: "no webfinger resolve"). The finder degrades gracefully
(its `lookup_account_id_by_handle` returns `None`), so nothing breaks, but a
consumer that wants to exercise federated discovery can't here.

**Candidate enhancement:** when `resolve=true` and `q` is a full `user@domain`
handle that doesn't match a local account, synthesize a stub remote `Account`
(local id, `acct="user@domain"`, `url`/`uri` on the remote domain) and return
it. That would let consumers test the "resolve a remote handle, then walk its
followers" path. Not urgent — filed as a note, no consumer is currently blocked.

## Note for consumers (not a mock issue): ids are `MaybeSnowflakeIdType`

Mastodon.py returns account/status ids as `MaybeSnowflakeIdType`, not `int`.
A wrapper `== int` is **False** (only wrapper `==` wrapper holds). This is
Mastodon.py behaviour, identical against a real server, but the mock made it
visible. Documented here so future mock consumers don't chase it as a mock bug.
See `mastodon-finder/test_integration/findings.md` for the full write-up.
