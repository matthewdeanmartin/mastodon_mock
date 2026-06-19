# Missing UI Features & Gaps Analysis

This document reviews the gaps between the features implemented in the `mastodon-mock` Python backend server and what is currently surfaced in the Angular test/admin UI (`ui/`).

---

## 1. Status & Composer Gaps

The status card and composer are currently very basic. The backend supports rich features on `POST /api/v1/statuses` and edit/delete routes, but these are not exposed in the UI.

| Feature Gap | Backend Route / Mechanism | Description of Gap |
| :--- | :--- | :--- |
| **Translate Post** | `POST /api/v1/statuses/{id}/translate` | No translate button is provided on status cards. Triggering this on the backend returns a pig-latinized version of the status content. |
| **Visibility Selector** | `POST /api/v1/statuses` (`visibility` param) | The composer defaults to public/unlisted. There is no dropdown to select visibility (`public`, `unlisted`, `private`, `direct`). |
| **Attach Media** | `POST /api/v2/media` & `media_ids[]` | While the UI renders existing media attachments on posts, the composer has no option to select, upload, or attach media files. |
| **Polls Creation & Voting** | `POST /api/v1/statuses` (`poll` param), `POST /api/v1/polls/{id}/votes` | The composer has no UI to build polls. Status cards do not render poll options, and users cannot cast votes. |
| **Pin / Unpin Status** | `POST /api/v1/statuses/{id}/pin` / `/unpin` | No action to pin owned statuses to the user's profile header, or to unpin them. |
| **Mute / Unmute Thread** | `POST /api/v1/statuses/{id}/mute` / `/unmute` | No option to mute conversation notifications for a specific status thread. |
| **Edit History** | `GET /api/v1/statuses/{id}/history` | No UI component shows prior edit snapshots (history) of a modified status, even though edit history is tracked and returned by the API. |
| **Status Quotes & Revocation** | `POST .../quotes/{qid}/revoke`, `PUT .../interaction_policy` | No UI options to change interaction policies (who can quote the status: `public`, `followers`, `nobody`) or to revoke quote permissions from quoting statuses. |
| **Detailed Interactions** | `GET .../reblogged_by`, `GET .../favourited_by` | Users cannot click on a status's likes/boosts count to view a list of accounts that favourited or reblogged it. |

---

## 2. Direct Messages & Conversations

Direct messages in Mastodon are grouped by participant conversations. The backend fully supports conversation grouping and read status management, but the frontend has no DM panel.

* **Missing Conversation Router/View**: No path `/conversations` or dedicated view exists in the UI.
* **Unread Management (`POST /api/v1/conversations/{id}/read`)**: No button or trigger to mark direct conversations as read.
* **Direct Composer Integration**: The post composer does not automatically format posts with `@mentions` into active conversation threads.

---

## 3. Account Customization & Settings

The UI lacks any settings or profile editing capabilities, meaning the user's mock account details cannot be updated from the browser.

* **Profile Editor (`PATCH /api/v1/accounts/update_credentials`)**: No settings page or modal is available to update user profile information (Display Name, Note/Bio, custom avatar/header uploads, or locked status).
* **Metadata Fields**: Mastodon allows setting table-based key-value fields on profiles (e.g., "Website", "Pronouns"). These fields cannot be managed.
* **Mutes & Blocks lists (`GET /api/v1/mutes`, `GET /api/v1/blocks`)**: There is no interface to view or manage muted or blocked accounts.
* **Follow Requests (`GET/POST /api/v1/follow_requests`)**: For locked accounts, there is no interface to approve (`authorize`) or deny (`reject`) pending follow requests.
* **Hashtag Following & Featuring (`POST /api/v1/tags/{tag}/follow`, `/feature`)**: The tag page (`/tags/:tag`) lacks buttons to follow/unfollow the hashtag or feature it on the profile. No page exists to list followed tags.

---

## 4. Moderation & Admin UI Gaps

While there is an admin panel (`ui/src/app/admin`), several backend moderation tools from `routers/admin.py` are unimplemented or partially exposed.

* **Account Rejection & Deletion**:
  * `POST /api/v1/admin/accounts/{id}/reject` (delete pending registration) is not wired.
  * `DELETE /api/v1/admin/accounts/{id}` (permanent account deletion) is not wired.
* **Unsensitize Accounts**: No UI element supports removing the `sensitive` flag from an account (`POST /api/v1/admin/accounts/{id}/unsensitive`).
* **Domain Allows (`/api/v1/admin/domain_allows`)**: No interface to view, whitelist, or remove domains from the allowed federation whitelist.
* **Email & Canonical Email Blocks**:
  * No panel to view or add email domain blocks (`/api/v1/admin/email_domain_blocks`).
  * No panel to manage canonical email blocks or run test canonicalization matches (`/api/v1/admin/canonical_email_blocks`).
* **IP Blocks (`/api/v1/admin/ip_blocks`)**: No interface to list, create, update, or remove IP address range blocks.
* **Trend Moderation**: While trending tags and posts can be viewed, there is no button to approve/reject trends (`POST /api/v1/admin/trends/{type}/{id}/{approve,reject}`).
* **Metrics & Dimensons**: No interface to view server statistics, dimensions, or cohort retention reports (`admin/measures`, `admin/dimensions`, `admin/retention`).

---

## 5. System & Infrastructure Gaps

* **Server-Sent Events (SSE) Streaming (`/api/v1/streaming`)**:
  * The frontend operates entirely on pull-based HTTP requests.
  * SSE streaming (`stream_user`, `stream_public`, etc.) is completely unused by the client. Timelines, notifications, and direct message threads do not update in real-time.
* **Full OAuth Flow**:
  * The frontend relies either on pasting a seeded access token or utilizing dev-login helpers (`/api/v1/_mock/dev_user`).
  * Standard OAuth application registration (`POST /api/v1/apps`) and authorization redirects (`/oauth/authorize`) are not integrated.
* **Fault Injection Control Plane (`/api/v1/_mock/faults`)**:
  * The mock's fault injection settings (simulating rate-limits, latency, timeouts, or JSON malformations) must be configured via CLI/curl.
  * No developer settings dashboard exists in the client UI to configure these rules.
