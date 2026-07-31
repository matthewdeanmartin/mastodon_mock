> **Implementation status (2026-07-31).** Sprint one is built: Dub, Short.io and
> T.LY with full CRUD, the `/links` page behind a `links` feature flag (canary),
> the `/find-friends` hub, and the Connections entry. Rebrandly and YOURLS are
> deliberately deferred until these three are proven in real use.
>
> **Where the research below was overridden.** Section 2 assumes
> `Angular → your backend → shortener API`, with credentials held server-side.
> Mawkingbird is a static bundle with no backend, so that shape is unavailable;
> keys live in localStorage under the existing credential-retention policy, the
> same as the OpenRouter, Raindrop and CORS-proxy keys. What survived from that
> section is implemented: destination-scheme validation, normalized error codes
> that never echo a provider body, canonical provider ids persisted alongside the
> full response, and retry-with-backoff restricted to 429/5xx and never applied
> to creates.
>
> **The consequence, and how it is handled.** These APIs are server-to-server and
> largely refuse browser origins, so most users need a CORS proxy — which would
> see the API key. `cors-proxy.ts` refuses credentialed traffic by design and the
> three shortener hosts are on its blocklist; a second, explicit path
> (`proxyCredentialedRequest`) is reachable only after the user accepts a
> disclosure naming the proxy operator, linking its homepage and privacy policy,
> and stating the concrete risk. Consent is recorded per `(shortener, proxy)`
> pair and is revocable. A self-hosted proxy gets the same information without
> the alarm, since the user's own server reading their own key is not a
> disclosure. A connector is never marked connected until a real call succeeds.

## New Page: Find Friends
Central place for links to everywhere in the app where you can find friends in some sense. This page is navigation. It should work like the “About” or “Docs” page
Link to Starter kit
Link to search
Link to import (settings)
Link to send invites
From main “...” menu - Collapse Start Kit/find my fiends into one that goes to the “Find Friends” page

## New Link in “...” called “Links” for link shortening
Show your links from active link shortening service
UI for creating a link with fields available to that provider
List, delete old links using provider APIs

## On Connnections tab - similar to cors (antother multi serverice connector)
Provider pattern for link shorteners
Support key-less/anonymous (3rd party!), may need CORS proxy
Support services that need a key with same key management 
When an provider with a key is active, that one takes precedence
Let’s support multiple shortening services, but only 1 is active at a time.
- Short.io
- Dub.co
- Rebrandly
- Short.io
- Dub.co
- T.LY
- YOURLS


---This is research from another bot who did the googling---

I consolidated the repeated entries into **five unique providers**. The specification below stays at the HTTP layer and assumes calls are made through a trusted backend rather than directly from Angular.

# URL Shortener Provider Integration Specification

**Providers:** Short.io, Dub, Rebrandly, T.LY, YOURLS
**Scope:** Create, update, delete, retrieve, list, and search shortened links
**Last verified:** July 31, 2026

## 1. Shared integration contract

Implement each provider behind a common internal interface:

```ts
interface LinkShortenerProvider {
  createLink(input: CreateLinkInput): Promise<ShortLink>;
  updateLink(id: string, changes: UpdateLinkInput): Promise<ShortLink>;
  deleteLink(id: string): Promise<void>;
  getLink(id: string): Promise<ShortLink>;
  listLinks(query?: LinkQuery): Promise<Page<ShortLink>>;
}
```

Suggested normalized models:

```ts
interface CreateLinkInput {
  destinationUrl: string;
  slug?: string;
  domain?: string;
  title?: string;
  description?: string;
  tags?: string[];
  expiresAt?: string;
  password?: string;
  externalId?: string;
}

interface UpdateLinkInput {
  destinationUrl?: string;
  slug?: string;
  title?: string;
  description?: string;
  tags?: string[];
  expiresAt?: string | null;
  password?: string | null;
  archived?: boolean;
}

interface ShortLink {
  provider: "shortio" | "dub" | "rebrandly" | "tly" | "yourls";
  providerId: string;
  shortUrl: string;
  destinationUrl: string;
  slug?: string;
  domain?: string;
  title?: string;
  description?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  archived?: boolean;
  raw: unknown;
}

interface LinkQuery {
  search?: string;
  destinationUrl?: string;
  domain?: string;
  tag?: string;
  page?: number;
  limit?: number;
  cursor?: string;
}
```

Do not assume that every provider supports every normalized property. Provider adapters should omit unsupported properties rather than simulating them.

## 2. General security requirements

API credentials must never be compiled into or delivered to the Angular application. Calls should follow:

```text
Angular application
    → application backend
    → URL-shortener API
```

The backend should:

* Store credentials in a secret manager or protected environment variables.
* Never include provider credentials in logs, errors, analytics, or client responses.
* Validate destination URLs before forwarding them.
* Permit only `http:` and `https:` destinations unless another scheme is explicitly required.
* Consider rejecting localhost, private-network, metadata-service, and internal hostnames to reduce SSRF and phishing risk.
* Apply application-level authorization so users can modify only links they own.
* Rate-limit create and update operations.
* Record audit events without recording credentials or passwords.
* Treat link passwords as secrets.
* Use HTTPS exclusively.
* Implement retry-with-backoff only for transient failures such as `429` and selected `5xx` responses.
* Avoid automatically retrying non-idempotent creates unless provider-specific duplicate behavior is understood.

Provider identifiers, slugs, and full short URLs are not interchangeable. Persist the provider’s canonical identifier and full returned response.

---

# 3. Short.io

## Base URL and authentication

```http
Base URL: https://api.short.io
Authorization: <SECRET_API_KEY>
Content-Type: application/json
Accept: application/json
```

Short.io expects its secret API key directly in the `Authorization` header rather than using the `Bearer` prefix. Its API also offers a separate public-key endpoint, but privileged link management should use a server-side secret key. ([Short.io][1])

## Create link

```http
POST /links
```

Minimum request:

```json
{
  "originalURL": "https://example.com/article",
  "domain": "go.example.com"
}
```

Commonly useful fields:

| Field          | Meaning                                              |
| -------------- | ---------------------------------------------------- |
| `originalURL`  | Required destination URL                             |
| `domain`       | Short-domain hostname                                |
| `domainId`     | Domain identifier; use where preferred over hostname |
| `path`         | Requested custom slug                                |
| `title`        | Internal link title                                  |
| `tags`         | Link tags, subject to account capabilities           |
| `expiresAt`    | Expiration timestamp, ISO string or milliseconds     |
| `ttl`          | Time-to-live behavior where supported                |
| `password`     | Password protection                                  |
| `cloaking`     | Enable supported cloaking behavior                   |
| `utmSource`    | UTM source                                           |
| `utmMedium`    | UTM medium                                           |
| `utmCampaign`  | UTM campaign                                         |
| `utmTerm`      | UTM term                                             |
| `utmContent`   | UTM content                                          |
| `redirectType` | Redirect behavior, subject to plan/domain settings   |

If `path` is omitted, Short.io generates one according to the domain configuration. Duplicate behavior is significant:

* Same destination and no custom path may return the existing link.
* Existing path with the same destination may return the existing link.
* Existing path with a different destination returns `409 Conflict`.
* A custom unused path can create another link for an already-shortened destination. ([Short.io][1])

Example:

```json
{
  "originalURL": "https://example.com/article",
  "domain": "go.example.com",
  "path": "article",
  "title": "Example article",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

Bulk creation is available:

```http
POST /links/bulk
```

The bulk endpoint accepts up to 1,000 links per request and uses fields similar to the single-link endpoint. ([Short.io][2])

## Retrieve or locate links

Retrieve/list links:

```http
GET /api/links
```

The exact pagination and filtering options should be read from the current OpenAPI description when implementing because Short.io has revised its list endpoint over time. Persist `id`, `path`, `shortURL`, `originalURL`, and domain information from responses. ([Short.io][3])

Locate links by destination URL:

```http
GET /links/multiple-by-url?domain=go.example.com&originalURL=https%3A%2F%2Fexample.com%2Farticle
```

This returns links under the specified domain that share the destination URL. ([Short.io][4])

## Update link

```http
POST /links/{linkId}
```

Example:

```json
{
  "originalURL": "https://example.com/new-article",
  "path": "updated-article",
  "title": "Updated title"
}
```

Supported update properties include the destination URL, title, path, password, cloaking, and other link configuration fields exposed by the account. Short.io uses `POST`, not `PATCH`, for this operation. The endpoint’s documented rate limit is 20 requests per second. ([Short.io][5])

Do not use the short URL itself as `linkId`. Persist the returned Short.io identifier.

## Delete link

```http
DELETE /links/{linkId}
```

The endpoint deletes a link by its Short.io link identifier and has a documented limit of 20 requests per second. ([Short.io][6])

## Search support

Preferred strategies:

1. Use the link-list endpoint for domain, path, title, tag, and pagination filters supported by the current API version.
2. Use `/links/multiple-by-url` for an exact destination lookup.
3. Apply local filtering only after retrieving a bounded page; do not download the entire account for every search.

## Security notes

* Use only a **secret API key** in the backend.
* Do not expose the secret through Short.io’s browser/public API workflow.
* Scope application users to approved Short.io domains.
* Treat cloaking and password protection as optional provider features, not baseline security controls.
* Link expiration does not necessarily delete the link; it can redirect visitors to an expiration page instead. ([Short.io][7])

---

# 4. Dub

## Base URL and authentication

```http
Base URL: https://api.dub.co
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
Accept: application/json
```

Dub is a REST API served exclusively over HTTPS. API tokens operate in the context of an authenticated workspace. ([Dub][8])

## Create link

```http
POST /links
```

Minimum request:

```json
{
  "url": "https://example.com/article"
}
```

Commonly useful fields:

| Field             | Meaning                              |
| ----------------- | ------------------------------------ |
| `url`             | Required destination URL             |
| `domain`          | Short-link domain                    |
| `key`             | Custom slug                          |
| `keyLength`       | Generated-slug length                |
| `prefix`          | Prefix for generated keys            |
| `title`           | Internal title                       |
| `description`     | Internal description                 |
| `externalId`      | ID from the integrating application  |
| `tenantId`        | Integrator-defined tenant ID         |
| `tagIds`          | Associated Dub tag IDs               |
| `comments`        | Internal comments                    |
| `expiresAt`       | Expiration timestamp                 |
| `expiredUrl`      | Destination after expiration         |
| `password`        | Link password                        |
| `archived`        | Initial archive state                |
| `trackConversion` | Enable conversion tracking           |
| `rewrite`         | Provider-specific rewriting behavior |
| `doIndex`         | Search-indexing preference           |
| `proxy`           | Proxy/cloaking-style behavior        |
| `geo`             | Geographic destination rules         |
| `device`          | Device destination rules             |
| `ios`             | iOS destination                      |
| `android`         | Android destination                  |

Example:

```json
{
  "url": "https://example.com/article",
  "domain": "go.example.com",
  "key": "article",
  "title": "Example article",
  "externalId": "link_48392",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

`externalId` is especially useful for idempotency and cross-system lookup. It must be unique in the Dub workspace. When using it in identifier parameters, prefix it with `ext_`. ([Dub][9])

## Retrieve one link

```http
GET /links/info?linkId={linkId}
```

Depending on the current endpoint version, a domain/key or external identifier may also be accepted. Use the canonical link ID returned by creation where possible.

## List and search links

```http
GET /links
```

Useful query parameters include, depending on API version:

| Parameter      | Purpose                              |
| -------------- | ------------------------------------ |
| `search`       | Text search                          |
| `domain`       | Filter by domain                     |
| `tagIds`       | Filter by tag IDs                    |
| `tenantId`     | Filter by integrator tenant          |
| `externalId`   | Locate an externally identified link |
| `userId`       | Creator/owner filter                 |
| `showArchived` | Include archived links               |
| `sort`         | Sort field                           |
| `page`         | Page number                          |
| `pageSize`     | Page size                            |

The endpoint returns a paginated list for the authenticated workspace. ([Dub][10])

## Update link

```http
PATCH /links/{linkId}
```

Example:

```json
{
  "url": "https://example.com/new-article",
  "title": "Updated article",
  "archived": false,
  "expiresAt": "2027-01-31T23:59:59Z"
}
```

Use a partial body containing only changed fields. Most create-time configuration fields can also be updated, including destination, domain/key where permitted, title, description, expiration, password, targeting, tags, indexing, conversion, and archive state.

Dub also exposes:

```http
PUT /links
```

for upsert behavior. Prefer explicit create/update operations unless the integration intentionally relies on upsert semantics. Dub’s current API surface includes create, update, upsert, delete, retrieve, list, count, and bulk operations. ([Dub Docs][11])

## Delete link

```http
DELETE /links/{linkId}
```

`linkId` may be:

* The Dub link ID; or
* An external ID prefixed with `ext_`.

A successful response contains the deleted link ID. ([Dub][12])

## Security notes

* Keep Bearer tokens server-side.
* Use separate tokens/workspaces for development, staging, and production.
* Prefer `externalId` for deterministic ownership mapping.
* Validate that retrieved links belong to the expected workspace and application tenant.
* Do not treat `tenantId` as an authorization mechanism by itself; enforce authorization in the integrating backend.
* Password protection, proxying, indexing controls, and expiration are optional link behaviors, not substitutes for protecting confidential content.

---

# 5. Rebrandly

## Base URL and authentication

```http
Base URL: https://api.rebrandly.com
apikey: <API_KEY>
Content-Type: application/json
Accept: application/json
```

For links belonging to a Rebrandly workspace, include:

```http
workspace: <WORKSPACE_ID>
```

The `apikey` and `workspace` values are HTTP headers. Do not use `Authorization: Bearer` unless Rebrandly documents a different authentication flow for the particular account/application.

## Create link

```http
POST /v1/links
```

Minimum request:

```json
{
  "destination": "https://example.com/article"
}
```

Commonly useful fields:

| Field               | Meaning                             |
| ------------------- | ----------------------------------- |
| `destination`       | Required destination URL            |
| `slashtag`          | Requested custom slug               |
| `domain.id`         | Rebrandly domain ID                 |
| `domain.fullName`   | Domain hostname                     |
| `title`             | Internal title                      |
| `description`       | Internal description, where enabled |
| `tags`              | Tag references where accepted       |
| `favorite`          | Mark as favorite                    |
| `forwardParameters` | Forward incoming query parameters   |

Example:

```json
{
  "destination": "https://example.com/article",
  "slashtag": "article",
  "domain": {
    "fullName": "go.example.com"
  },
  "title": "Example article"
}
```

The domain can be identified using its `id`, `fullName`, or both, but it must be active, verified, and available to the selected workspace. If `slashtag` is omitted, Rebrandly generates one. ([Rebrandly for Developers][13])

Do not assume a default branded domain exists for a workspace. Explicitly configuring the domain is safer.

## Retrieve one link

```http
GET /v1/links/{id}
```

## List and search links

```http
GET /v1/links
```

Common query parameters include:

| Parameter    | Purpose                  |
| ------------ | ------------------------ |
| `limit`      | Page size                |
| `last`       | Pagination marker        |
| `orderBy`    | Sort property            |
| `orderDir`   | `asc` or `desc`          |
| `domain.id`  | Filter by branded domain |
| `slashtag`   | Filter by slug           |
| `creator.id` | Filter by creator        |
| `favorite`   | Filter favorite status   |

Include the `workspace` header when operating inside a workspace.

Rebrandly’s collection is private to the account/workspace, and list operations are the normal way to resolve a link ID before modification or deletion. ([Rebrandly for Developers][14])

Search behavior is more filter-oriented than full-text-oriented. For broader text search, retrieve bounded pages and filter locally, or maintain a local index keyed by Rebrandly ID, destination, title, domain, and slashtag.

## Update link

```http
POST /v1/links/{id}
```

Example:

```json
{
  "destination": "https://example.com/new-article",
  "title": "Updated article"
}
```

Rebrandly uses `POST` for link updates. Update only documented mutable fields. Typical mutable properties include destination, title, slashtag, domain reference, favorite state, and parameter-forwarding behavior, although domain/slashtag changes can be restricted by account state or collision rules.

## Delete link

```http
DELETE /v1/links/{id}
```

Example headers:

```http
apikey: <API_KEY>
workspace: <WORKSPACE_ID>
```

Deletion immediately stops the branded short link from redirecting. If the ID is not known, obtain it through the list endpoint first. ([Rebrandly for Developers][15])

## Security notes

* Keep both the API key and workspace ID server-side.
* Always send the intended workspace explicitly in multi-workspace deployments.
* Confirm that the link returned by an ID belongs to the expected workspace before updating or deleting it.
* Rebrandly deletion is destructive; moving a link between workspaces may require delete-and-recreate, which loses statistics and associated information. ([Rebrandly for Developers][16])
* Do not expose branded-domain administration through the same application role used only to create links.

---

# 6. T.LY

## Base URL and authentication

```http
Base URL: https://api.t.ly
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
Accept: application/json
```

The current documentation was updated March 18, 2026 and exposes creation, listing, retrieval, updating, deletion, bulk operations, tags, QR codes, and statistics. ([T.ly][17])

## Create link

```http
POST /api/v1/link/shorten
```

Minimum request:

```json
{
  "long_url": "https://example.com/article"
}
```

Useful fields:

| Field                | Meaning                                          |
| -------------------- | ------------------------------------------------ |
| `long_url`           | Required destination URL                         |
| `short_id`           | Requested slug/back half                         |
| `domain`             | Requested short domain where supported           |
| `description`        | Internal description                             |
| `password`           | Password protection                              |
| `expire_at_time`     | Expiration time                                  |
| `expire_at_datetime` | Expiration date/time                             |
| `public_stats`       | Allow public statistics                          |
| `include_qr_code`    | Include QR code information                      |
| `format`             | `json` or `text`                                 |
| `tags`               | Tag IDs                                          |
| `pixels`             | Tracking-pixel IDs                               |
| `meta`               | Expiration, Smart URL, or rotation configuration |

Example:

```json
{
  "long_url": "https://example.com/article",
  "short_id": "article",
  "description": "Example article",
  "expire_at_datetime": "2026-12-31 23:59:59",
  "public_stats": false,
  "include_qr_code": false,
  "format": "json"
}
```

T.LY’s documented create operation requires Bearer authentication. The response should be treated as authoritative for the final short URL and identifier. ([T.ly][17])

## Retrieve one link

```http
GET /api/v1/link?short_url=https%3A%2F%2Ft.ly%2Fabc123
```

The link is identified by its complete `short_url`, not a separate path ID. ([T.ly][17])

## List and search links

Use the documented list operation under ShortLink Management. Its filter body/query supports:

| Field        | Purpose                                |
| ------------ | -------------------------------------- |
| `search`     | Text search                            |
| `tag_ids`    | Up to 10 tag IDs                       |
| `pixel_ids`  | Up to 10 pixel IDs                     |
| `start_date` | Created/date-range start               |
| `end_date`   | Created/date-range end                 |
| `domains`    | Up to 10 domains                       |
| `user_ids`   | Up to 10 users                         |
| `limit`      | Result count, documented maximum 5,000 |
| `page`       | One-based page                         |

Keep list requests reasonably sized even though the documented upper limit is large. ([T.ly][17])

## Update link

```http
PUT /api/v1/link
```

Example:

```json
{
  "short_url": "https://t.ly/abc123",
  "long_url": "https://example.com/new-article",
  "short_id": "new-article",
  "description": "Updated article",
  "password": "",
  "tags": [12, 18]
}
```

Supported fields include:

* `short_url` — required identifier.
* `long_url`
* `short_id`
* `description`
* `expire_at_time`
* `expire_at_datetime`
* `password`
* `tags`
* Provider-specific `meta` configuration.

Smart URLs and rotation URLs are mutually exclusive; sending both results in a `422` response. ([T.ly][17])

Bulk update is also available:

```http
POST /api/v1/link/bulk/update
```

## Delete link

```http
DELETE /api/v1/link
```

Body:

```json
{
  "short_url": "https://t.ly/abc123"
}
```

T.LY identifies the deleted object by its complete short URL supplied in the JSON body. ([T.ly][17])

## Security notes

* Bearer tokens must remain server-side.
* Keep `public_stats` disabled unless explicitly requested.
* Do not return link passwords to the browser after creation.
* Tracking pixels and rotation rules can have privacy and compliance implications; expose them only through appropriately authorized application features.
* Validate `short_url` against the configured T.LY/custom domains before update or deletion to avoid cross-account mistakes.
* Since `DELETE` carries a JSON body, ensure the chosen HTTP stack and any proxies preserve DELETE request bodies.

---

# 7. YOURLS

YOURLS is self-hosted and materially different from the hosted providers. The stock API is action-based rather than a complete CRUD REST API.

## Base URL

```http
https://short.example.com/yourls-api.php
```

Requests may use `GET` or form-encoded `POST`.

Preferred:

```http
Content-Type: application/x-www-form-urlencoded
Accept: application/json
```

## Authentication

YOURLS supports credentials such as:

```text
username=<username>
password=<password>
```

It also supports signature-token authentication, which is preferable to repeatedly transmitting the YOURLS account password.

Example:

```text
signature=<signature-token>
```

Use HTTPS in either case. Keep the username/password or signature on the backend.

## Create link

```http
POST /yourls-api.php
Content-Type: application/x-www-form-urlencoded
```

Body:

```text
signature=<signature>
&action=shorturl
&format=json
&url=https%3A%2F%2Fexample.com%2Farticle
&keyword=article
&title=Example%20article
```

Supported stock fields:

| Field             | Meaning                             |
| ----------------- | ----------------------------------- |
| `action=shorturl` | Create/shorten operation            |
| `url`             | Required destination URL            |
| `keyword`         | Optional custom slug                |
| `title`           | Optional title                      |
| `format`          | `json`, `jsonp`, `xml`, or `simple` |

The stock API’s registered actions are `shorturl`, `stats`, `db-stats`, `url-stats`, `expand`, and `version`. ([GitHub][18])

## Retrieve or expand one link

Expand a keyword or full short URL:

```http
POST /yourls-api.php
```

```text
signature=<signature>
&action=expand
&format=json
&shorturl=article
```

Retrieve statistics and metadata:

```text
signature=<signature>
&action=url-stats
&format=json
&shorturl=article
```

## List links

```http
POST /yourls-api.php
```

```text
signature=<signature>
&action=stats
&format=json
&filter=last
&limit=100
```

Stock filters:

* `top`
* `bottom`
* `rand`
* `last`

The stock API does not provide a general text-search endpoint. ([GitHub][19])

Options for search:

1. Retrieve a bounded stats list and filter in the application.
2. Maintain a separate search index when links are created.
3. Install or write a YOURLS plugin that registers a custom API action.
4. Build a protected server-side integration around YOURLS’s PHP functions/database, accepting the maintenance cost.

## Update link

**Not supported by the stock public API.**

Although the YOURLS application contains internal functions for editing links, `yourls-api.php` does not register an edit action by default. ([GitHub][18])

Implementation choices:

* Mark update as unsupported.
* Install a maintained plugin that adds an authenticated API action.
* Write a private YOURLS plugin exposing an `update-link` action.
* Delete/recreate through a custom endpoint, acknowledging that this can alter metadata and statistics.

Do not directly update YOURLS database tables from the Angular application or a generic integration service.

## Delete link

**Not supported by the stock public API.**

A custom plugin is required for programmatic deletion through the API.

Recommended custom action shape:

```http
POST /yourls-api.php
```

```text
signature=<signature>
&action=delete-link
&format=json
&keyword=article
```

The plugin should:

1. Require normal YOURLS API authentication.
2. Validate the keyword.
3. Confirm the link exists.
4. Call YOURLS’s internal deletion function rather than issuing raw SQL.
5. Return a stable JSON response and appropriate HTTP status.
6. Register an audit event.
7. Avoid exposing the action when the installation is configured as public.

## Security notes

YOURLS security is the operator’s responsibility:

* Keep the installation private unless public shortening is intentional.
* Use HTTPS.
* Prefer signature authentication over sending the account password.
* Rotate credentials and database credentials.
* Keep YOURLS and all plugins current.
* Remove unused or untrusted plugins.
* Add rate limiting at the web server, reverse proxy, or application layer.
* Restrict `/admin` and `yourls-api.php` by network or identity-aware proxy where practical.
* Back up both the database and configuration.
* Review server configuration so uploaded or disguised files cannot execute as PHP.
* Treat every custom plugin as privileged server code.

The YOURLS project explicitly warns that public shortening and public API access invite abuse and recommends current software, strong credentials, minimal plugins, and hosting hardening. ([YOURLS][20])

YOURLS is free, open source, self-hosted, and provides full control over link data, but that control includes responsibility for availability, abuse prevention, patching, backups, and monitoring. ([GitHub][21])

---

# 8. Capability matrix

| Capability                      |             Short.io |                          Dub |              Rebrandly |               T.LY |        YOURLS stock |
| ------------------------------- | -------------------: | ---------------------------: | ---------------------: | -----------------: | ------------------: |
| Create                          |                  Yes |                          Yes |                    Yes |                Yes |                 Yes |
| Custom slug                     |                  Yes |                          Yes |                    Yes |                Yes |                 Yes |
| Custom domain                   |                  Yes |                          Yes |                    Yes | Yes/plan-dependent | Installation domain |
| Update destination              |                  Yes |                          Yes |                    Yes |                Yes |                  No |
| Update slug                     |                  Yes |                          Yes |          Generally yes |                Yes |                  No |
| Delete                          |                  Yes |                          Yes |                    Yes |                Yes |                  No |
| Retrieve one                    |                  Yes |                          Yes |                    Yes |                Yes |        Expand/stats |
| Paginated list                  |                  Yes |                          Yes |                    Yes |                Yes |  Limited stats list |
| Text search                     | Limited/filter-based |                          Yes |   Limited/filter-based |                Yes |                  No |
| Tags                            |                  Yes |                          Yes |                    Yes |                Yes |       Plugin/custom |
| Expiration                      |                  Yes |                          Yes | Plan/feature-dependent |                Yes |       Plugin/custom |
| Password                        |                  Yes |                          Yes |      Feature-dependent |                Yes |       Plugin/custom |
| Bulk operations                 |                  Yes |                          Yes |          API-dependent |                Yes |       Plugin/custom |
| Server-side credential required |                  Yes |                          Yes |                    Yes |                Yes |                 Yes |
| Self-hosted                     |                   No | Optional/open-source options |                     No |                 No |                 Yes |

---

# 9. Error handling

Normalize provider errors:

```ts
type LinkProviderErrorCode =
  | "AUTHENTICATION_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SLUG_CONFLICT"
  | "INVALID_DESTINATION"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "PLAN_LIMIT"
  | "UNSUPPORTED_OPERATION"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";
```

Suggested mapping:

| HTTP status | Internal code               |
| ----------- | --------------------------- |
| `400`       | `VALIDATION_FAILED`         |
| `401`       | `AUTHENTICATION_FAILED`     |
| `403`       | `FORBIDDEN` or `PLAN_LIMIT` |
| `404`       | `NOT_FOUND`                 |
| `409`       | `SLUG_CONFLICT`             |
| `422`       | `VALIDATION_FAILED`         |
| `429`       | `RATE_LIMITED`              |
| `500–599`   | `PROVIDER_UNAVAILABLE`      |

Preserve the provider request ID, status, and sanitized response body for diagnostics. Do not expose raw provider errors to end users when they may include account, workspace, or credential information.

## Idempotency

* **Dub:** Prefer a stable `externalId`.
* **Short.io:** Account for its documented same-destination and same-path behavior.
* **Rebrandly:** Maintain a local mapping or search before retrying creation.
* **T.LY:** Maintain a local mapping and resolve ambiguous create failures before retrying.
* **YOURLS:** A repeated destination or keyword can return existing/conflict behavior depending on installation and plugins.

Generate and persist a local operation ID before calling a provider. On timeout, check whether creation succeeded before issuing another create.

---

# 10. Recommended implementation order

1. Implement the normalized models and backend provider interface.
2. Implement Dub first; its API most closely matches conventional REST CRUD.
3. Implement Short.io.
4. Implement T.LY, paying attention to complete-short-URL identifiers and DELETE bodies.
5. Implement Rebrandly, including workspace headers.
6. Implement YOURLS create/read/list only.
7. Add YOURLS update/delete only after selecting or building an authenticated plugin.
8. Add contract tests using separate test domains/workspaces.
9. Add provider-specific rate-limit and error-mapping tests.
10. Add integration tests confirming that credentials never appear in browser network traffic.

## Acceptance criteria

For each hosted provider:

* A link can be created with a destination and optional slug.
* The canonical provider ID and returned short URL are persisted.
* A created link can be retrieved.
* Links can be listed with bounded pagination.
* Supported search filters are mapped correctly.
* Destination and title can be updated.
* A link can be deleted.
* A slug collision returns `SLUG_CONFLICT`.
* Authentication failures do not leak credentials.
* `429` responses honor `Retry-After` where supplied.

For stock YOURLS:

* Create, expand, URL stats, and bounded stats listing work.
* Update and delete return `UNSUPPORTED_OPERATION`.
* Custom update/delete operations remain disabled until an approved plugin is installed and tested.

The main implementation trap is **YOURLS**: its stock API is not CRUD-complete, so update and delete require a plugin or must be reported as unsupported.

[1]: https://developers.short.io/reference/post_links?utm_source=chatgpt.com "Create a new link"
[2]: https://developers.short.io/reference/post_links-bulk?utm_source=chatgpt.com "Create up to 1000 links in one call"
[3]: https://developers.short.io/reference/get_api-links?utm_source=chatgpt.com "Link list"
[4]: https://developers.short.io/reference/get_links-multiple-by-url?utm_source=chatgpt.com "Get links info by original URL"
[5]: https://developers.short.io/reference/post_links-linkid?utm_source=chatgpt.com "Update existing URL"
[6]: https://developers.short.io/reference/delete_links-link-id?utm_source=chatgpt.com "Delete link"
[7]: https://developers.short.io/docs/using-the-ttl-parameter?utm_source=chatgpt.com "Using the TTL parameter"
[8]: https://dub.co/docs/api-reference/introduction?utm_source=chatgpt.com "Dub API – Introduction"
[9]: https://dub.co/docs/api-reference/links/create?utm_source=chatgpt.com "Create a link"
[10]: https://dub.co/docs/api-reference/links/list?utm_source=chatgpt.com "List all links"
[11]: https://speakeasy-20cf8bdf.mintlify.app/api-reference/endpoint/retrieve-a-link?utm_source=chatgpt.com "Get link info with the Dub API - API Reference - Documentation"
[12]: https://dub.co/docs/api-reference/links/delete?utm_source=chatgpt.com "Delete a link"
[13]: https://developers.rebrandly.com/reference/createlink-1?utm_source=chatgpt.com "/v1/links"
[14]: https://developers.rebrandly.com/docs/list-your-links?utm_source=chatgpt.com "Manage your branded links"
[15]: https://developers.rebrandly.com/reference/delete-link-endpoint-1?utm_source=chatgpt.com "/v1/links/:id"
[16]: https://developers.rebrandly.com/docs/migrate-links-over-teams?utm_source=chatgpt.com "Migrate links over workspaces"
[17]: https://t.ly/docs?utm_source=chatgpt.com "T.LY URL Shortener API Documentation"
[18]: https://github.com/YOURLS/YOURLS/blob/master/yourls-api.php?utm_source=chatgpt.com "YOURLS/yourls-api.php at master"
[19]: https://github.com/YOURLS/YOURLS/blob/master/readme.html?utm_source=chatgpt.com "YOURLS/readme.html at master"
[20]: https://yourls.org/docs/guide/troubleshooting/abuse?utm_source=chatgpt.com "Abuse"
[21]: https://github.com/yourls/yourls?utm_source=chatgpt.com "YOURLS/YOURLS: 🔗 The 𝘥𝘦 𝘧𝘢𝘤𝘵𝘰 standard, self ..."
