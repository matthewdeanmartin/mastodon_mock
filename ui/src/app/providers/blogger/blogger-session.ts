import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { scopedKey } from '../../account-scope';
import {
  appCallbackUrl,
  codeChallengeFor,
  createCodeVerifier,
  createOAuthState,
  statesMatch,
} from '../../pkce';

/**
 * Google OAuth client id for the Blogger connector.
 *
 * Public by design — a browser app cannot hold a secret, so Google's "web
 * application" client is used **without** its client secret and PKCE carries
 * the proof instead. Anyone can read this id out of the bundle and that is
 * fine; it authorizes nothing on its own.
 *
 * Empty in a build that has not been given one, which hides the connector
 * entirely rather than offering a button that cannot work — the same contract
 * as `DROPBOX_APP_KEY`.
 */
export const BLOGGER_CLIENT_ID = new InjectionToken<string>('BLOGGER_CLIENT_ID', {
  providedIn: 'root',
  factory: () => environment.bloggerClientId,
});

const TOKEN_KEY_BASE = 'mockingbird_blogger_token';
const VERIFIER_KEY = 'mockingbird_blogger_pkce_verifier';
const STATE_KEY = 'mockingbird_blogger_oauth_state';

/** Where Google sends the browser back. Must match a registered redirect URI. */
export const BLOGGER_CALLBACK_PATH = 'integrations/blogger/callback';

/**
 * The one scope this connector asks for.
 *
 * `auth/blogger` covers reading the user's blogs and publishing to them. Google
 * classifies it as *sensitive*, so an unverified app shows a warning
 * interstitial before the consent screen; that is a property of the registered
 * client, not something the code can or should route around.
 */
export const BLOGGER_SCOPE = 'https://www.googleapis.com/auth/blogger';

interface StoredBloggerToken {
  accessToken: string;
  expiresAt: number;
  /** The blog the user chose to publish to; null until they pick one. */
  blogId: string | null;
  blogName: string | null;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
}

interface GoogleErrorResponse {
  error?: string | { message?: string };
  error_description?: string;
}

function tokenKey(): string {
  return scopedKey(TOKEN_KEY_BASE);
}

function readToken(): StoredBloggerToken | null {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(tokenKey()) ?? 'null',
    ) as Partial<StoredBloggerToken> | null;
    if (!parsed || typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      blogId: typeof parsed.blogId === 'string' ? parsed.blogId : null,
      blogName: typeof parsed.blogName === 'string' ? parsed.blogName : null,
    };
  } catch {
    return null;
  }
}

/**
 * A browser-only Blogger (Google) OAuth/PKCE session.
 *
 * **Access tokens only, deliberately.** Google will issue a refresh token for
 * an installed-app flow, and it is tempting because it means never signing in
 * again. It is also a credential that lives in the browser indefinitely and can
 * mint new access tokens for a year — a much worse thing to leak than an hour-
 * long token. Publishing to a blog is an occasional, deliberate act, so the
 * trade is not worth it: the token sits in `sessionStorage`, dies with the tab,
 * and reconnecting is two clicks.
 *
 * The token is account-scoped (`scopedKey`) like every other per-persona
 * credential: a blog linked while signed in as one account is not silently
 * available to another.
 */
@Injectable({ providedIn: 'root' })
export class BloggerSession {
  private clientId = inject(BLOGGER_CLIENT_ID);
  private token = signal<StoredBloggerToken | null>(readToken());

  readonly connected = computed(() => this.token() !== null);
  /** The blog posts will go to, if one has been chosen. */
  readonly blogId = computed(() => this.token()?.blogId ?? null);
  readonly blogName = computed(() => this.token()?.blogName ?? null);
  /** True once a blog is chosen — the composer needs this, not just `connected`. */
  readonly ready = computed(() => this.token()?.blogId != null);

  /** False when this build shipped without a client id; the connector hides. */
  get configured(): boolean {
    return this.clientId.trim().length > 0;
  }

  async connect(): Promise<void> {
    if (!this.configured) {
      throw new Error('Blogger has not been configured for this build yet.');
    }
    const verifier = createCodeVerifier();
    const state = createOAuthState();
    const challenge = await codeChallengeFor(verifier);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);

    const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizeUrl.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: appCallbackUrl(BLOGGER_CALLBACK_PATH),
      scope: BLOGGER_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      // Without this Google silently reuses a prior grant and can return a
      // token for an account the user did not mean to use — the picker makes
      // "which Google account?" an explicit answer every time.
      prompt: 'select_account',
    }).toString();
    location.assign(authorizeUrl.toString());
  }

  async finishAuthorization(params: URLSearchParams): Promise<void> {
    const oauthError = params.get('error_description') ?? params.get('error');
    if (oauthError) {
      this.clearPendingAuthorization();
      throw new Error(describeGoogleOAuthError(oauthError));
    }

    const code = params.get('code');
    const state = params.get('state');
    const expectedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!code || !statesMatch(expectedState, state) || !verifier) {
      this.clearPendingAuthorization();
      throw new Error(
        'Google returned an invalid or expired authorization response. Please try again.',
      );
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // No client_secret: PKCE's code_verifier is the proof. Google accepts
        // this for a web client as long as the redirect_uri is registered.
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: this.clientId,
          redirect_uri: appCallbackUrl(BLOGGER_CALLBACK_PATH),
          code_verifier: verifier,
        }),
      });
      if (!response.ok) {
        throw new Error(await googleError(response, 'Google rejected the authorization code.'));
      }
      const result = (await response.json()) as GoogleTokenResponse;
      this.adoptToken(result.access_token, result.expires_in);
    } finally {
      this.clearPendingAuthorization();
    }
  }

  /**
   * A usable access token, or null when there is none or it is about to expire.
   *
   * The 30-second margin means a request started now does not die in flight on
   * a token that expires mid-call.
   */
  accessToken(): string | null {
    const token = this.token();
    if (!token) {
      return null;
    }
    if (token.expiresAt <= Date.now() + 30_000) {
      this.disconnect();
      return null;
    }
    return token.accessToken;
  }

  /**
   * Adopt an already-obtained token. The OAuth callback is the only production
   * caller; tests use it to reach a connected state without a browser redirect.
   */
  adoptToken(accessToken: string, expiresInSeconds: number): void {
    this.store({
      accessToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      blogId: null,
      blogName: null,
    });
  }

  /** Remember which blog to publish to. */
  chooseBlog(blogId: string, blogName: string): void {
    const token = this.token();
    if (!token) {
      return;
    }
    this.store({ ...token, blogId, blogName });
  }

  disconnect(): void {
    sessionStorage.removeItem(tokenKey());
    this.token.set(null);
  }

  private store(token: StoredBloggerToken): void {
    sessionStorage.setItem(tokenKey(), JSON.stringify(token));
    this.token.set(token);
  }

  private clearPendingAuthorization(): void {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
  }
}

/**
 * Google's OAuth error codes are terse and two of them are routinely hit during
 * setup, so they get a sentence that says what to actually do.
 */
function describeGoogleOAuthError(raw: string): string {
  if (raw.includes('redirect_uri_mismatch')) {
    return `Google rejected the redirect address. Add ${appCallbackUrl(
      BLOGGER_CALLBACK_PATH,
    )} to the OAuth client's authorized redirect URIs.`;
  }
  if (raw.includes('access_denied')) {
    return 'You declined access, so nothing was connected.';
  }
  return raw;
}

/** The most specific message Google offers for a failed request. */
export async function googleError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as GoogleErrorResponse;
    const detail =
      body.error_description ??
      (typeof body.error === 'string' ? body.error : body.error?.message);
    return detail ? `${fallback} ${detail}` : fallback;
  } catch {
    return fallback;
  }
}
