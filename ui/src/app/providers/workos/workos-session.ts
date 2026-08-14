import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { createClient, type User } from '@workos-inc/authkit-js';
import { environment } from '../../../environments/environment';
import { appCallbackUrl } from '../../pkce';

export const WORKOS_CLIENT_ID = new InjectionToken<string>('WORKOS_CLIENT_ID', {
  providedIn: 'root',
  factory: () => environment.workosClientId,
});

/**
 * The Mawkingbird account session, via WorkOS AuthKit.
 *
 * ## Why this is a thin wrapper and not another hand-rolled OAuth flow
 *
 * The app already has correct PKCE primitives in `pkce.ts`, driving the
 * Mastodon and Dropbox flows, and `dropbox-session.ts` is a working template
 * for exactly this shape. Reusing them here would nonetheless be a mistake,
 * for one reason that is not obvious until you read the SDK:
 *
 * **AuthKit keeps the long-lived credential somewhere our code cannot reach.**
 * The refresh token rides in a cookie sent with `credentials: "include"`, and
 * the access token and user live in the SDK's *in-memory* store — never
 * `localStorage`, never `sessionStorage`. (Only the PKCE code verifier touches
 * `sessionStorage`, and only for the seconds between redirect and exchange.)
 *
 * A hand-rolled version cannot match that. JavaScript cannot set an HttpOnly
 * cookie, so our copy would have to park a multi-day refresh token in web
 * storage — strictly worse than what the SDK gives away for free, and worse in
 * the exact dimension this codebase is careful about everywhere else (see
 * `credential-lifetime.ts` and the sensitivity rules in `portable-config.ts`).
 *
 * So "do not write new crypto" points *away* from `pkce.ts` here. It stays
 * exactly as it is, serving the two flows it already serves. The only thing
 * borrowed from it is {@link appCallbackUrl}, for the reason below.
 *
 * ## Why there is no callback route
 *
 * Unlike the Dropbox and Blogger connectors, this has no
 * `integrations/*\/callback` page. `Client.initialize()` looks for `?code=` on
 * whatever URL it loads at, exchanges it, and then strips `code` and `state`
 * from the address bar with `history.replaceState`. The redirect URI is
 * therefore just the account page itself, and a callback component would be a
 * page whose entire job the SDK already does.
 *
 * ## The redirect URI must not be built from `location.origin`
 *
 * Production is `mawkingbird.com/` and canary is `mawkingbird.com/canary/` —
 * the *same origin*, differing only in base href. {@link appCallbackUrl}
 * resolves against `document.baseURI`, so each deployment gets its own
 * redirect URI. Building one from `location.origin` would drop `/canary/` and
 * send canary users to production, which has no pending code verifier and
 * fails with the SDK's "login which did not originate at the application"
 * error. Both entries must be registered in the WorkOS dashboard.
 *
 * ## Failure posture
 *
 * Signed out is a normal state, not an error. Initialisation failures leave
 * {@link user} null and record {@link error} for the page to show; nothing
 * here throws into application startup, because an identity provider being
 * unreachable must not break an app whose entire point is working without a
 * server.
 */
@Injectable({ providedIn: 'root' })
export class WorkosSession {
  private clientId = inject(WORKOS_CLIENT_ID);

  /** The signed-in user, or null. Populated once {@link ensureReady} resolves. */
  readonly user = signal<User | null>(null);

  /** True once initialisation has settled, whether or not anyone is signed in. */
  readonly ready = signal(false);

  /** The last initialisation or sign-in failure, for the page to surface. */
  readonly error = signal<string | null>(null);

  /**
   * The in-flight or completed `createClient` promise.
   *
   * Held so concurrent callers share one client: `createClient` performs the
   * code exchange, and running it twice would consume the single-use verifier
   * and fail the second attempt.
   */
  private client: Promise<AuthkitClient> | null = null;

  /** Whether this build has a client id at all. Empty disables the feature. */
  get configured(): boolean {
    return this.clientId.trim().length > 0;
  }

  /**
   * Initialise the SDK, completing a pending redirect if there is one.
   *
   * Safe to call repeatedly; the underlying promise is created once.
   */
  async ensureReady(): Promise<void> {
    if (!this.configured) {
      this.ready.set(true);
      return;
    }
    try {
      const client = await this.connect();
      this.user.set(client.getUser());
    } catch (error: unknown) {
      // A failure here is usually a misconfigured dashboard (an unregistered
      // origin or redirect URI) rather than anything the user did.
      this.error.set(messageOf(error, 'Could not reach the Mawkingbird account service.'));
    } finally {
      this.ready.set(true);
    }
  }

  /** Send the user to the hosted sign-in page. Returns only if it fails. */
  async signIn(): Promise<void> {
    await this.redirect('signIn');
  }

  /** Send the user to the hosted sign-up page. Returns only if it fails. */
  async signUp(): Promise<void> {
    await this.redirect('signUp');
  }

  /**
   * Sign out and return here.
   *
   * `returnTo` is this page rather than the site root, for the same base-href
   * reason as the redirect URI: the root belongs to production, so a canary
   * user would be dropped out of the deployment they were using.
   */
  async signOut(): Promise<void> {
    if (!this.configured) {
      return;
    }
    try {
      const client = await this.connect();
      this.user.set(null);
      await client.signOut({ returnTo: accountPageUrl(), navigate: false });
    } catch (error: unknown) {
      this.error.set(messageOf(error, 'Could not sign out.'));
    }
  }

  /**
   * A current access token, refreshing if needed, or null when signed out.
   *
   * Unused in this phase — the account page only displays identity. It exists
   * because it is the seam the paid tier is built on: Phase 2 sends this to
   * the Worker's `/token` endpoint in exchange for a short-lived proxy token.
   */
  async accessToken(): Promise<string | null> {
    if (!this.configured || !this.user()) {
      return null;
    }
    try {
      return await (await this.connect()).getAccessToken();
    } catch {
      // Includes the ordinary "not signed in" case, which is not an error.
      return null;
    }
  }

  private async redirect(method: 'signIn' | 'signUp'): Promise<void> {
    if (!this.configured) {
      return;
    }
    this.error.set(null);
    try {
      const client = await this.connect();
      await client[method]();
    } catch (error: unknown) {
      this.error.set(messageOf(error, 'Could not start sign-in.'));
    }
  }

  private connect(): Promise<AuthkitClient> {
    this.client ??= createClient(this.clientId, {
      redirectUri: accountPageUrl(),
      // Keeps `user` in step with the SDK's own refresh cycle, so a session
      // that dies overnight is reflected in the UI rather than showing a stale
      // name until the next reload.
      onRefresh: ({ user }) => this.user.set(user),
      onRefreshFailure: () => this.user.set(null),
    });
    return this.client;
  }
}

/** The account page's absolute URL — the OAuth redirect target. See the class doc. */
export function accountPageUrl(): string {
  return appCallbackUrl('settings/mawkingbird-plus');
}

/** A display name from a WorkOS user, or null when they supplied none. */
export function displayName(user: User): string | null {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || null;
}

/** What `createClient` resolves to. Named so the service can be typed without it. */
type AuthkitClient = Awaited<ReturnType<typeof createClient>>;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
