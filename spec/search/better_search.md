Mastodon does have streaming for home, public, list, direct, and individual hashtag timelines, but **not for arbitrary full-text search queries**. Hashtag streaming also requires an authenticated user token on modern Mastodon, so it does not justify a general “live search” feature here. ([Mastodon Documentation][1])

Here is the compact specification.

# Mawkingbird Search Specification

## 1. Purpose

Mawkingbird Search provides a compact, single-column interface for finding:

* accounts;
* hashtags;
* posts.

The feature must operate entirely in the browser, without maintaining a local post index or downloading large collections of statuses.

The design prioritizes:

1. predictable API usage;
2. one-request searches where possible;
3. a strict user-selectable API-call budget;
4. clear distinction between server-side search and filtering of loaded results;
5. saved and shareable structured searches;
6. graceful anonymous operation.

Mastodon full-text status search depends on server configuration and requires authentication. Accounts and hashtags remain searchable without authenticated full-text post search. ([Mastodon Documentation][2])

---

## 2. Non-goals

The initial search feature will not provide:

* a local post database or search index;
* arbitrary Boolean DSL parsing;
* multi-author fan-out searches;
* multi-language fan-out searches;
* searches across every followed account;
* searches across favourites, bookmarks, lists, or timelines by scanning them;
* TweetDeck-style search columns;
* live arbitrary keyword searches;
* polling for new matching results;
* autocomplete that calls Mastodon on every keystroke;
* complete or authoritative facet counts;
* claims of searching the whole Fediverse.

A resource may only appear as a search scope when Mastodon provides an API that directly searches or appropriately filters that resource. Mawkingbird must not simulate search by walking thousands of timeline records.

---

## 3. Existing compact layout

The primary interface remains one column:

```text
┌─────────────────────────────────────┐
│ Search text                         │
├─────────────────────────────────────┤
│ Accounts | Hashtags | Posts         │
├─────────────────────────────────────┤
│ Date control, when applicable       │
├─────────────────────────────────────┤
│ Advanced search                     │
├─────────────────────────────────────┤
│ Search                              │
├─────────────────────────────────────┤
│ Active filters                      │
├─────────────────────────────────────┤
│ Result controls                     │
├─────────────────────────────────────┤
│ Results                             │
└─────────────────────────────────────┘
```

The advanced form expands inline beneath the primary controls. It does not open a separate page or wide query-builder workspace.

---

## 4. Search modes

### 4.1 Accounts

Account search uses Mastodon’s account-capable search APIs.

Searchable input may include:

* username;
* display name;
* full handle;
* account URL.

Account search does not attempt to search profile biography text unless the connected server already includes that behavior.

Supported advanced filters are primarily applied to loaded results:

* local or remote account;
* bot or human;
* locked or unlocked;
* active or suspended, where exposed;
* account domain;
* followed or not followed, when relationship data is already available.

The dedicated account-search endpoint requires authentication. General `/api/v2/search` can return account matches and may be used where public access is available. ([Mastodon Documentation][2])

### 4.2 Hashtags

Hashtag search finds matching hashtag names.

Input normalization may:

* remove a leading `#`;
* trim whitespace;
* preserve Unicode;
* reject an empty tag.

Hashtag search does not fetch every post for every matching tag. Selecting a hashtag may open its timeline as a separate action.

### 4.3 Posts: authenticated

Authenticated post search uses:

```text
GET /api/v2/search
type=statuses
q=<generated Mastodon query>
```

The server must support full-text search for useful keyword results. Availability and completeness depend on the instance’s search configuration and the content known to that server. ([Mastodon Documentation][2])

### 4.4 Posts: anonymous

Anonymous Mastodon full-text status search is unavailable. ([Mastodon Documentation][2])

In anonymous mode, Mawkingbird interprets search words as hashtags and uses hashtag timelines.

Example:

```text
cats dogs
```

becomes a hashtag-oriented search equivalent to:

```text
#cats #dogs
```

The UI must explain this transformation:

> Anonymous post search uses hashtags because Mastodon does not provide anonymous full-text post search.

Rules:

* Leading `#` characters are optional.
* Punctuation surrounding words is removed where safe.
* Quoted phrases are not treated as full-text phrases.
* Stop words may be retained rather than silently changing intent.
* The transformed hashtags are displayed before the request is sent.
* Users may switch explicitly to Hashtag mode to avoid ambiguity.

Mastodon exposes public and hashtag timelines, although individual servers may restrict timeline access. ([Mastodon Documentation][3])

---

## 5. Structured search data

The form uses a rich TypeScript object as its source of truth.

It does not parse arbitrary DSL back into widgets.

```ts
type SearchTarget = "accounts" | "hashtags" | "posts";

type ApiCallBudget = 1 | 3 | 5 | 10;

type ResultGrouping = "none" | "author" | "date";

type AccountLocation = "any" | "local" | "remote";

type PostContentType =
  | "any"
  | "media"
  | "image"
  | "video"
  | "audio"
  | "poll"
  | "link"
  | "text";

interface SearchDateBounds {
  after?: string;  // YYYY-MM-DD
  before?: string; // YYYY-MM-DD
}

interface SearchTextCriteria {
  words?: string;
  exactPhrase?: string;
  excludeWords?: string;
}

interface PostSearchCriteria extends SearchTextCriteria {
  author?: string;
  dates?: SearchDateBounds;
  language?: string;

  contentType?: PostContentType;

  replies?: "include" | "only" | "exclude";
  sensitive?: "include" | "only" | "exclude";

  scope?: "all" | "public" | "library";
}

interface AccountSearchCriteria {
  text: string;
  location?: AccountLocation;
  bot?: "include" | "only" | "exclude";
  locked?: "include" | "only" | "exclude";
  domain?: string;
}

interface HashtagSearchCriteria {
  text: string;
}

interface SearchPresentation {
  grouping: ResultGrouping;
  loadedResultFilter?: string;
}

interface MawkingbirdSearch {
  version: 1;
  target: SearchTarget;

  account?: AccountSearchCriteria;
  hashtag?: HashtagSearchCriteria;
  post?: PostSearchCriteria;

  apiCallBudget: ApiCallBudget;
  presentation: SearchPresentation;
}
```

This object supports:

* form editing;
* validation;
* URL serialization;
* saved searches;
* generation of Mastodon query syntax;
* execution planning;
* result filtering;
* future schema migration.

---

## 6. Advanced-search form

Advanced search is a set of ordinary form widgets. It is not a free-form Boolean query language.

Fields appear only when relevant to the selected result type.

### 6.1 Post text fields

```text
All of these words
[                                      ]

Exact phrase
[                                      ]

Exclude these words
[                                      ]
```

Generated Mastodon query example:

```text
+angular +signals "change detection" -react
```

The UI may show the generated query but does not accept it as the canonical saved representation.

### 6.2 Author

```text
Posted by
[ @account@server.example              ]
```

Only one author is supported per search.

There is no multiple-author mode because that would require separate requests and merging.

No remote autocomplete request is made while typing. Validation occurs when:

* the field loses focus;
* the user submits;
* the user explicitly presses a lookup button.

A previously loaded or locally remembered account may be suggested without an API call.

### 6.3 Date bounds

```text
Posted after
[ YYYY-MM-DD ]

Posted before
[ YYYY-MM-DD ]
```

Convenience presets may include:

* today;
* past seven days;
* past thirty days;
* this month;
* custom.

Authenticated full-text post search serializes supported date bounds into the generated Mastodon query.

Anonymous hashtag searches treat date bounds as result-processing instructions:

* discard loaded posts outside the selected dates;
* stop pagination once results are older than the lower bound;
* never exceed the API-call budget;
* do not claim that all matching posts within the period were found.

### 6.4 Language

```text
Language
[ Any language                    ▾ ]
```

Only one language may be selected.

The control does not support selecting multiple languages because native multi-language OR behavior would require multiple searches.

The language list is bundled with Mawkingbird and does not require API calls.

### 6.5 Content type

```text
Content
(•) Any
( ) Has media
( ) Image
( ) Video
( ) Audio
( ) Poll
( ) Link or preview
( ) Text only
```

`Has media`, `has poll`, and link/embed criteria may be sent as native search operators where supported.

More specific distinctions such as image versus video are applied to the loaded result set.

The UI must identify post-filters in explanatory text, but they may use the same visual controls as server-side refinements.

### 6.6 Replies

```text
Replies
[ Include replies                 ▾ ]
```

Options:

* include replies;
* replies only;
* exclude replies.

Use native query syntax where available.

### 6.7 Sensitive posts

```text
Sensitive posts
[ Include                         ▾ ]
```

Options:

* include;
* sensitive only;
* exclude sensitive.

Use native query syntax where available.

### 6.8 Search scope

Authenticated post search may expose:

```text
Search in
[ Public and my library           ▾ ]
```

Options:

* public and library;
* public;
* library.

Do not expose pseudo-scopes such as bookmarks, favourites, lists, or home timeline unless Mastodon later provides a direct searchable endpoint for them.

### 6.9 Account filters

Account advanced search may include:

```text
Location       [ Any / Local / Remote ]
Account type   [ Include / Bots only / Exclude bots ]
Locked         [ Include / Locked only / Exclude locked ]
Domain         [                         ]
```

These are filters over loaded account results unless a selected API parameter provides the filter directly.

### 6.10 Hashtag filters

Hashtag advanced search remains minimal:

```text
Hashtag name contains
[                                      ]
```

Post lookup by hashtag is a separate post-search execution mode rather than a complex hashtag search form.

---

## 7. API-call budget

Every search has an explicit maximum request count.

```text
API calls
[ 3 — Balanced                     ▾ ]
```

Options:

| Budget | Label    | Behavior                                        |
| -----: | -------- | ----------------------------------------------- |
|      1 | Minimal  | One result page only                            |
|      3 | Balanced | Initial request plus up to two additional pages |
|      5 | Thorough | Up to five total requests                       |
|     10 | Maximum  | Hard product maximum                            |

The default is **3 calls**.

The budget includes all requests needed to execute the submitted search, including:

* the primary search;
* additional result pages;
* explicit author resolution;
* hashtag timeline pages;
* relationship lookups performed solely for the search.

The budget does not include data already present in memory.

Mawkingbird must never silently exceed the selected budget.

### 7.1 Execution status

After execution, show:

```text
3 of 3 API calls used
80 posts loaded
18 posts shown after filters
```

When fewer requests are needed:

```text
1 of up to 3 API calls used
```

### 7.2 Budget planning

Before submission, Mawkingbird calculates an execution plan:

```ts
interface SearchExecutionPlan {
  endpoint: string;
  generatedQuery?: string;

  maximumCalls: number;
  expectedInitialCalls: number;

  nativeCriteria: string[];
  loadedResultFilters: string[];

  warnings: string[];
}
```

The plan rejects designs requiring unbounded fan-out.

Examples of prohibited plans:

* one request per followed account;
* one request per selected language;
* one request per author in a large list;
* scanning an entire home timeline;
* fetching all bookmarks to simulate search.

---

## 8. Query generation

Advanced post-search widgets generate the Mastodon query sent to the server.

Example structured search:

```ts
{
  words: "angular signals",
  exactPhrase: "change detection",
  excludeWords: "react",
  author: "@alice@example.social",
  dates: {
    after: "2026-07-01"
  },
  language: "en",
  contentType: "media",
  replies: "exclude",
  scope: "public"
}
```

Example generated query:

```text
+angular +signals "change detection" -react
from:@alice@example.social
after:2026-07-01
language:en
has:media
-is:reply
in:public
```

The exact serialization must be implemented in one dedicated service:

```ts
interface MastodonQuerySerializer {
  serialize(criteria: PostSearchCriteria): string;
}
```

The serializer must:

* escape quoted values safely;
* normalize whitespace;
* omit empty conditions;
* produce deterministic output;
* preserve no UI state outside the rich search object;
* be unit-tested against representative combinations.

There is no corresponding arbitrary query parser.

---

## 9. Explain search

Each executed search has an expandable **Explain** section.

Example:

```text
Explain this search

Endpoint
GET /api/v2/search

Mastodon query
+angular "change detection" -react after:2026-07-01

Server-side criteria
• Contains angular
• Contains exact phrase “change detection”
• Excludes react
• Posted after July 1, 2026

Filters applied to loaded results
• Image posts only

API usage
• Maximum: 3 calls
• Used: 2 calls
```

For anonymous post search:

```text
Anonymous transformation
“cats dogs” was searched as hashtags #cats and #dogs.

Mastodon does not provide anonymous full-text post search.
```

The explanation should distinguish:

* Mastodon query criteria;
* API endpoint parameters;
* loaded-result filters;
* anonymous-mode transformations;
* truncated searches caused by the API-call budget.

---

## 10. Active filter chips

Every non-default search condition appears as a removable chip above the results.

Example:

```text
[ angular ]
[ Exact: change detection × ]
[ After Jul 1 × ]
[ English × ]
[ Images only × ]
[ Exclude replies × ]
```

Removing a chip updates the structured search object.

The UI then offers:

```text
[Run updated search]
```

Removing a loaded-result filter may update the results immediately without another API call.

Removing or modifying a server-side criterion requires a new search.

Chips should visually distinguish these cases through hover text or a small status icon, rather than using two entirely different UI systems.

---

## 11. Facets

Facets are derived only from currently loaded results.

They are not counts over the server’s complete search corpus.

Display a clear heading:

```text
Refine loaded results
Based on 80 loaded posts
```

Possible post facets:

* author;
* date;
* language;
* hashtag;
* media type;
* reply or original;
* sensitive or not sensitive;
* link domain;
* local or remote author domain.

Example:

```text
Language
[ ] English  48
[ ] German    9
[ ] French    4
```

The counts mean:

> Number of currently loaded results matching this value.

They must never be presented as total Mastodon search-result counts.

### 11.1 Facet behavior

Selecting a facet normally filters the loaded results immediately.

It does not automatically spend another API call.

The user may choose:

```text
[Apply to new search]
```

when the selected facet maps cleanly to a server-side query condition.

Examples:

* language facet → native language search criterion;
* author facet → native author criterion;
* media facet → native `has:media` where appropriate;
* image facet → remains a loaded-result filter.

### 11.2 Facet limits

To keep the UI compact:

* show at most five values per facet initially;
* provide “Show more” only from already loaded data;
* omit facets with no useful variation;
* place facets in a collapsible section below the active chips;
* never make an API call solely to populate a facet.

---

## 12. Filter loaded results

A secondary text field filters only the results already in memory:

```text
Filter these results
[ solar                                ]
```

This field:

* performs no API calls;
* updates on each keystroke;
* searches rendered plain text;
* may include content warning text;
* may optionally include account name, handle, hashtags, and link domains;
* does not modify the Mastodon query;
* is stored as presentation state rather than server-search criteria.

Show the impact:

```text
Showing 12 of 80 loaded posts
```

A clear button restores all loaded results.

---

## 13. Result grouping

Post results may be grouped by:

```text
Group by
[ None | Author | Date ]
```

### 13.1 None

Preserve the order returned by Mastodon.

Search responses may be relevance-sorted rather than strictly chronological. ([Mastodon Documentation][4])

### 13.2 Author

Group loaded posts under account headers.

Within each author group, preserve returned order unless the user explicitly selects chronological sorting.

### 13.3 Date

Group loaded posts by local calendar date:

```text
Today
Yesterday
July 18, 2026
Earlier
```

Grouping does not change the query or trigger API calls.

Account results and hashtag results do not initially require grouping.

---

## 14. Pagination and additional results

The first request executes immediately.

Additional pages are loaded in one of two ways:

### Manual mode

```text
[Load more]
2 API calls remaining
```

This is the default.

### Budget-fill mode

Optional setting:

```text
Use full API-call budget automatically
[ ]
```

When enabled, Mawkingbird requests pages until:

* the selected budget is exhausted;
* the endpoint reports no more results;
* an anonymous date search has reached posts older than the lower date bound;
* enough visible results have been found;
* the user cancels the request.

Automatic fetching must not be enabled by default.

---

## 15. Saving searches

A saved search stores the rich search object, not just generated DSL.

```ts
interface SavedSearch {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;

  instance: string;
  authenticated: boolean;

  search: MawkingbirdSearch;
}
```

Saved searches are stored in local browser storage.

Because storage is limited and already shared with other Mawkingbird features:

* store definitions only;
* do not store complete search results;
* do not store post bodies;
* do not store facet caches;
* place a reasonable cap on saved searches, such as 100;
* expose delete and export operations.

Saving flow:

```text
[Save search]

Name
[ Angular performance               ]

[Cancel] [Save]
```

Saved-search actions:

* run;
* edit;
* rename;
* duplicate;
* delete;
* copy shareable link.

If a saved authenticated search is opened anonymously, Mawkingbird must explain which criteria are unavailable rather than silently substituting an unrelated search.

---

## 16. Shareable URLs

The complete structured search may be encoded into the URL.

Preferred format:

```text
/search?type=posts&q=angular&after=2026-07-01&media=image&calls=3
```

For more complicated state, use a compact versioned encoding:

```text
/search?s=<encoded-versioned-json>
```

Requirements:

* URLs must not contain OAuth tokens;
* URLs must not contain private cached result data;
* URLs must not contain Mastodon numeric account IDs when a portable handle can be used;
* decoding must validate all fields;
* unknown fields must be ignored safely;
* a schema version must be included;
* malformed URLs must fall back to a safe empty search form.

A shareable URL represents the query definition, not a guarantee that another instance will return the same results.

---

## 17. Anonymous search behavior

Anonymous mode must remain useful but explicitly limited.

### Accounts

Perform public account search where supported.

### Hashtags

Perform public hashtag search where supported.

### Posts

Transform input into hashtags and retrieve hashtag timelines.

For one term:

```text
cats
```

Search:

```text
#cats
```

For several terms:

```text
cats dogs
```

The execution planner may use Mastodon’s hashtag timeline filtering when the connected server supports the required combination. Otherwise, it may:

* select the first hashtag as the timeline;
* apply remaining hashtags as supported timeline parameters;
* or filter loaded results locally.

It must not issue one separate timeline request for every word.

The hashtag timeline API supports combinations of additional `any`, `all`, and `none` tags, subject to server limits. ([Mastodon Documentation][3])

Example explanation:

```text
Timeline hashtag
#cats

Additional required hashtag
#dogs

Maximum requests
3
```

If the anonymous input cannot be converted into valid hashtags, show:

> Anonymous post search requires one or more hashtag-compatible words. Sign in for full-text post search.

---

## 18. Autocomplete policy

Mawkingbird does not perform remote autocomplete on every keystroke.

Allowed zero-request suggestions include:

* recent searches;
* saved searches;
* recently viewed accounts already in memory;
* previously loaded hashtags;
* bundled search operators;
* bundled language names;
* current user’s account;
* recently used domains.

Optional explicit remote lookup:

```text
Author
[ ali@example.social                ]
[Look up]
```

The lookup button spends one call from the search budget or clearly identifies itself as a separate API call before the search begins.

A debounced remote autocomplete service is outside the initial scope.

---

## 19. Error and limitation states

### Full-text search unavailable

```text
This server does not provide full-text post search for this request.

You can:
• search accounts;
• search hashtags;
• search posts by hashtag;
• try another signed-in Mastodon server.
```

### Authentication required

```text
Full-text post search requires signing in.
Anonymous post searches use hashtags instead.
```

### Budget exhausted

```text
Search stopped after 3 API calls.

80 posts were loaded. Facet counts and filters apply only to those posts.
```

### No visible results after filtering

```text
The server returned 40 posts, but none matched the loaded-result filters.

[Clear filters] [Use one more API call]
```

The second action appears only when the configured maximum has not been reached.

### Server restrictions

Instance configuration may restrict public or hashtag timeline access. Mawkingbird should inspect known instance capabilities where practical and handle authorization failures without repeatedly retrying. ([Mastodon Documentation][5])

---

## 20. Streaming and refresh behavior

Mawkingbird does not provide live arbitrary search.

Mastodon streaming supports particular streams such as home, public, list, and hashtag streams, but it does not expose a stream corresponding to an arbitrary full-text search query. Modern hashtag streaming requires an authenticated user token. ([Mastodon Documentation][1])

Search results therefore update only when the user explicitly selects:

```text
[Run search again]
```

or:

```text
[Refresh]
```

Refresh is one ordinary execution subject to the selected API-call budget.

There is no automatic polling.

---

## 21. Compact one-column wireframe

```text
Search
┌─────────────────────────────────────┐
│ angular signals                     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Posts                           ▾   │
└─────────────────────────────────────┘

Posted
┌─────────────────────────────────────┐
│ Any time                        ▾   │
└─────────────────────────────────────┘

▸ Advanced search

API calls
┌─────────────────────────────────────┐
│ 3 — Balanced                    ▾   │
└─────────────────────────────────────┘

[ Search ]

───────────────────────────────────────

[angular] [English ×] [Images only ×]

Filter these results
┌─────────────────────────────────────┐
│                                     │
└─────────────────────────────────────┘

Group by
[ None ] [ Author ] [ Date ]

▸ Refine loaded results
  Based on 80 loaded posts

▸ Explain this search

Showing 24 of 80 loaded posts
2 of up to 3 API calls used

┌─────────────────────────────────────┐
│ Result                              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Result                              │
└─────────────────────────────────────┘

[ Load more — 1 call remaining ]

[ Save search ] [ Share ]
```

---

## 22. Recommended MVP

### Required

* account, hashtag, and post modes;
* authenticated full-text post search;
* anonymous hashtag-based post search;
* rich TypeScript search object;
* generated Mastodon query;
* text criteria;
* one author;
* date bounds;
* one language;
* media, poll, reply, and sensitive controls;
* public/library scope where supported;
* explicit 1, 3, 5, or 10-call budget;
* manual pagination;
* active filter chips;
* loaded-result text filter;
* loaded-result facets;
* author and date grouping;
* explain panel;
* saved search definitions;
* shareable URLs;
* no polling or arbitrary search streaming;
* no remote keyup autocomplete.

### Optional after MVP

* explicit author lookup button;
* automatic use of the remaining call budget;
* anonymous multi-hashtag timeline combinations;
* saved-search import and export;
* richer account facets;
* link-domain facets;
* search history.

---

## 23. Core product rule

Every search refinement must belong to one of three categories:

1. **Sent to Mastodon**
   The server applies the condition.

2. **Applied to loaded results**
   Mawkingbird filters only the records already returned.

3. **Unsupported**
   The operation would require excessive API calls, timeline scanning, polling, or a local index.

The UI must never present category 2 as though it were category 1, and must never implement category 3 through hidden request fan-out.

One adjustment I strongly recommend: call the selector **“Maximum API calls”**, rather than “How many API calls.” That communicates a ceiling; a simple search can still stop after one request instead of dutifully burning all five.

Note from Matthew Martin - yes Maximum API calls is a better label/name.

[1]: https://docs.joinmastodon.org/methods/streaming/?utm_source=chatgpt.com "streaming API methods"
[2]: https://docs.joinmastodon.org/methods/search/?utm_source=chatgpt.com "search API methods"
[3]: https://docs.joinmastodon.org/methods/timelines/?utm_source=chatgpt.com "timelines API methods"
[4]: https://docs.joinmastodon.org/api/guidelines/?utm_source=chatgpt.com "Guidelines and best practices"
[5]: https://docs.joinmastodon.org/entities/Instance/?utm_source=chatgpt.com "Instance"
