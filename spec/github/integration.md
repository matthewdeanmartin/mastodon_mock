# GitHub Connection for Mawkingbird

> **PoC result (2026-07-22): device flow is not browser-compatible.** GitHub's
> `github.com/login/device/code` and `github.com/login/oauth/access_token` endpoints do not return
> CORS permission, even for form-encoded requests that avoid a preflight. The browser sends the
> request but will not expose the response to Angular. The `api.github.com` REST endpoints do
> support CORS, including preflight for `Authorization` and `X-GitHub-Api-Version`.
>
> The implemented zero-backend PoC therefore asks the user for a personal access token (classic)
> with `notifications` and `read:user`, validates it with `GET /user`, and stores it locally. A
> shared OAuth App can remove that paste-token step only if Mawkingbird adds a small trusted token
> exchange component; users do not need to register their own app in that design.

## Rejected device-flow proposal

The remainder of this document is retained as the original proposal. It must not be implemented in
the browser without a token-exchange component.

## Goal

Add GitHub as a connection in **Settings → Connections**. Mawkingbird is an Angular-only application; no backend or Octokit is required.

Use a traditional **GitHub OAuth App**, because GitHub’s notifications endpoint does not support GitHub App user tokens. Enable **Device Flow** in the OAuth App settings.

Request scopes:

```text
read:user notifications
```

## Connection Flow

1. User clicks **Connect GitHub**.
2. POST a form-encoded request to:

```text
https://github.com/login/device/code
```

Parameters:

```text
client_id=<MAWKINGBIRD_GITHUB_CLIENT_ID>
scope=read:user notifications
```

3. Display the returned `user_code`, with buttons to copy it and open the returned `verification_uri`.
4. Poll the token endpoint no faster than the returned `interval`:

```text
POST https://github.com/login/oauth/access_token
```

Parameters:

```text
client_id=<CLIENT_ID>
device_code=<DEVICE_CODE>
grant_type=urn:ietf:params:oauth:grant-type:device_code
```

5. Continue polling on `authorization_pending`. Increase the delay on `slow_down`. Stop on success, rejection, or expiration.
6. Store the access token locally and show the connected GitHub username. Device codes normally expire after 15 minutes.

Use form-encoded requests and `Accept: application/json`; avoid headers that trigger a CORS preflight.

## Initial API Calls

Send:

```http
Authorization: Bearer <token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
```

Hello world:

```text
GET https://api.github.com/user
```

Accounts followed by the user:

```text
GET https://api.github.com/user
GET https://api.github.com/users/{login}/following
```

The second endpoint reads the user’s public following list without requiring follow-management permission.

Notifications:

```text
GET https://api.github.com/notifications?all=false&participating=false
```

GitHub does not have general private messages. Treat notifications as GitHub’s inbox, and optionally use received events as a timeline:

```text
GET https://api.github.com/users/{login}/received_events
```

Received events include activity from watched repositories and followed users, but may be delayed by 30 seconds to six hours.

## UI States

Support:

```text
Disconnected
Waiting for authorization
Connected as <login>
Authorization expired
Authorization denied
Connection error
```

Provide **Disconnect GitHub**, which removes the locally stored token.

## Library Decision

Do **not** add Octokit initially. Angular `HttpClient` or `fetch` is sufficient for this small integration. Add Octokit later only if Mawkingbird begins using many GitHub endpoints, pagination helpers, or typed endpoint definitions.
