# Sprint 5 — Tag helper

**Goal:** a 🤖#️⃣ button on the compose box that suggests hashtags people actually browse,
not hashtags that merely sound right. You edit them, then insert them.

## The grading algorithm, in the same shape as sprint 4

A tag is worth suggesting only if it has traffic. The check is `GET /api/v2/search?type=
hashtags&q=<tag>`, which is doing double duty and is the reason this is cheap: **one call
returns both the tag's own usage history and the similar tags Mastodon knows about** — the
"get stats on those tags and search for similar tags" from Matthew's notes, in a single
request rather than two.

Short-circuiting carries over from sprint 4, adapted to the fact that a tag set is a *set*:
we need several good tags, not one winner.

```
target = 3 live tags
for each suggested tag, in order:
    uses, similar = check(tag)          # 1 API call
    if live count reaches target: stop
if fewer than target came back alive: ask the model once more, with the dead
tags and the similar tags Mastodon suggested as feedback
```

Best case **3 calls**, worst case 5. Checking a fourth and fifth tag we already have no room
for is exactly the waste sprint 4 removed.

Feeding the *similar* tags back is the part that makes the refine pass worth doing: the model
guessing again in the dark would probably guess wrong again, but "`#RustLang` is dead, but
Mastodon knows `#rust` and `#rustlang`" is a fact it can act on.

## Deliverables

1. **`compose/tag-helper.ts`** (+ spec) — pure core: `gradeTagsUntilEnough()`,
   `describeTagChecks()`, `TAG_TARGET_LIVE = 3`. Probe injected; the spec never touches HTTP.
2. **`TagHelper` service** — propose → grade → refine only when the target wasn't met.
3. **`compose/tag-helper-dialog/`** — suggested tags with their usage counts, checkboxes to
   pick, an editable line, and **Use tags**.
4. **`compose.ts` / `.html`** — the 🤖#️⃣ tool button, hidden unless OpenRouter is connected
   (decision 9). Insertion appends `#Tag` tokens to the post text, skipping any already there.

## Acceptance

- Full gate green.
- Three live tags in a row costs exactly three probes.
- A dead tag set triggers exactly one refine, carrying both the dead tags and the similar
  ones Mastodon returned.
- Tags already in the post are not inserted twice.
- The button is absent when OpenRouter is disconnected.

## Deviations from the plan as written

- **`models.ts` `Hashtag` gained an optional `history`.** The type had only `{name, url}`,
  but `/api/v2/search?type=hashtags` returns Tag entities — the mock server sends
  `{name, url, history}` and real Mastodon populates it. The type was narrower than the
  payload, which would have made the whole activity check impossible. Optional, because not
  every source fills it in (the mock returns `[]`).
- **Dead tags stay on screen**, greyed with their count, rather than being filtered out.
  "Nobody uses this" is information the user asked for, and occasionally you want the tag
  anyway. Only live ones are pre-selected.
- **Insertion appends and de-duplicates** rather than replacing the post text. Silently
  rewriting what someone wrote is not this feature's job, and tags typed inline must not be
  added twice.
- **`recentUses` takes `{ history? }`, not `Tag`.** It is used against both search results
  and trend entries; narrowing it to one nominal type bought nothing.

## Verified at runtime

20 browser checks with OpenRouter and the hashtag lookups both stubbed, so probe counts are
exact:

- Three live tags in a row → **exactly three probes** (`rust`, `compilers`, `programming`);
  the fourth and fifth suggestions were never looked up, and no refine round trip fired.
- Usage counts render ("40 recent uses"), live tags are pre-filled, `#rust #compilers
  #programming` is appended to the post with the original text intact.
- Running it a second time does **not** duplicate tags already in the post.
- An all-dead set triggers exactly one refine; the refine prompt carries both the dead tags
  and the real alternatives Mastodon returned (`related tags that do exist: deadareal`);
  after the second pass it stops rather than looping (10 probes total).
- Button absent when OpenRouter is disconnected. Escape closes.

## Explicitly deferred

- Tag *removal* suggestions ("you used 8, that's too many").
- Following suggested tags from the dialog.
- Per-tag trend sparklines — the history is fetched, but drawing it is its own thing.
