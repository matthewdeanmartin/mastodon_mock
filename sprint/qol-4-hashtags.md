# QoL sprint 4 — hashtag workflows

Three related gaps, all versions of the same principle: **following a hashtag is a
commitment to your Home timeline forever, so you should see what it returns first.**

The existing UI already believes this — `pages/lists/lists.html:151` says following a
tag "folds it into Home forever" — but the Feeds page still offers no way to look before
you leap.

## 4a. View-before-follow, from the Feeds page

**Where:** `pages/lists/lists.html:134–147` (the "Followed hashtags" section).

Today the only tag affordances are: rows for tags you already follow, and tag bundles.
There is no way to *evaluate* a tag from here, and the report is explicit that a bare
"type a tag to follow" textbox is the wrong answer.

Build a preview flow:

- A tag input that, on submit, **navigates to or expands a preview** — recent posts for
  that tag, using the existing tag timeline (which is anonymous-open, per the
  `mastodon-social-anonymous-endpoints` finding).
- The preview carries the Follow button. Following happens *after* posts are on screen,
  never before.
- Show enough to judge: post count in the sample, distinct authors, most recent post
  age. A tag whose last post was eight months ago is a different proposition from one
  with forty posts today, and the sample already tells us.
- `pages/tag/tag.html:6` already has a working Follow/Following toggle — the preview
  should reuse that component, not fork it.

## 4b. Following a tag with zero results

**Where:** the search page's hashtag results, and the 4a preview.

Following `#mawkingbird` before anyone has used it is legitimate and desirable — you
want to catch the first post. But it must be honest about what you are getting.

- When a tag search returns no posts, still offer **Follow this hashtag**, with copy
  that states plainly: no posts yet, following means new posts arrive in Home.
- Distinguish the three zero cases, which the codebase already knows how to tell apart
  (`search-capability.ts` `SearchAbility`): nobody has posted (offer the follow);
  the server refuses search (say so, still offer the follow — following a tag is a
  different endpoint from searching for one); the server serves no post search at all
  (`empty` / `tags-only` — the tag may well be busy and we cannot see it, so say
  *that*, and do not imply the tag is dead).

That third case matters: telling a user a hashtag is unused when the truth is our
server has no search index would be a confident lie.

## 4c. "My posts" on hashtag feeds

**Where:** `pages/tag/tag.html`.

A filter toggle on any tag feed limiting it to the signed-in user's own posts.

- Mastodon's search DSL supports `from:` and it is **verified working on
  mastodon.social** (see the `mastodon-search-dsl-verified` note), so
  `#tag from:me` is the natural implementation where search is available.
- Where post search is unavailable (the common anonymous case, and many servers
  signed-in), fall back to client-side filtering of the loaded tag timeline by author
  id. Label the difference honestly: filtering what we loaded is not the same as
  searching everything, and a "showing matches in the last N posts" line says so.
- Anonymous users have no "my" — hide the toggle rather than showing an empty result.
- Terminology-aware: the button says "My posts" / "My tweets" / "My florps" per the
  setting (see sprint 5), so build it after or alongside that, or route the string
  through `Terminology` from the start.

**Tests:** preview renders posts before any follow request is issued; a zero-result tag
still offers follow and says "no posts yet"; a `tags-only` server produces the "we
can't see them" copy rather than the "nobody posted" copy; "My posts" hidden when
anonymous.
