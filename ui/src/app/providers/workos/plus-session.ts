import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { externalFetch } from '../external-fetch';
import { accountPageUrl, WorkosSession } from './workos-session';

/**
 * The supporter session: proxy tokens, subscription state, and checkout.
 *
 * Separate from {@link WorkosSession}, which knows only about identity. This
 * one knows about money, and keeping the two apart means signing in still
 * works if the billing endpoints are down or unconfigured.
 *
 * ## The token
 *
 * A short-lived HMAC blob minted by the Worker, sent on proxied requests so
 * the proxy can apply a supporter rate limit. It expires in 15 minutes and is
 * re-minted a couple of minutes early, so the app never presents a stale one.
 *
 * Held **in memory only**, deliberately. It is a bearer credential, it is
 * cheap to re-mint from the WorkOS session, and writing it to `localStorage`
 * would put a spendable token somewhere any script on this origin can read it
 * — the same reasoning that keeps AuthKit's own tokens out of web storage. It
 * also means this service registers no storage key, so the export
 * classification in `portable-config.ts` is untouched.
 *
 * ## Failure posture
 *
 * Every failure resolves to "no token", never an exception into the caller.
 * The proxy treats an absent token as the free tier, so the worst outcome of
 * anything going wrong here is that a supporter is briefly rate-limited like
 * everyone else — which is a degraded experience, not a broken one.
 */

/** How long before expiry to re-mint. Two minutes of slack on a 15-minute token. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

/** The proxy's own origin. Not the app's, and not a configured route. */
const PROXY_BASE = 'https://mawkingbird-cors-proxy.matthewdeanmartin.workers.dev';

/** What the Worker returns from `/plus/token`. */
interface TokenResponse {
  token: string;
  /** Unix *seconds*, as the Worker mints it. */
  expiresAt: number;
  tier: 'free' | 'plus';
  subscription: { renewsAt: number; cancelAtPeriodEnd: boolean } | null;
}

interface CheckoutResponse {
  url: string;
}

/** A minted token and when it stops being usable. */
interface HeldToken {
  value: string;
  /** Epoch **milliseconds**, converted on receipt. */
  expiresAtMs: number;
}

/** The subscription, as the account page needs to describe it. */
export interface SupporterSubscription {
  /** Epoch ms when the paid period ends. */
  renewsAt: number;
  /** True when cancelled but still inside the paid period. */
  cancelAtPeriodEnd: boolean;
}

/**
 * A message worth showing someone who just pressed "Support Mawkingbird".
 *
 * The Worker's own error strings are relayed verbatim, and that is safe by
 * construction: every one of them is written for a person to read, and the
 * Worker deliberately refuses to pass Stripe's raw message through (which
 * could name the account or the key). Suppressing them — as the first version
 * of this did — meant a misconfigured deployment reported nothing but "please
 * try again", and the real cause ("Subscriptions are not configured on this
 * deployment") was only visible in the network tab. That is not an error
 * message, it is a scavenger hunt.
 *
 * Statuses are mapped where the raw text would leave someone stuck:
 *
 * - **503** is an operator fault, not a user one. Saying "try again" invites
 *   someone to keep pressing a button that cannot work.
 * - **0** is the browser's status for a request that never completed —
 *   offline, DNS failure, a blocked request. There is no server message to
 *   relay because no server was reached.
 */
export function checkoutErrorMessage(error: unknown): string {
  const fallback = 'Could not start checkout. Please try again.';
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  if (error.status === 0) {
    return 'Could not reach the subscription service. Check your connection and try again.';
  }

  const relayed =
    typeof error.error === 'object' && error.error !== null && 'error' in error.error
      ? String((error.error as { error: unknown }).error)
      : '';

  if (error.status === 503) {
    return relayed
      ? `${relayed} This is a problem with the service, not with you — nothing was charged.`
      : 'Subscriptions are unavailable on this deployment right now. Nothing was charged.';
  }

  return relayed || `${fallback} (HTTP ${error.status})`;
}

@Injectable({ providedIn: 'root' })
export class PlusSession {
  private http = inject(HttpClient);
  private workos = inject(WorkosSession);

  /** The caller's tier, as last minted. */
  readonly tier = signal<'free' | 'plus'>('free');

  /** The subscription, or null when there has never been one. */
  readonly subscription = signal<SupporterSubscription | null>(null);

  /** The last billing failure, for the account page to surface. */
  readonly error = signal<string | null>(null);

  /** True while a checkout is being started. */
  readonly startingCheckout = signal(false);

  /** Whether this account currently gets supporter benefits. */
  readonly isSupporter = computed(() => this.tier() === 'plus');

  private held: HeldToken | null = null;

  /** An in-flight mint, shared so concurrent callers make one request. */
  private minting: Promise<string | null> | null = null;

  /**
   * A usable proxy token, minting or refreshing as needed.
   *
   * Returns null whenever one cannot be had — signed out, endpoint down,
   * accounts unconfigured. Callers attach it when present and simply omit it
   * otherwise; the proxy reads an absent token as the free tier.
   */
  async token(): Promise<string | null> {
    if (this.held && this.held.expiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
      return this.held.value;
    }
    // Deduplicated: several proxied requests can start at once, and each
    // minting its own token would spend the endpoint's rate limit on itself.
    this.minting ??= this.mint().finally(() => {
      this.minting = null;
    });
    return this.minting;
  }

  /**
   * Re-mint now, discarding any held token.
   *
   * Called after returning from checkout, so a new supporter sees their tier
   * immediately rather than waiting up to fifteen minutes for the next
   * refresh.
   */
  async refresh(): Promise<void> {
    this.held = null;
    await this.token();
  }

  /** Forget everything. Called on sign-out. */
  clear(): void {
    this.held = null;
    this.tier.set('free');
    this.subscription.set(null);
    this.error.set(null);
  }

  /**
   * Start a subscription: ask the Worker for a Checkout URL and go there.
   *
   * The return URL is this deployment's account page, so a canary tester comes
   * back to canary. The Worker validates it against its own origin allowlist
   * before handing it to Stripe.
   */
  async startCheckout(): Promise<void> {
    const accessToken = await this.workos.accessToken();
    if (!accessToken) {
      this.error.set('Sign in before subscribing.');
      return;
    }

    this.error.set(null);
    this.startingCheckout.set(true);
    try {
      const response = await firstValueFrom(
        this.http.post<CheckoutResponse>(
          `${PROXY_BASE}/plus/checkout`,
          { returnTo: accountPageUrl() },
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            context: externalFetch(),
          },
        ),
      );
      if (!response?.url) {
        this.error.set('Could not start checkout. Please try again.');
        return;
      }
      location.assign(response.url);
    } catch (error: unknown) {
      this.error.set(checkoutErrorMessage(error));
    } finally {
      this.startingCheckout.set(false);
    }
  }

  private async mint(): Promise<string | null> {
    const accessToken = await this.workos.accessToken();
    if (!accessToken) {
      this.tier.set('free');
      this.subscription.set(null);
      return null;
    }

    try {
      const response = await firstValueFrom(
        this.http.post<TokenResponse>(
          `${PROXY_BASE}/plus/token`,
          {},
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            // Never the Mastodon interceptor's business: this is a foreign
            // host, and attaching the instance token here would leak it.
            context: externalFetch(),
          },
        ),
      );
      if (!response?.token) {
        return null;
      }

      this.tier.set(response.tier);
      this.subscription.set(
        response.subscription
          ? {
              // Seconds on the wire, milliseconds in the app. Converting here
              // keeps every consumer on one unit.
              renewsAt: response.subscription.renewsAt * 1000,
              cancelAtPeriodEnd: response.subscription.cancelAtPeriodEnd,
            }
          : null,
      );
      this.held = { value: response.token, expiresAtMs: response.expiresAt * 1000 };
      return this.held.value;
    } catch {
      // Not surfaced as an error: failing to mint means free-tier limits, and
      // the app keeps working. Only checkout failures are worth telling
      // someone about, because those are the ones they asked for.
      return null;
    }
  }
}
