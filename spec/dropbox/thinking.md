**Yes—with one important distinction: you register one Dropbox app; your users do not.**

Dropbox explicitly supports **OAuth authorization-code flow with PKCE for pure browser JavaScript applications**. No backend or client secret is required. Dropbox also says not to instruct users to register their own apps: you register yours once, then every user connects through the normal Dropbox consent screen. ([Dropbox Developers][1])

## What you must do as the developer

In the Dropbox App Console, create one app and configure:

* **Scoped access**
* **App folder** access, ideally, or full Dropbox access if genuinely needed
* The necessary API scopes, such as:

  * `files.metadata.read`
  * `files.content.read`
  * `files.content.write`
* Exact redirect URLs, such as:

  * `https://mawkingbird.com/integrations/dropbox/callback`
  * `http://localhost:4200/integrations/dropbox/callback`

You then put the resulting **app key/client ID** in your Angular code. That key is public and is expected to be visible in a browser app. You do **not** include the app secret.

Dropbox requires the redirect URI used during OAuth to exactly match one registered in the App Console. ([Dropbox Developers][1])

## What the user experiences

The user clicks:

> Connect Dropbox

They are redirected to Dropbox, sign in, and see something like:

> Mawkingbird would like access to files in its application folder.

They approve it and return to your site. They never visit the developer console, create credentials, or submit anything for approval.

## Do you need Dropbox approval?

For development, you can create the app and test with your own account immediately.

For broader public use, Dropbox apps normally begin in a limited **development** state. You may need to apply for production status when you want more than the permitted number of linked users. That is **your one-time app review**, not something every user must do.

So, conceptually:

| Requirement                                     | Needed? |
| ----------------------------------------------- | ------: |
| You register one Dropbox app                    |     Yes |
| You publish the client ID in the SPA            |     Yes |
| You publish a client secret                     |      No |
| Your users register Dropbox apps                |      No |
| Your users approve a consent screen             |     Yes |
| You may eventually request production status    |     Yes |
| Each user gets individually approved by Dropbox |      No |

## Browser-only PKCE flow

The browser:

1. Generates a random `code_verifier`.
2. Derives a SHA-256 `code_challenge`.
3. Stores the verifier temporarily, usually in `sessionStorage`.
4. Redirects to Dropbox with:

   * `client_id`
   * `response_type=code`
   * `redirect_uri`
   * `code_challenge`
   * `code_challenge_method=S256`
   * `token_access_type=online`
5. Receives `?code=...` at the callback.
6. Exchanges the code and verifier directly with Dropbox.
7. Receives a short-lived access token.
8. Calls Dropbox directly from the browser.

Dropbox specifically recommends **short-lived access tokens without refresh tokens** for pure JavaScript applications using PKCE. ([Dropbox Developers][1])

## Important limitation

For a truly browser-only app, use:

```text
token_access_type=online
```

That means the access token is short-lived. When it expires, the user may need to authorize again.

Dropbox technically has PKCE-compatible refresh-token mechanisms in parts of its SDK ecosystem, but storing a durable Dropbox refresh token in browser storage creates a much larger security exposure. For your “static Angular app on GitHub Pages” model, I would avoid durable refresh tokens and simply reconnect when necessary.

## Skeleton authorization request

```ts
const authorizeUrl = new URL("https://www.dropbox.com/oauth2/authorize");

authorizeUrl.search = new URLSearchParams({
  client_id: DROPBOX_APP_KEY,
  response_type: "code",
  redirect_uri: `${location.origin}/integrations/dropbox/callback`,
  code_challenge: challenge,
  code_challenge_method: "S256",
  token_access_type: "online",
}).toString();

location.assign(authorizeUrl);
```

Then exchange the returned code:

```ts
const body = new URLSearchParams({
  code,
  grant_type: "authorization_code",
  client_id: DROPBOX_APP_KEY,
  redirect_uri: `${location.origin}/integrations/dropbox/callback`,
  code_verifier: verifier,
});

const response = await fetch(
  "https://api.dropboxapi.com/oauth2/token",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  },
);
```

## Verdict

**Dropbox is a good fit for your integration idea.**

It gives you the experience you want:

```text
Connect Dropbox
       ↓
Dropbox consent
       ↓
Return to Mawkingbird
       ↓
Read/write Dropbox through browser APIs
```

The only registration burden is on **you**, once. Compared with Google, the likely administrative and verification burden is considerably less—especially when you request narrowly scoped access to an app-specific folder rather than the user’s entire Dropbox.

[1]: https://developers.dropbox.com/oauth-guide?utm_source=chatgpt.com "Dropbox OAuth Guide"
