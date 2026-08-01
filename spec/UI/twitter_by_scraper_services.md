# Read-Only X/Twitter Provider Integration Specification

**Target application:** TypeScript/Angular social-media client
**Providers:** GetXAPI and TwitterAPI.io
**Specification version:** 0.1
**Research date:** July 31, 2026

## 1. Purpose

Implement a provider-neutral HTTP layer that can retrieve public X/Twitter data through either:

1. GetXAPI
2. TwitterAPI.io

The application is intended primarily for an individual consumer reading and discovering public content.

The provider layer must support:

* Looking up posts
* Viewing profiles
* Viewing a user's posts, replies, and media
* Searching posts and users
* Viewing replies and conversations
* Viewing followers and followed accounts
* Viewing public lists and list feeds where supported
* Viewing hashtag, keyword, and other search-derived feeds
* Viewing trends
* Constructing consumer-oriented feeds from public data

The rest of the Angular application must not depend directly on either provider's response schema.

---

## 2. Scope clarification

### 2.1 Included

This specification includes only operations that can be performed using the application's provider API key and public Twitter data.

Included operations are:

* Read a public profile
* Resolve a username to a user ID
* Resolve a user ID to a profile
* Search users
* Read a post
* Read one or more posts by ID
* Read a user's posts
* Read a user's posts and replies
* Read a user's media posts
* Read post replies
* Read a conversation or thread
* Search posts
* Read hashtag feeds through search
* Read mentions of a public username through search or a provider endpoint
* Read followers
* Read followed accounts
* Read list members
* Read list posts where available
* Read reposting users
* Read trends
* Check public relationship information where available

### 2.2 Excluded

The following are mutations or require an authenticated Twitter account and are excluded:

* Follow or unfollow an account
* Like or unlike a post
* Repost or undo a repost
* Bookmark or remove a bookmark
* Publish, edit, or delete a post
* Send or read direct messages
* Update a profile
* Join a community
* Read private or protected content
* Read the signed-in user's private bookmarks
* Read a true personalized “For You” or “Following” home timeline
* Store or transmit X passwords, 2FA secrets, cookies, `auth_token`, or `ct0`

Although “follow” is part of the ordinary consumer experience, performing a follow is a write operation. The application may show a user's followers and followed accounts, but the actual Follow button must either be omitted, disabled, or link the user to the corresponding profile on `x.com`.

---

## 3. Important provider characteristics

### 3.1 GetXAPI

Base URL:

```text
https://api.getxapi.com
```

Authentication:

```http
Authorization: Bearer <GETXAPI_API_KEY>
```

GetXAPI documents cursor-based pagination and generally returns approximately 20 items per page. Some follower/following variants return larger pages. Most ordinary read calls are advertised at a fixed cost per call.

### 3.2 TwitterAPI.io

Base URL:

```text
https://api.twitterapi.io
```

Authentication:

```http
X-API-Key: <TWITTERAPI_IO_API_KEY>
```

TwitterAPI.io generally charges according to the number and type of records returned, with a minimum charge for small or empty calls. It documents cursor pagination and currently advertises up to 200 requests per second per client in its introduction.

### 3.3 Unofficial-service assumption

Both providers must be treated as unofficial, replaceable data sources.

The client must assume that:

* Endpoints can change without X offering compatibility guarantees.
* Individual fields can disappear or change type.
* Pagination may occasionally be inconsistent.
* A provider may temporarily lose access to an X feature.
* Deleted, withheld, protected, age-restricted, or suspended content may produce inconsistent errors.
* Data may differ slightly from what a user sees on `x.com`.
* Neither provider should be the application's permanent canonical data store.

---

## 4. Recommended application architecture

Use four layers:

```text
Angular UI
    |
SocialRepository
    |
Provider-neutral SocialProvider interface
    |
+----------------------+----------------------+
| GetXApiProvider      | TwitterApiIoProvider |
+----------------------+----------------------+
    |
Provider HTTP APIs
```

### 4.1 `SocialProvider`

Each provider adapter implements a common interface:

```ts
export interface SocialProvider {
  getProfile(ref: UserReference): Promise<SocialProfile>;
  searchProfiles(request: ProfileSearchRequest): Promise<Page<SocialProfile>>;

  getPost(postId: string): Promise<SocialPost>;
  getPostsById?(postIds: string[]): Promise<SocialPost[]>;

  getUserPosts(
    ref: UserReference,
    request?: PageRequest
  ): Promise<Page<SocialPost>>;

  getUserPostsAndReplies(
    ref: UserReference,
    request?: PageRequest
  ): Promise<Page<SocialPost>>;

  getUserMedia(
    ref: UserReference,
    request?: PageRequest
  ): Promise<Page<SocialPost>>;

  getPostReplies(
    postId: string,
    request?: PageRequest
  ): Promise<Page<SocialPost>>;

  getConversation(
    postId: string,
    request?: PageRequest
  ): Promise<ConversationResult>;

  searchPosts(
    request: PostSearchRequest
  ): Promise<Page<SocialPost>>;

  getFollowers(
    ref: UserReference,
    request?: PageRequest
  ): Promise<Page<SocialProfile>>;

  getFollowing(
    ref: UserReference,
    request?: PageRequest
  ): Promise<Page<SocialProfile>>;

  getListMembers(
    listId: string,
    request?: PageRequest
  ): Promise<Page<SocialProfile>>;

  getListPosts?(
    listId: string,
    request?: ListPostRequest
  ): Promise<Page<SocialPost>>;

  getRetweeters?(
    postId: string,
    request?: PageRequest
  ): Promise<Page<SocialProfile>>;

  getTrends?(
    request: TrendRequest
  ): Promise<TrendResult>;
}
```

Provider-specific features should be represented through optional capabilities rather than leaking provider names into the UI.

```ts
export interface ProviderCapabilities {
  postById: boolean;
  postBatchLookup: boolean;
  userPosts: boolean;
  userReplies: boolean;
  userMedia: boolean;
  postReplies: boolean;
  conversation: boolean;
  profileSearch: boolean;
  postSearch: boolean;
  followers: boolean;
  following: boolean;
  listMembers: boolean;
  listPosts: boolean;
  retweeters: boolean;
  trends: boolean;
  personalizedHomeTimeline: false;
  mutations: false;
}
```

---

## 5. Credential model

Support two deployment modes.

### 5.1 User-supplied provider key

Each user supplies their own GetXAPI or TwitterAPI.io API key.

Advantages:

* The application developer does not pay for usage.
* Per-user spending is isolated.
* A leaked key affects only that user.
* Suitable for a locally hosted or privacy-oriented client.

Store the key only in the user's browser or local application storage after presenting an explicit warning.

Recommended storage order:

1. In-memory only
2. IndexedDB encrypted with a user-supplied passphrase
3. `sessionStorage`
4. `localStorage`, only with an explicit security warning

Never include an API key in:

* Query parameters
* URLs
* Analytics events
* Error-reporting payloads
* Application logs
* Router state
* Browser history

### 5.2 Application-owned key

A shared application-owned key must not be shipped in Angular JavaScript.

Use a backend-for-frontend proxy:

```text
Angular app
    |
Your backend
    |
GetXAPI or TwitterAPI.io
```

The backend should:

* Store provider keys in a secrets manager
* Authenticate application users
* Enforce per-user quotas
* Validate every query
* Prevent arbitrary proxying
* Cache safe public responses
* Strip provider-specific debugging information
* Avoid logging authorization headers

### 5.3 CORS

Do not make CORS support a hard architectural dependency.

Both providers publish browser `fetch()` examples, but the production design should allow requests to be routed through a backend proxy if:

* A preflight response stops allowing the required header
* Provider CORS policy changes
* The application uses a shared key
* Browser extensions or privacy software interfere
* Provider errors need normalization server-side

At startup, a browser-only deployment may perform a harmless capability request and report a clear `CORS_UNAVAILABLE` configuration error rather than presenting it as a network outage.

---

## 6. Provider endpoint map

## 6.1 Authentication

| Provider      | Header                        |
| ------------- | ----------------------------- |
| GetXAPI       | `Authorization: Bearer <key>` |
| TwitterAPI.io | `X-API-Key: <key>`            |

Do not mix provider authentication headers.

---

## 6.2 Profile lookup

### GetXAPI by username

```http
GET /twitter/user/info?userName=<username>
Authorization: Bearer <key>
```

The username excludes the leading `@`.

GetXAPI returns the profile under a `data` property and documents fields including ID, username, display name, description, location, URL, verification state, follower count, and following count.

### GetXAPI by user ID

```http
GET /twitter/user/info_by_id?userId=<user-id>
Authorization: Bearer <key>
```

### TwitterAPI.io

Use its user-info endpoint:

```http
GET /twitter/user/info?userName=<username>
X-API-Key: <key>
```

Normalize the response regardless of whether the provider wraps it in `data`, returns a profile object directly, or adds `status` and `message` fields.

### Normalized method

```ts
getProfile({ username: "openai" })
getProfile({ id: "4398626122" })
```

When only a username is supplied, retain both the requested username and the stable numeric user ID returned by the provider.

---

## 6.3 User search

### GetXAPI

```http
GET /twitter/user/search?query=<query>&cursor=<cursor>
Authorization: Bearer <key>
```

### TwitterAPI.io

```http
GET /twitter/user/search?query=<query>&cursor=<cursor>
X-API-Key: <key>
```

Provider documentation may use `query`, `q`, or another parameter name. Keep the provider-specific parameter translation entirely inside the adapter and cover it with integration tests.

Normalized request:

```ts
interface ProfileSearchRequest {
  query: string;
  cursor?: string;
}
```

---

## 6.4 Post detail

### GetXAPI

```http
GET /twitter/tweet/detail?tweetId=<post-id>
Authorization: Bearer <key>
```

GetXAPI lists this as its Tweet Detail endpoint.

### TwitterAPI.io

TwitterAPI.io exposes a post lookup endpoint and a batch-style `/twitter/tweets` endpoint in its documentation.

Conceptual request:

```http
GET /twitter/tweets?tweet_ids=<comma-separated-ids>
X-API-Key: <key>
```

The adapter must follow the currently documented parameter name. Do not assume it remains `tweet_ids`; verify it in the provider's OpenAPI or documentation during implementation.

Normalized behavior:

* `getPost(id)` returns exactly one matching post.
* A missing post throws `SocialApiError` with code `POST_NOT_FOUND`.
* A batch response may omit unavailable IDs.
* Batch results must be reordered to match the caller's requested ID order when possible.

---

## 6.5 User posts

### GetXAPI

```http
GET /twitter/user/tweets?userName=<username>&cursor=<cursor>
Authorization: Bearer <key>
```

or, preferably:

```http
GET /twitter/user/tweets?userId=<user-id>&cursor=<cursor>
Authorization: Bearer <key>
```

GetXAPI says user-ID lookup avoids an internal username-to-ID request and is faster. Results correspond to the user's Posts tab rather than the user's home feed. It returns approximately 20 posts per page and paginates with `next_cursor` and `has_more`.

### TwitterAPI.io by user ID

```http
GET /twitter/user/tweet_timeline?userId=<user-id>&cursor=<cursor>
X-API-Key: <key>
```

TwitterAPI.io documents up to 20 posts per page, in the order shown on the user's profile.

### TwitterAPI.io by username

```http
GET /twitter/user/last_tweets?userName=<username>&cursor=<cursor>
X-API-Key: <key>
```

Prefer the user-ID timeline after the first profile resolution.

---

## 6.6 User posts and replies

### GetXAPI

```http
GET /twitter/user/tweets_and_replies?userName=<username>&cursor=<cursor>
Authorization: Bearer <key>
```

This corresponds to the user's Replies tab and includes both authored root posts and replies.

### TwitterAPI.io

Use the provider's user timeline or last-tweets endpoint if it exposes replies in the returned profile timeline.

When the provider does not offer an exact equivalent, fall back to search:

```text
from:<username> include:nativeretweets
```

Do not silently claim this fallback is complete. Return:

```ts
{
  completeness: "best-effort"
}
```

rather than `"complete"`.

---

## 6.7 User media

### GetXAPI

```http
GET /twitter/user/media?userName=<username>&cursor=<cursor>
Authorization: Bearer <key>
```

### TwitterAPI.io

When no dedicated media endpoint is available, use advanced search:

```text
from:<username> filter:media
```

The normalized result should contain posts, not a flat media array. The UI can derive media attachments from each post.

---

## 6.8 Advanced post search

Both providers expose the same broad path:

```http
GET /twitter/tweet/advanced_search
```

### GetXAPI

```http
GET /twitter/tweet/advanced_search?q=<query>&product=Latest&cursor=<cursor>
Authorization: Bearer <key>
```

Supported product values documented by GetXAPI:

* `Latest`
* `Top`

GetXAPI documents advanced X search syntax and approximately 20 posts per page.

### TwitterAPI.io

```http
GET /twitter/tweet/advanced_search?query=<query>&queryType=Latest
X-API-Key: <key>
```

The exact search parameter names must be taken from the provider's current schema.

TwitterAPI.io warns that advanced-search cursor pagination may be unreliable and recommends bounding searches using time ranges so a request produces no more than roughly 20 results.

### Normalized request

```ts
interface PostSearchRequest {
  query: string;
  sort?: "latest" | "top";
  cursor?: string;
  since?: Date;
  until?: Date;
  limitHint?: number;
}
```

### Query generation

Support direct advanced queries, but also provide structured helpers:

```ts
interface StructuredPostSearch {
  text?: string;
  exactPhrase?: string;
  anyWords?: string[];
  excludeWords?: string[];
  fromUsername?: string;
  toUsername?: string;
  mentioningUsername?: string;
  hashtag?: string;
  language?: string;
  hasMedia?: boolean;
  hasImages?: boolean;
  hasVideos?: boolean;
  excludeReplies?: boolean;
  minimumLikes?: number;
  minimumReplies?: number;
  minimumReposts?: number;
  since?: Date;
  until?: Date;
}
```

The generated query should remain visible to the user so behavior is understandable and debuggable.

Examples:

```text
#angular
```

```text
from:openai
```

```text
to:openai
```

```text
@openai -from:openai
```

```text
"large language model" filter:media min_faves:100
```

### Hashtag feed

A hashtag feed is simply:

```ts
searchPosts({
  query: "#typescript",
  sort: "latest"
});
```

Do not create a separate provider endpoint unless one is explicitly documented.

---

## 6.9 Post replies

### GetXAPI

```http
GET /twitter/tweet/replies?tweetId=<post-id>&cursor=<cursor>
Authorization: Bearer <key>
```

### TwitterAPI.io

Use its tweet-replies endpoint, generally under:

```http
GET /twitter/tweet/replies?tweetId=<post-id>&cursor=<cursor>
X-API-Key: <key>
```

Fallback search:

```text
conversation_id:<post-id>
```

The fallback may include non-reply conversation posts and may not reproduce Twitter's ranking. Mark it as best-effort.

---

## 6.10 Conversation or thread

### GetXAPI

```http
GET /twitter/tweet/thread?tweetId=<post-id>
Authorization: Bearer <key>
```

GetXAPI lists a dedicated Thread endpoint with a higher per-call price than ordinary reads.

A thread endpoint may mean either:

* The author's connected self-reply thread
* The complete conversation tree
* Ancestors plus selected descendants

Do not assume these are equivalent. Normalize the result as:

```ts
interface ConversationResult {
  focusPost: SocialPost;
  ancestors: SocialPost[];
  authorThread: SocialPost[];
  replies: SocialPost[];
  completeness: "complete" | "partial" | "best-effort";
}
```

### TwitterAPI.io

Build the conversation from:

1. Post detail
2. Parent lookups using `inReplyToId`
3. Reply retrieval
4. `conversationId` search where necessary

Apply recursion and page limits to avoid an unexpectedly expensive request chain.

---

## 6.11 Followers

### GetXAPI

Standard:

```http
GET /twitter/user/followers?userName=<username>&cursor=<cursor>
Authorization: Bearer <key>
```

Alternative:

```http
GET /twitter/user/followers_v2?userName=<username>&cursor=<cursor>
Authorization: Bearer <key>
```

GetXAPI documents that ordinary follower/following endpoints can return up to 200 records per page and v2 variants approximately 70, though actual response size should not be assumed.

### TwitterAPI.io

```http
GET /twitter/user/followers?userName=<username>&cursor=<cursor>
X-API-Key: <key>
```

TwitterAPI.io documents reverse-chronological ordering by follow date and cursor pagination.

TwitterAPI.io also exposes a bulk ID-only endpoint:

```http
GET /twitter/user/followers_ids?userName=<username>&cursor=<cursor>
X-API-Key: <key>
```

The bulk endpoint can return up to 5,000 IDs per request, but it is intended for graph collection rather than consumer profile display.

Do not use the ID-only endpoint for the ordinary UI unless profile records are already cached.

---

## 6.12 Following

### GetXAPI

```http
GET /twitter/user/following?userName=<username>&cursor=<cursor>
Authorization: Bearer <key>
```

Alternative:

```http
GET /twitter/user/following_v2?userName=<username>&cursor=<cursor>
Authorization: Bearer <key>
```

### TwitterAPI.io

```http
GET /twitter/user/followings?userName=<username>&cursor=<cursor>
X-API-Key: <key>
```

Note the provider uses the plural word `followings` in the path. It documents cursor pagination and supports larger page sizes with tiered per-item pricing.

The normalized application method should still be named `getFollowing`.

---

## 6.13 Public list members

### GetXAPI

```http
GET /twitter/list/members?listId=<list-id>&cursor=<cursor>
Authorization: Bearer <key>
```

GetXAPI documents approximately 20 public-list members per page.

### TwitterAPI.io

```http
GET /twitter/list/members?list_id=<list-id>&cursor=<cursor>
X-API-Key: <key>
```

TwitterAPI.io documents a page size of 20. Its parameter is documented as `list_id` on this endpoint.

---

## 6.14 Public list posts

### TwitterAPI.io

```http
GET /twitter/list/tweets?listId=<list-id>&cursor=<cursor>
X-API-Key: <key>
```

Optional parameters documented by TwitterAPI.io include:

* `sinceTime`: Unix seconds
* `untilTime`: Unix seconds
* `includeReplies`: boolean
* `cursor`

It returns approximately 20 posts in reverse chronological order. The documentation warns that `has_next_page` may occasionally remain true even when the following page is empty.

TwitterAPI.io also documents:

```http
GET /twitter/list/tweets_timeline
```

Treat `/twitter/list/tweets` as the preferred initial implementation unless testing establishes that `tweets_timeline` better matches the consumer UI.

### GetXAPI

The currently indexed GetXAPI endpoint list documents public list members but not a corresponding public list-post feed.

Fallback options:

1. Retrieve list members and merge their recent posts.
2. Mark `listPosts` unsupported.
3. Permit the user to switch to TwitterAPI.io for list feeds.

The merge fallback has significant limitations:

* It is not Twitter's list-feed ranking.
* It requires many calls.
* It can miss posts between refreshes.
* It may produce incorrect ordering if calls complete at different times.
* A large list can be prohibitively expensive.

The default GetXAPI adapter should therefore report:

```ts
capabilities.listPosts = false;
```

unless GetXAPI adds and documents a list-post endpoint.

---

## 6.15 Retweeters/reposters

### GetXAPI

```http
GET /twitter/tweet/retweeters?tweetId=<post-id>&cursor=<cursor>
Authorization: Bearer <key>
```

### TwitterAPI.io

```http
GET /twitter/tweet/retweeters?tweetId=<post-id>&cursor=<cursor>
X-API-Key: <key>
```

Both providers document this general feature.

---

## 6.16 Trends

### GetXAPI

```http
GET /twitter/trends
Authorization: Bearer <key>
```

Trend locations:

```http
GET /twitter/trends/locations
Authorization: Bearer <key>
```

GetXAPI lists both endpoints in its current endpoint index.

### TwitterAPI.io

TwitterAPI.io documents a trends endpoint. Treat location parameters and returned trend fields as provider-specific until validated against a live response.

Normalized request:

```ts
interface TrendRequest {
  locationId?: string;
  locationName?: string;
}
```

Normalized result:

```ts
interface TrendResult {
  location?: {
    id?: string;
    name: string;
    country?: string;
  };
  trends: SocialTrend[];
  fetchedAt: string;
}
```

---

## 7. Personalized feeds

## 7.1 True X home timeline

A true signed-in home timeline is out of scope.

GetXAPI lists:

```http
POST /twitter/user/home_timeline
```

but places it among authenticated-user operations. Its documentation distinguishes API-key-only reads from operations that additionally require Twitter account authentication.

Do not request a Twitter session token merely to reproduce a home feed.

## 7.2 Local following feed

The application may construct its own local feed.

The user maintains a local collection of profiles:

```ts
interface LocalSubscription {
  providerIndependentUserId: string;
  username: string;
  addedAt: string;
}
```

Refresh procedure:

1. Retrieve recent posts for each locally followed account.
2. Deduplicate posts by post ID.
3. Sort by parsed creation timestamp descending.
4. Persist a high-water mark per user.
5. Stop retrieving pages when older than the high-water mark.
6. Apply a concurrency limit.
7. Cache profile and post responses.
8. Label the result “Local Following Feed,” not “X Home.”

Limitations:

* No X recommendation ranking
* No private accounts
* No promoted posts
* No social-context ranking
* Potential omissions due to provider pagination
* Cost grows approximately with the number of followed accounts
* Reposts and replies may differ from Twitter's native feed

Recommended default concurrency:

```text
4 concurrent requests
```

Recommended refresh policy:

* Active foreground refresh: user initiated
* Automatic foreground refresh: no more often than every 2–5 minutes
* Background refresh: disabled by default
* Per-user timeline cache: 30–120 seconds
* Profile cache: 6–24 hours

---

## 8. Normalized data model

## 8.1 IDs

All X IDs must be represented as strings.

Never use JavaScript `number` for:

* Post IDs
* User IDs
* Conversation IDs
* List IDs
* Media IDs

They can exceed JavaScript's safe integer range.

```ts
type SocialId = string;
```

---

## 8.2 Profile

```ts
export interface SocialProfile {
  id: SocialId;
  username: string;
  displayName: string;
  description: string | null;
  location: string | null;
  websiteUrl: string | null;

  profileUrl: string;
  avatarUrl: string | null;
  bannerUrl: string | null;

  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  mediaCount: number | null;
  likesCount: number | null;

  createdAt: string | null;

  isProtected: boolean;
  isBlueVerified: boolean;
  verificationType: string | null;

  canDm: boolean | null;
  possiblySensitive: boolean | null;
  pinnedPostIds: SocialId[];

  unavailableReason: string | null;

  raw?: unknown;
}
```

Do not infer legacy verification solely from a blue-check boolean. Preserve both:

* `isBlueVerified`
* `verificationType`

Normalize usernames without `@`.

---

## 8.3 Post

```ts
export interface SocialPost {
  id: SocialId;
  url: string;
  text: string;

  author: SocialProfileSummary;

  createdAt: string | null;
  language: string | null;
  source: string | null;

  conversationId: SocialId | null;
  inReplyToPostId: SocialId | null;
  inReplyToUserId: SocialId | null;
  inReplyToUsername: string | null;

  isReply: boolean;
  isRepost: boolean;
  isQuote: boolean;

  replyCount: number | null;
  repostCount: number | null;
  quoteCount: number | null;
  likeCount: number | null;
  bookmarkCount: number | null;
  viewCount: number | null;

  entities: SocialEntities;
  media: SocialMedia[];

  quotedPost: SocialPost | null;
  repostedPost: SocialPost | null;

  displayTextRange: [number, number] | null;
  limitedReply: boolean | null;
  possiblySensitive: boolean | null;

  raw?: unknown;
}
```

Use a recursion-depth guard when normalizing quoted and reposted posts.

Recommended maximum embedded depth:

```text
2
```

Beyond that, retain only a summary or referenced post ID.

---

## 8.4 Entities

```ts
export interface SocialEntities {
  hashtags: Array<{
    text: string;
    start?: number;
    end?: number;
  }>;

  mentions: Array<{
    id?: SocialId;
    username: string;
    displayName?: string;
    start?: number;
    end?: number;
  }>;

  urls: Array<{
    shortUrl: string;
    expandedUrl: string | null;
    displayUrl: string | null;
    start?: number;
    end?: number;
  }>;

  symbols: Array<{
    text: string;
    start?: number;
    end?: number;
  }>;
}
```

Prefer provider-supplied expanded URLs. Do not make a browser `HEAD` request to every `t.co` link.

---

## 8.5 Media

```ts
export type SocialMedia =
  | {
      type: "image";
      url: string;
      previewUrl?: string;
      width?: number;
      height?: number;
      altText?: string | null;
    }
  | {
      type: "video" | "gif";
      previewUrl?: string;
      variants: Array<{
        url: string;
        contentType?: string;
        bitrate?: number;
      }>;
      width?: number;
      height?: number;
      durationMs?: number;
      altText?: string | null;
    };
```

Prefer HTTPS variants.

Do not assume that the highest-bitrate URL is always usable indefinitely; provider-supplied media URLs can expire.

---

## 8.6 Pagination

```ts
export interface PageRequest {
  cursor?: string;
  pageSizeHint?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  completeness: "complete" | "partial" | "best-effort";
  provider: "getxapi" | "twitterapi-io";
  rawCount: number;
}
```

Provider translation:

| Normalized | GetXAPI                 | TwitterAPI.io           |
| ---------- | ----------------------- | ----------------------- |
| Items      | endpoint-specific array | endpoint-specific array |
| More pages | `has_more`              | `has_next_page`         |
| Cursor     | `next_cursor`           | `next_cursor`           |

Pagination termination rules:

Stop when any of these is true:

1. `has_more` or `has_next_page` is explicitly false.
2. `next_cursor` is absent or empty.
3. The returned item array is empty.
4. The next cursor equals the current cursor.
5. A cursor repeats anywhere in the current pagination session.
6. The configured maximum page count is reached.
7. The configured item limit is reached.

This protects against the documented TwitterAPI.io case where a response may claim another page exists but the next page is empty.

Provider cursors are opaque. Never:

* Parse them
* Modify them
* URL-decode and reconstruct them
* Reuse one endpoint's cursor on another endpoint
* Reuse a GetXAPI cursor with TwitterAPI.io
* Persist them indefinitely

---

## 9. Date handling

Provider timestamps may use strings resembling:

```text
Mon Jan 12 13:44:55 +0000 2026
```

or ISO-8601.

Normalize immediately to ISO-8601 UTC:

```text
2026-01-12T13:44:55.000Z
```

If parsing fails:

* Set `createdAt` to `null`.
* Preserve the original under `raw`.
* Do not substitute the current time.
* Record a non-sensitive diagnostic event.

Search timestamps must be translated per provider:

* Search query operators may use calendar dates.
* TwitterAPI.io list endpoints may use Unix timestamps in seconds.
* Never send JavaScript milliseconds where seconds are expected.

---

## 10. Error model

```ts
export type SocialApiErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_API_KEY"
  | "INSUFFICIENT_CREDITS"
  | "BAD_REQUEST"
  | "USER_NOT_FOUND"
  | "POST_NOT_FOUND"
  | "LIST_NOT_FOUND"
  | "PROTECTED_CONTENT"
  | "CONTENT_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_CHANGED"
  | "CORS_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "ABORTED"
  | "UNSUPPORTED"
  | "UNKNOWN";

export class SocialApiError extends Error {
  constructor(
    message: string,
    public readonly code: SocialApiErrorCode,
    public readonly provider: "getxapi" | "twitterapi-io",
    public readonly httpStatus?: number,
    public readonly retryAfterMs?: number,
    public readonly providerMessage?: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}
```

### 10.1 Baseline status mapping

| HTTP status | Normalized interpretation                                             |
| ----------- | --------------------------------------------------------------------- |
| 400         | `BAD_REQUEST`                                                         |
| 401         | `INVALID_API_KEY`                                                     |
| 402         | `INSUFFICIENT_CREDITS`, when provider uses it                         |
| 403         | `PROTECTED_CONTENT`, `INSUFFICIENT_CREDITS`, or provider policy error |
| 404         | Entity-specific not found                                             |
| 408         | `TIMEOUT`                                                             |
| 409         | Provider-specific conflict                                            |
| 429         | `RATE_LIMITED`                                                        |
| 500         | `PROVIDER_UNAVAILABLE`                                                |
| 502         | `PROVIDER_UNAVAILABLE`                                                |
| 503         | `PROVIDER_UNAVAILABLE`                                                |
| 504         | `TIMEOUT`                                                             |

GetXAPI documents JSON errors containing an `error` property and lists 400, 401, 404, 429, and 502 among common statuses.

TwitterAPI.io responses often include some combination of:

```json
{
  "status": "error",
  "error": 123,
  "message": "..."
}
```

Do not treat HTTP 200 alone as success. Inspect provider-level status fields.

### 10.2 Schema-change detection

When a required property is missing:

1. Do not throw a raw `TypeError`.
2. Capture a sanitized schema mismatch.
3. Throw `PROVIDER_CHANGED`.
4. Include endpoint and missing field names.
5. Do not include the API key or complete response in telemetry.
6. Allow partial rendering when nonessential fields are missing.

Use runtime validation with a library such as Zod, Valibot, ArkType, or manually maintained type guards.

TypeScript interfaces alone do not validate HTTP responses.

---

## 11. Retry policy

Retry only idempotent read requests.

Recommended policy:

```text
Maximum attempts: 3
Base delay: 500 ms
Backoff: exponential
Jitter: full jitter
Maximum delay: 8 seconds
```

Retry:

* Network failures
* HTTP 408
* HTTP 429, respecting `Retry-After`
* HTTP 500
* HTTP 502
* HTTP 503
* HTTP 504

Do not automatically retry:

* 400
* 401
* 402
* Most 403 responses
* 404
* Aborted requests
* Runtime schema failures

Since API calls cost money, retries must be conservative. A timed-out request may already have been processed and billed.

---

## 12. Cancellation and request deduplication

Angular navigation and typeahead search can create wasteful calls.

Every provider method should support cancellation using `AbortSignal`, directly or through RxJS unsubscription.

Deduplicate identical in-flight requests using a key formed from:

```text
provider + method + normalized URL + non-secret request body
```

Examples:

* Two components requesting the same profile should share one HTTP operation.
* Fast user-search input should cancel the previous request.
* Navigating away from a conversation should cancel pending reply pages.
* Retrying a timed-out call should not run concurrently with the original request unless the original is known to have failed.

---

## 13. Caching

Suggested cache keys:

```text
profile:<provider>:<user-id-or-lowercase-username>
post:<provider>:<post-id>
timeline:<provider>:<user-id>:<cursor-or-first>
search:<provider>:<hash-of-query>:<sort>:<cursor>
followers:<provider>:<user-id>:<cursor>
following:<provider>:<user-id>:<cursor>
list-members:<provider>:<list-id>:<cursor>
list-posts:<provider>:<list-id>:<cursor>
trends:<provider>:<location>
```

Suggested TTLs:

| Data                       |            TTL |
| -------------------------- | -------------: |
| Post detail                | 30–120 seconds |
| User's first timeline page | 30–120 seconds |
| Older timeline pages       |   5–30 minutes |
| Profile                    |        6 hours |
| Followers/following page   |  15–60 minutes |
| List members               |  15–60 minutes |
| Search first page          |  15–60 seconds |
| Search historical page     |   5–30 minutes |
| Trends                     |    2–5 minutes |
| Deleted/not-found result   | 30–120 seconds |

Counts such as likes and views are mutable. Avoid treating a cached post as permanently immutable.

---

## 14. Cost controls

Expose provider consumption to users.

Recommended controls:

```ts
interface UsagePolicy {
  maximumPagesPerInteraction: number;
  maximumItemsPerInteraction: number;
  maximumConcurrentRequests: number;
  dailySoftRequestLimit?: number;
  dailyHardRequestLimit?: number;
  warnBeforeExpensiveFanOut: boolean;
}
```

Recommended defaults:

```text
Maximum pages per button click: 5
Maximum posts per feed load: 100
Maximum concurrent requests: 4
Maximum conversation ancestor lookups: 20
Maximum local-feed accounts per refresh batch: 25
```

Display an estimate before expensive operations such as:

* Loading thousands of followers
* Constructing a feed across hundreds of profiles
* Fetching an entire conversation
* Fetching every list member and then every member timeline

### Provider differences

GetXAPI mostly prices ordinary reads per request, so maximize useful records per request while avoiding unnecessary pagination.

TwitterAPI.io generally prices tweets, profiles, and social-graph records according to returned records, with minimum per-call charges and separate list-call pricing.

Do not encode prices as permanent constants. Define remotely or locally updateable pricing metadata:

```ts
interface ProviderPricingMetadata {
  effectiveDate: string;
  currency: "USD";
  notes: string[];
  sourceUrl: string;
}
```

---

## 15. Provider selection and fallback

Provider selection must be explicit.

```ts
type ProviderSelection =
  | { mode: "fixed"; provider: ProviderId }
  | { mode: "capability"; preferred: ProviderId }
  | { mode: "manual-fallback"; primary: ProviderId; secondary: ProviderId };
```

Do not automatically send the same request to another provider after:

* Authentication failure
* Insufficient credits
* A user-not-found result
* Protected content
* A billing-related response

Optional failover may occur for:

* Network failure
* 502/503/504
* Provider-specific unsupported capability

Before fallback, consider cost and privacy. The application may otherwise disclose the user's searches to two companies instead of one.

Recommended UI behavior:

```text
GetXAPI could not complete this request.
Try the same public-data request through TwitterAPI.io?
```

---

## 16. Angular HTTP integration

Use separate interceptors or explicit adapter headers.

Do not create one global interceptor that sends both API keys.

Conceptual setup:

```ts
@Injectable()
export class GetXApiProvider implements SocialProvider {
  private readonly baseUrl = "https://api.getxapi.com";

  constructor(
    private readonly http: HttpClient,
    private readonly credentials: ProviderCredentialStore
  ) {}

  private headers(): HttpHeaders {
    const key = this.credentials.requireKey("getxapi");

    return new HttpHeaders({
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    });
  }
}
```

```ts
@Injectable()
export class TwitterApiIoProvider implements SocialProvider {
  private readonly baseUrl = "https://api.twitterapi.io";

  constructor(
    private readonly http: HttpClient,
    private readonly credentials: ProviderCredentialStore
  ) {}

  private headers(): HttpHeaders {
    const key = this.credentials.requireKey("twitterapi-io");

    return new HttpHeaders({
      "X-API-Key": key,
      Accept: "application/json"
    });
  }
}
```

Rules:

* Use `HttpParams` rather than string concatenation.
* Ensure search syntax is encoded exactly once.
* Never log `HttpHeaders`.
* Use RxJS `switchMap` for typeahead.
* Use `shareReplay` carefully for in-flight deduplication.
* Clear cached credential-dependent results when the provider or key changes.
* Treat status 0 as potentially CORS, DNS, connection, or browser blocking—not automatically as a provider outage.

---

## 17. Runtime response validation

Maintain provider-specific wire schemas separately from normalized models.

Example structure:

```text
social/
  model/
    social-profile.ts
    social-post.ts
    social-page.ts
    social-error.ts

  providers/
    getxapi/
      getxapi-provider.ts
      getxapi-wire-types.ts
      getxapi-schemas.ts
      getxapi-normalizers.ts

    twitterapi-io/
      twitterapi-io-provider.ts
      twitterapi-io-wire-types.ts
      twitterapi-io-schemas.ts
      twitterapi-io-normalizers.ts
```

Do not reuse one provider's wire type for the other merely because current examples look similar.

The providers may expose superficially similar objects while differing in:

* Envelope shape
* Boolean field names
* Verification semantics
* Cursor fields
* Error fields
* Timestamp formatting
* Embedded quote/repost shape
* Null versus missing fields
* `userName` versus `screen_name`
* `has_more` versus `has_next_page`

---

## 18. Testing requirements

## 18.1 Unit tests

For each provider, test:

* Authentication header
* Username stripping
* Query encoding
* ID preservation as string
* Profile normalization
* Post normalization
* Quote normalization
* Repost normalization
* Media normalization
* Empty results
* Missing optional fields
* Invalid timestamps
* Cursor translation
* Duplicate cursor termination
* HTTP error mapping
* Provider-level error inside HTTP 200
* Cancellation
* Retry eligibility
* API-key redaction

## 18.2 Contract fixtures

Store sanitized example JSON fixtures for:

* Profile
* Suspended profile
* Protected profile
* Post
* Deleted post
* Quote post
* Repost
* Long-form/Note post
* Post with image
* Post with video
* Post with URL entities
* Search page
* Empty search page
* Followers page
* Following page
* List members
* List posts
* Trends
* Every error envelope encountered

Fixtures must not contain:

* Provider keys
* X cookies
* Private posts
* Personal private account information

## 18.3 Live integration tests

Run a small opt-in live suite against stable public fixtures:

* One known public profile
* One known public post
* One user timeline
* One simple search
* One follower page
* One list, where supported

Avoid relying solely on celebrity accounts, which can change usernames or visibility.

Live tests must:

* Have a strict request budget
* Never run on every unit-test invocation
* Be disabled when credentials are absent
* Produce sanitized failures
* Record provider response-schema drift
* Not exercise login or write endpoints

---

## 19. Privacy and security requirements

The application must disclose that searches and requested public profiles are sent to the selected third-party provider.

Never send:

* X password
* X 2FA seed
* Twitter session cookie
* X `auth_token`
* X `ct0`
* Direct-message content
* Private-list content
* Browser cookies
* Unrelated application telemetry

Media URLs should be loaded according to the user's privacy settings because loading remote images discloses IP address and browser metadata to the image host or CDN.

Optional privacy mode:

* Proxy media through the application's backend
* Do not autoplay videos
* Do not load profile images until visible
* Disable link-preview requests
* Strip tracking query parameters from expanded links where safe

---

## 20. User-facing capability matrix

| Feature                       |                  GetXAPI |         TwitterAPI.io | Notes                                  |
| ----------------------------- | -----------------------: | --------------------: | -------------------------------------- |
| Profile by username           |                      Yes |                   Yes | Public profiles                        |
| Profile by ID                 |                      Yes | Yes/adapter-dependent | Cache stable ID                        |
| User search                   |                      Yes |                   Yes | Cursor behavior may vary               |
| Post detail                   |                      Yes |                   Yes | TwitterAPI.io supports multi-ID lookup |
| User posts                    |                      Yes |                   Yes | Prefer user ID                         |
| User posts and replies        |                      Yes |       Yes/best effort | Validate exact semantics               |
| User media                    |                      Yes |       Search fallback | `from:user filter:media`               |
| Advanced post search          |                      Yes |                   Yes | Pagination differs                     |
| Hashtag feed                  |                   Search |                Search | Use `#tag`                             |
| Mentions feed                 |          Endpoint/search |       Endpoint/search | Public mentions only                   |
| Post replies                  |                      Yes |                   Yes | Cursor-paginated                       |
| Conversation/thread           |                      Yes |               Compose | Define completeness                    |
| Followers                     |                      Yes |                   Yes | Page sizes and pricing differ          |
| Following                     |                      Yes |                   Yes | TwitterAPI.io path uses `followings`   |
| List members                  |                      Yes |                   Yes | Public lists                           |
| List posts                    | Not currently documented |                   Yes | Major provider difference              |
| Reposters                     |                      Yes |                   Yes | Optional UI                            |
| Trends                        |                      Yes |                   Yes | Validate location support              |
| Local constructed feed        |                      Yes |                   Yes | App-generated                          |
| True personalized X home feed |                       No |                    No | Requires Twitter session                     |
| Follow/unfollow               |             Out of scope |          Out of scope | Mutation                               |
| Like/repost/bookmark          |             Out of scope |          Out of scope | Mutation                               |
| Private/protected data        |                       No |                    No | Not supported                          |

---

## 21. Minimum viable implementation

### Phase 1

Implement:

* Provider configuration
* API-key validation
* Profile lookup
* Post lookup
* User timeline
* Advanced search
* Hashtag feed
* Replies
* Followers
* Following
* Pagination
* Normalized errors
* Runtime schema validation
* Caching
* Request cancellation

### Phase 2

Add:

* User search
* Media timeline
* Conversation assembly
* List members
* TwitterAPI.io list posts
* Trends
* Reposters
* Local following feed
* Provider fallback UI
* Cost estimates

### Phase 3

Add:

* Persistent offline cache
* Multi-provider comparison diagnostics
* Export/import of local subscriptions
* User-configurable quotas
* Schema-drift reporting
* Backend proxy mode

---

## 22. Acceptance criteria

The integration is complete when:

1. The same profile screen works with either provider without provider-specific UI logic.
2. The same post component renders posts from either provider.
3. IDs are never converted to JavaScript numbers.
4. Search supports raw X advanced-search syntax.
5. Hashtag feeds are implemented through search.
6. Followers and following lists paginate safely.
7. Repeated or empty cursors cannot cause infinite pagination.
8. Provider API keys never appear in URLs or logs.
9. No Twitter account credential or session token is requested.
10. The UI does not claim to provide a native X home timeline.
11. Unsupported provider capabilities are reported explicitly.
12. Provider HTTP 200 responses containing error status are treated as errors.
13. A provider schema change produces a controlled error rather than an application crash.
14. All read requests can be cancelled.
15. Automatic retries are bounded and cost-aware.
16. A shared application key cannot be extracted from Angular client code.
17. Live integration tests stay within a predetermined request budget.

---

## 23. Implementation warnings for the coding LLM

* Consult each provider's current endpoint documentation before fixing exact query-parameter names; similar endpoints sometimes use `userName`, `userId`, `tweetId`, `listId`, or `list_id`.
* Never infer write access from the presence of a provider endpoint.
* Do not implement provider login endpoints.
* Do not accept X passwords or cookies.
* Do not model IDs as numbers.
* Do not assume HTTP 200 means success.
* Do not assume cursor pagination is internally consistent.
* Do not expose a shared API key in an Angular environment file; production Angular environment values are bundled into downloadable JavaScript.
* Do not represent a locally merged timeline as Twitter's official “Following” feed.
* Do not treat `isBlueVerified` as proof of legacy identity verification.
* Do not rely on TypeScript compile-time interfaces to validate untrusted JSON.
* Keep provider wire objects out of components.
* Preserve raw responses only in development or after rigorous secret and personal-data redaction.
* Expect undocumented nulls and missing properties.
* Place endpoint paths and provider quirks in one adapter-specific location so they can be updated quickly.
