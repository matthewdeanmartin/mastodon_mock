import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { corsProxyOrigin, isTestBuild } from '../../build-flavor';

/**
 * The Mawkingbird account session.
 *
 * ## What replaced what
 *
 * This supersedes `workos-session.ts` and the `@workos-inc/authkit-js` SDK.
 * Identity now comes from Mawkingbird's own services: a magic link sent by the
 * account service, exchanged for a short-lived RS256 token by the token
 * service.
 *
 * The change removed a real bug and a real bill at once.
 *
 * **The bug.** AuthKit keeps its refresh token in memory when `devMode` is
 * false, so a page reload had nothing to restore from and fell back to a
 * cookie belonging to `api.workos.com` — a third-party cookie for this origin,
 * which Safari and Firefox drop outright. Pressing F5 signed people out. The
 * interim fix was `devMode: true`, which moved a multi-day refresh token into
 * `localStorage`; that is now gone, because the long-lived credential is an
 * HttpOnly cookie on the account service that no script here can read.
 *
 * **The bill.** Every free user, and every anonymous textboard visitor, would
 * have counted toward an identity vendor's user total. They now never touch
 * one: an anonymous token is minted locally by the token service with no
 * storage and no account, and email sign-in involves no vendor at all.
 *
 * ## Two kinds of token, one shape
 *
 * `anon` for a visitor who has not signed in, `email` once they have. Both are
 * the same signed format and both go in the same header, so nothing downstream
 * branches on which kind it holds — it reads the `auth` claim if it cares.
 *
 * ## Where the token lives
 *
 * In memory, deliberately. It is short-lived (24h free, 1h paid) and cheap to
 * re-mint, and the thing that actually survives a reload is the HttpOnly
 * session cookie — which is exactly where a long-lived credential belongs and
 * exactly where `localStorage` is not. This service therefore registers no
 * storage key, so the export classification in `portable-config.ts` is
 * untouched.
 *
 * ## Failure posture
 *
 * Signed out is a normal state, not an error. A failed mint leaves {@link user}
 * null and the app anonymous; the proxy reads an absent token as the free tier,
 * so the worst outcome of anything here going wrong is free-tier rate limits.
 */

/** Where the token service lives. Overridable so specs need no network. */
export const AUTH_ORIGIN = new InjectionToken<string>('AUTH_ORIGIN', {
  providedIn: 'root',
  factory: () => authOrigin(),
});

/** Where the account service lives. */
export const ACCOUNT_ORIGIN = new InjectionToken<string>('ACCOUNT_ORIGIN', {
  providedIn: 'root',
  factory: () => accountOrigin(),
});

/**
 * The token and account service origins for this deployment.
 *
 * Derived from the same test/production split as the CORS proxy, so a `/test/`
 * build talks to the sandbox services and cannot mint a token production would
 * accept — the issuer differs, and the proxy pins it.
 *
 * Production is on `*.mawkingbird.com`; test stays on `*.workers.dev` so that
 * "am I on test?" is visible in the address bar. Must agree with `hostsFor()`
 * in `mawkingbird_auth/src/shared/hosts.ts` — a disagreement means the app
 * talks to a service that will not accept its origin.
 *
 * Production being same-site with the app is what lets the session cookie use
 * `SameSite=Lax`, which restores the browser's own CSRF protection. On
 * `workers.dev` it had to be `SameSite=None`, leaving the origin allowlist to
 * do that job alone.
 */
export function authOrigin(): string {
  return isTestBuild()
    ? 'https://mawkingbird-auth-test.matthewdeanmartin.workers.dev'
    : 'https://auth.mawkingbird.com';
}

export function accountOrigin(): string {
  return isTestBuild()
    ? 'https://mawkingbird-account-test.matthewdeanmartin.workers.dev'
    : 'https://account.mawkingbird.com';
}

/** How strongly the caller proved who they are. */
export type AuthStrength = 'anon' | 'email' | 'idp';

/** What the caller pays for. */
export type Tier = 'free' | 'plus' | 'business';

/** A minted token and what it says. */
interface MintedToken {
  token: string;
  /** Unix **seconds**, as the service mints it. */
  expiresAt: number;
  auth: AuthStrength;
  tier: Tier;
}

/** The signed-in account, as the UI needs to describe it. */
export interface AccountUser {
  auth: AuthStrength;
  tier: Tier;
}

/** Re-mint this long before expiry, so a request never carries a stale token. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class MawkingbirdSession {
  private authBase = inject(AUTH_ORIGIN);
  private accountBase = inject(ACCOUNT_ORIGIN);

  /** The signed-in account, or null when anonymous. */
  readonly user = signal<AccountUser | null>(null);

  /** True once the first mint has settled, whether or not anyone signed in. */
  readonly ready = signal(false);

  /** The last failure worth showing, or null. */
  readonly error = signal<string | null>(null);

  /** True while a sign-in email is being requested. */
  readonly sendingLink = signal(false);

  private held: MintedToken | null = null;

  /** An in-flight mint, shared so concurrent callers make one request. */
  private minting: Promise<MintedToken | null> | null = null;

  /**
   * Settle the session on startup.
   *
   * Attempts a signed-in mint first; falls back to anonymous. Both are normal
   * outcomes, and neither is an error.
   */
  async ensureReady(): Promise<void> {
    try {
      await this.token();
    } finally {
      this.ready.set(true);
    }
  }

  /**
   * A usable token, minting or re-minting as needed.
   *
   * Returns null only when even an anonymous mint fails, which means the token
   * service is unreachable. The app keeps working; it is just rate-limited as
   * an unidentified caller.
   */
  async token(): Promise<string | null> {
    if (this.held && this.held.expiresAt * 1000 - REFRESH_MARGIN_MS > Date.now()) {
      return this.held.token;
    }
    // Deduplicated: several proxied requests can start at once, and each
    // minting its own token would spend the endpoint's rate limit on itself.
    this.minting ??= this.mint().finally(() => {
      this.minting = null;
    });
    const minted = await this.minting;
    return minted?.token ?? null;
  }

  /**
   * Request a sign-in link.
   *
   * Resolves true whenever the request was accepted — which is **always**, for
   * any well-formed address, whether or not it has an account. The service
   * answers identically either way on purpose: "does this person use
   * Mawkingbird?" is not a question a stranger gets to ask. The UI must
   * therefore say "check your inbox" rather than anything implying the address
   * was recognised.
   */
  async requestSignInLink(email: string, returnTo = '/settings/mawkingbird-plus'): Promise<boolean> {
    this.error.set(null);
    this.sendingLink.set(true);
    try {
      const response = await fetch(`${this.accountBase}/auth/email/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The session cookie is set by this service on a different origin, so
        // it only travels on credentialed requests.
        credentials: 'include',
        body: JSON.stringify({ email, returnTo }),
      });
      if (response.status === 429) {
        this.error.set('Too many sign-in emails. Please wait a minute and try again.');
        return false;
      }
      if (!response.ok) {
        this.error.set('Could not send the sign-in email. Please try again.');
        return false;
      }
      return true;
    } catch {
      this.error.set('Could not reach the sign-in service. Check your connection.');
      return false;
    } finally {
      this.sendingLink.set(false);
    }
  }

  /**
   * Sign out.
   *
   * Revokes the session so no further tokens can be minted. Any token already
   * held remains valid until it expires — which is why the UI should say so
   * rather than implying an instant global sign-out.
   */
  async signOut(): Promise<void> {
    try {
      await fetch(`${this.accountBase}/auth/signout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Revoking failed, but forgetting the local token is still correct: the
      // user asked to be signed out here.
    }
    this.held = null;
    this.user.set(null);
    // Re-mint anonymously so the app keeps a working token.
    await this.token();
  }

  /** Discard the held token and mint a fresh one. Called after checkout. */
  async refresh(): Promise<void> {
    this.held = null;
    await this.token();
  }

  private async mint(): Promise<MintedToken | null> {
    const signedIn = await this.post({ grant: 'cookie' });
    if (signedIn) {
      this.held = signedIn;
      this.user.set({ auth: signedIn.auth, tier: signedIn.tier });
      return signedIn;
    }

    // A 401 from the cookie grant is what an expired 90-day session looks like.
    // Not an error — fall back to anonymous and show signed-out UI.
    const anonymous = await this.post({ grant: 'anon' });
    this.held = anonymous;
    this.user.set(null);
    return anonymous;
  }

  private async post(body: { grant: 'anon' | 'cookie' }): Promise<MintedToken | null> {
    try {
      const response = await fetch(`${this.authBase}/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return null;
      }
      const minted = (await response.json()) as Partial<MintedToken>;
      if (typeof minted.token !== 'string' || typeof minted.expiresAt !== 'number') {
        return null;
      }
      return {
        token: minted.token,
        expiresAt: minted.expiresAt,
        auth: minted.auth ?? 'anon',
        tier: minted.tier ?? 'free',
      };
    } catch {
      return null;
    }
  }
}

/** The proxy this deployment talks to. Re-exported so callers need one import. */
export { corsProxyOrigin };
