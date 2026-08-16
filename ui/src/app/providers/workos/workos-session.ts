import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { createClient, type User } from '@workos-inc/authkit-js';
import { environment } from '../../../environments/environment';
import { isTestBuild } from '../../build-flavor';
import { appCallbackUrl } from '../../pkce';

export const WORKOS_CLIENT_ID = new InjectionToken<string>('WORKOS_CLIENT_ID', {
  providedIn: 'root',
  factory: () => environment.workosClientId,
});

/**
 * `createClient`, behind an injection token.
 *
 * Injected rather than imported directly so tests can supply a fake without
 * `vi.mock`. That is not merely a convenience: the Angular unit-test builder
 * runs with `isolate: false`, so spec files share one module registry, and a
 * module-level mock is only in force if the mocking file happens to win the
 * load race. Depending on that made this service's spec fail on roughly half
 * of full-suite runs while passing alone — see `src/test-setup.ts` for the
 * same class of bug with `window.location`.
 *
 * An injection token has no such ambiguity: whoever configures the injector
 * decides, every time.
 */
export const WORKOS_CREATE_CLIENT = new InjectionToken<typeof createClient>(
  'WORKOS_CREATE_CLIENT',
  { providedIn: 'root', factory: () => createClient },
);

/**
 * Diagnostic logging for the sign-in and checkout-return flow.
 *
 * On by default on the test deployment, and switchable anywhere else with
 * `localStorage.setItem('mawkingbird_debug_auth', '1')` — the failure this
 * exists for only reproduces on a real deployment with real cookies and a real
 * round trip through Stripe, so it has to be enable-able in production without
 * a rebuild.
 *
 * Never logs a token, a code, or a verifier. The interesting facts are all
 * *shapes*: whether a cookie is present, whether a user came back, which branch
 * the SDK took. A log line carrying the credential would be a worse bug than
 * the one being chased.
 */
export function authDebugEnabled(): boolean {
  try {
    if (localStorage.getItem('mawkingbird_debug_auth') === '1') {
      return true;
    }
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Fall through.
  }
  return isTestBuild();
}

/** Log a step in the auth flow, with no credential material in it. */
export function authDebug(step: string, detail: Record<string, unknown> = {}): void {
  if (!authDebugEnabled()) {
    return;
  }
  console.info(`[mawkingbird auth] ${step}`, {
    ...detail,
    // The hint cookie the SDK uses to decide whether a session is worth
    // restoring. Its absence on a checkout return is the single most likely
    // explanation for "you are not logged in" after paying: the cookie is set
    // by WorkOS for its own domain, and a browser that dropped it during the
    // trip through Stripe leaves the SDK with nothing to refresh from.
    hasSessionCookie: /(?:^|;\s*)workos-has-session=/.test(document.cookie),
    path: location.pathname,
    query: [...new URLSearchParams(location.search).keys()].join(','),
  });
}

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
 * ## Why sessions do not survive as long as they should
 *
 * A social app should sign you in once and keep you signed in for years. This
 * one currently does not, and the cause is in the SDK's storage model rather
 * than in anything here:
 *
 * - `devMode` defaults to true on `localhost` and false everywhere else.
 * - With `devMode: false`, the refresh token is kept in **memory only**. A page
 *   reload loses it.
 * - Reloads therefore depend entirely on the HttpOnly session cookie the SDK
 *   sends with `useCookie: true` — and that cookie belongs to
 *   `api.workos.com`, which makes it a **third-party cookie** for this origin.
 *
 * Safari and Firefox block third-party cookies outright, and Chrome restricts
 * them. When the cookie is dropped, `initialize()` finds nothing to refresh
 * from and the user is signed out — which reads as "it logged me out again"
 * within hours rather than years.
 *
 * The fix is configuration, not code: point {@link CreateClientOptions.apiHostname}
 * at a first-party domain (`auth.mawkingbird.com`, CNAME'd to WorkOS in the
 * dashboard) so the cookie is first-party for this site. Raising token
 * lifetimes does not help, because the problem is the credential vanishing
 * rather than expiring.
 *
 * Do **not** "fix" this by setting `devMode: true` in production. That moves
 * the refresh token into `localStorage`, where any script on this origin can
 * read a multi-day credential — the exact thing the module comment above
 * explains this SDK was chosen to avoid.
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
  private createClient = inject(WORKOS_CREATE_CLIENT);

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
    authDebug('ensureReady:start', { alreadyConnected: this.client !== null });
    try {
      const client = await this.connect();
      const user = client.getUser();
      this.user.set(user);
      // The line that answers "why did it say I was not logged in?". A false
      // here on a checkout return means the SDK found no session to restore,
      // which is a cookie problem rather than anything this app did.
      authDebug('ensureReady:done', { signedIn: user !== null });
    } catch (error: unknown) {
      // A failure here is usually a misconfigured dashboard (an unregistered
      // origin or redirect URI) rather than anything the user did.
      authDebug('ensureReady:failed', { message: messageOf(error, 'unknown') });
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
    // Logged because the redirect URI must match a WorkOS dashboard entry
    // *exactly*, and each deployment has its own — /test/ and /canary/ differ
    // from production only by base href, so a missing entry looks like a
    // mysterious sign-in failure rather than a configuration error.
    authDebug('connect', { redirectUri: accountPageUrl(), reused: this.client !== null });
    this.client ??= this.createClient(this.clientId, {
      redirectUri: accountPageUrl(),
      // Keeps `user` in step with the SDK's own refresh cycle, so a session
      // that dies overnight is reflected in the UI rather than showing a stale
      // name until the next reload.
      onRefresh: ({ user }) => {
        authDebug('onRefresh', { signedIn: user !== null });
        this.user.set(user);
      },
      onRefreshFailure: () => {
        // Fires when the refresh token is gone or rejected. On a checkout
        // return this is the other candidate explanation, and it is worth
        // distinguishing from "no cookie at all".
        authDebug('onRefreshFailure');
        this.user.set(null);
      },
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
