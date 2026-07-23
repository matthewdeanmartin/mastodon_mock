**Yes. This is quite feasible, and GitHub is unusually good for this use case.**

GitHub exposes the accounts a user follows:

```http
GET https://api.github.com/user/following
```

For a fine-grained PAT, the authenticated-user endpoint requires **Followers: read**. Results are paginated, up to 100 accounts per page. You can also read any public user’s following list with:

```http
GET https://api.github.com/users/{username}/following
```

That public endpoint does not require special token permissions and can even be called unauthenticated, subject to lower rate limits. ([GitHub Docs][1])

## The really useful part: use GraphQL

GitHub’s GraphQL API lets you fetch each followed account **and their profile links in the same request**. The `User` type exposes both:

* `following`
* `socialAccounts`
* `bio`
* `websiteUrl`
* `name`
* `login`
* `avatarUrl`

Each social account includes a `provider`, `displayName`, and `url`. ([GitHub Docs][2])

```graphql
query FollowedUsers($cursor: String) {
  viewer {
    following(first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        login
        name
        avatarUrl
        url
        bio
        websiteUrl

        socialAccounts(first: 10) {
          nodes {
            provider
            displayName
            url
          }
        }
      }
    }
  }
}
```

POST that to:

```http
https://api.github.com/graphql
```

with:

```http
Authorization: Bearer YOUR_PAT
```

## Finding Mastodon users

For every followed GitHub account, use this matching order:

1. **Explicit GitHub social-account link**
   Look for a social account URL that resembles a Mastodon profile:

   ```text
   https://mastodon.social/@alice
   https://fosstodon.org/@bob
   https://hachyderm.io/@carol
   ```

   This is the highest-confidence match.

2. **Profile website**
   Inspect `websiteUrl`. It may itself be a Mastodon URL or point to a personal site containing a verified Mastodon link.

3. **Bio**
   Search for patterns such as:

   ```text
   @alice@mastodon.social
   mastodon.social/@alice
   https://example.social/@alice
   ```

4. **Website verification**
   Fetch the personal website and look for:

   ```html
   <a rel="me" href="https://mastodon.social/@alice">
   ```

   `rel="me"` is especially valuable because Mastodon uses it for profile-link verification.

5. **Mastodon search as a weak fallback**
   Search the user’s GitHub login or display name through the user’s Mastodon instance API. Treat these as candidates, not confirmed matches.

## Confidence levels

I would label results:

```text
Confirmed
- Explicit Mastodon URL in GitHub social links
- rel="me" connection between GitHub-listed website and Mastodon

Probable
- Mastodon handle written in GitHub bio
- Mastodon URL used as GitHub website

Candidate
- Same username and avatar
- Same real name and linked projects
- Mastodon search result without cross-linking
```

Do **not** automatically claim that `github.com/alice` and `@alice@mastodon.social` are the same person merely because the usernames match.

## API-call cost

With GraphQL, approximately:

```text
1 request per 100 followed GitHub accounts
```

plus optional website/Mastodon verification calls.

That is much better than REST’s basic shape:

```text
1 request to obtain each page of followed users
+ 1 user-profile request per followed account
```

So for Mawkingbird, GraphQL is the obvious implementation.

## Important caveat

This finds Mastodon users only when they have left some discoverable connection:

* Mastodon in GitHub social links
* Mastodon in their bio
* GitHub-linked website with `rel="me"`
* sufficiently strong matching public details

There is no central GitHub-to-Mastodon identity directory. You will get a useful subset, probably not everyone.

**Verdict:** this could make a genuinely good Mawkingbird feature:

> Connect GitHub → Find people you follow who publish a Mastodon address → Review matches → Follow selected accounts on Mastodon.

[1]: https://docs.github.com/en/rest/users/followers?apiVersion=2022-11-28 "REST API endpoints for followers - GitHub Docs"
[2]: https://docs.github.com/en/graphql/reference/users "Users - GitHub Docs"
