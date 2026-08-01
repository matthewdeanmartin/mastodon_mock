import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';
import { PageDiagnostics } from '../../page-diagnostics';
import { CorsProxy, CorsProxyRefusal } from '../cors-proxy/cors-proxy';
import { externalFetch } from '../external-fetch';
import { ProxyConsent } from '../proxy-consent-store';
import { providerErrorInBody, toTwitterApiError, TwitterApiError } from './twitter-errors';
import { TwitterConfig, TwitterSettings } from './twitter-settings';
import { TwitterSourceId } from './twitter-source';
import { TwitterUsage } from './twitter-usage';

/**
 * The one place an X data request is actually sent.
 *
 * ## Why this is proxy-*first*, unlike every other transport here
 *
 * {@link ShortenerTransport} tries direct on every request and falls back to a
 * proxy on failure, because shorteners genuinely vary — some answer browsers.
 * These services provably never will, and the reason is structural rather than
 * a policy that might soften:
 *
 * > Authentication is a custom header (`X-API-Key` / `Authorization`), which
 * > forces a CORS preflight. TwitterAPI.io answers that preflight with **401 and
 * > no `Access-Control-Allow-Origin`**, because it demands the API key on the
 * > preflight itself — which a browser is forbidden to send. There is no
 * > query-parameter auth to fall back to; all three plausible spellings 403.
 *
 * Measured 2026-07-31; see `sprint/twitter-1-transport.md`. So a direct attempt
 * is not a fallback worth trying, it is a guaranteed failure that costs seconds
 * of the user's time before every real request.
 *
 * The direct path therefore exists in exactly one place — {@link probeDirect},
 * called by the connector page's Test button — so that "this service refuses
 * browsers" is something the user *watches happen* rather than a claim the app
 * makes. The verdict is recorded and never re-derived per request.
 *
 * ## What that means for consent
 *
 * Because the proxy is the only route, refusing consent does not degrade the
 * feature — it disables it. The connector page has to say that plainly, and
 * {@link TwitterProxyRequired} carries the distinction between "no proxy
 * configured" and "not consented yet" so it can.
 */

/** Thrown when a request cannot proceed until the user configures or consents. */
export class TwitterProxyRequired extends Error {
  constructor(
    readonly source: TwitterSourceId,
    /** True when no usable proxy is configured at all. */
    readonly noProxyConfigured: boolean,
  ) {
    super(
      noProxyConfigured
        ? 'X data services refuse direct browser requests, and no CORS proxy is configured.'
        : 'Sending your X API key through the CORS proxy needs your consent.',
    );
    this.name = 'TwitterProxyRequired';
  }
}

export interface TwitterRequest {
  /** Path under the source's base URL, e.g. `/twitter/user/info`. */
  path: string;
  /** Query parameters. Values are encoded exactly once. */
  params?: Record<string, string | number | undefined>;
}

const MAX_RETRIES = 2;

@Injectable({ providedIn: 'root' })
export class TwitterTransport {
  private http = inject(HttpClient);
  private settings = inject(TwitterSettings);
  private proxy = inject(CorsProxy);
  private consent = inject(ProxyConsent);
  private usage = inject(TwitterUsage);
  private diagnostics = inject(PageDiagnostics);

  /**
   * Send an authenticated read to the active source, through the proxy.
   *
   * @throws TwitterApiError for anything the caller should show as a failure.
   * @throws TwitterProxyRequired when the caller should configure or ask first.
   */
  request<T>(spec: TwitterRequest): Observable<T> {
    const config = this.settings.resolve();
    if (!config) {
      return throwError(
        () =>
          new TwitterApiError(
            'INVALID_CONFIGURATION',
            this.settings.blockedReason() ?? 'No X data service is configured.',
            this.settings.activeId() ?? 'twitterapi-io',
          ),
      );
    }

    // Checked before anything is sent. A daily hard limit that only reported
    // afterwards would be a receipt, not a limit.
    if (this.usage.check(1) === 'hard-limit') {
      return throwError(
        () =>
          new TwitterApiError(
            'INVALID_CONFIGURATION',
            `You have reached your daily limit of ${this.usage.hardLimit()} X data requests. ` +
              'It resets at midnight, or you can raise it on the X connector page.',
            config.entry.id,
          ),
      );
    }

    const targetUrl = buildUrl(config, spec);
    const entry = this.proxy.entry();

    // Nothing is sent — not even a doomed direct attempt — until there is a
    // consented proxy. This is the "costs nothing to be unconfigured" property.
    if (!entry || !this.proxy.available()) {
      return throwError(() => new TwitterProxyRequired(config.entry.id, true));
    }
    if (!this.consent.granted(config.entry.id, entry.id)) {
      return throwError(() => new TwitterProxyRequired(config.entry.id, false));
    }

    let proxied: { url: string; headers: HttpHeaders };
    try {
      // Credentialed: the key rides through the proxy, which is exactly what the
      // consent above was for. Every other guard (mixed content, userinfo, the
      // user's own instance) still applies.
      proxied = this.proxy.proxyCredentialedRequest(targetUrl, true);
    } catch (error: unknown) {
      const message =
        error instanceof CorsProxyRefusal ? error.message : 'This request cannot be proxied.';
      return throwError(() => new TwitterApiError('CORS_UNAVAILABLE', message, config.entry.id));
    }

    // Two credentials on one request, authenticating us to two different
    // parties: the source's key, and the proxy's own.
    let headers = new HttpHeaders().set(config.auth.header, config.auth.value);
    proxied.headers.keys().forEach((name) => {
      const value = proxied.headers.get(name);
      if (value) {
        headers = headers.set(name, value);
      }
    });

    const proxyLabel = entry.label;
    const startedAt = Date.now();
    // Counted at send time, not on success. A request that fails, times out, or
    // is retried has still been received and billed by the provider — counting
    // only successes would under-report exactly when things are going wrong,
    // which is when an accurate number matters most.
    this.usage.record(1);
    this.diagnostics.info('Twitter', 'request:start', {
      source: config.entry.id,
      path: spec.path,
      proxy: proxyLabel,
    });

    return this.send<T>(config, proxied.url, headers, proxyLabel).pipe(
      map((body) => {
        // HTTP 200 is not success here — see providerErrorInBody. A proxy can
        // relay a 403 body under its own 200, which is precisely what AllOrigins
        // was observed doing.
        const embedded = providerErrorInBody(body, config.entry.id);
        if (embedded) {
          throw embedded;
        }
        this.diagnostics.info('Twitter', 'request:success', {
          source: config.entry.id,
          path: spec.path,
          ms: Date.now() - startedAt,
        });
        return body;
      }),
      catchError((error: unknown) => {
        const normalized = toTwitterApiError(error, config.entry.id, {
          viaProxy: true,
          proxyLabel,
        });
        this.diagnostics.error('Twitter', 'request:error', normalized, {
          source: config.entry.id,
          path: spec.path,
          code: normalized.code,
          ms: Date.now() - startedAt,
        });
        return throwError(() => normalized);
      }),
    );
  }

  /**
   * Attempt one *direct* request, so the user can watch it fail.
   *
   * The only unproxied call in this module. It exists to make the app's claim
   * checkable rather than asserted, and its result is recorded so it never has
   * to run again. Costs one billable request when it does reach the service.
   *
   * Emits `true` if the browser somehow reached the service. If these providers
   * ever fix their preflight, this is what will notice.
   */
  probeDirect(spec: TwitterRequest): Observable<boolean> {
    const config = this.settings.resolve();
    if (!config) {
      return throwError(
        () =>
          new TwitterApiError(
            'INVALID_CONFIGURATION',
            this.settings.blockedReason() ?? 'No X data service is configured.',
            this.settings.activeId() ?? 'twitterapi-io',
          ),
      );
    }
    // Counted like any other. It usually dies at the preflight without reaching
    // the service — and so usually costs nothing — but the app cannot observe
    // which happened, and over-counting a request that might have been billed
    // is the safe direction for a spend counter.
    this.usage.record(1);
    return this.http
      .get<unknown>(buildUrl(config, spec), {
        headers: new HttpHeaders().set(config.auth.header, config.auth.value),
        context: externalFetch(),
      })
      .pipe(
        map((body) => providerErrorInBody(body, config.entry.id) === null),
        catchError(() => {
          // Any failure means "not reachable directly". Deliberately not
          // distinguishing causes: the browser will not say, and a guessed
          // cause is worse than an honest "could not reach it".
          return [false];
        }),
      );
  }

  /** Whether a proxy is configured and consented for the active source. */
  proxyPosture(): { configured: boolean; consented: boolean; selfHosted: boolean } {
    const entry = this.proxy.entry();
    const active = this.settings.activeId();
    return {
      configured: this.proxy.available(),
      consented: entry && active ? this.consent.granted(active, entry.id) : false,
      selfHosted: this.proxy.isSelfHosted(),
    };
  }

  /**
   * Issue one request, retrying only the transient cases.
   *
   * Conservative by design (spec §11): these calls cost money, and a timed-out
   * request may already have been billed, so a retry must never be a guess.
   */
  private send<T>(
    config: TwitterConfig,
    url: string,
    headers: HttpHeaders,
    proxyLabel: string,
  ): Observable<T> {
    return this.http.get<T>(url, { headers, context: externalFetch() }).pipe(
      retry({
        count: MAX_RETRIES,
        delay: (error: unknown, attempt: number) => {
          const normalized = toTwitterApiError(error, config.entry.id, {
            viaProxy: true,
            proxyLabel,
          });
          if (!normalized.transient) {
            return throwError(() => error);
          }
          // A retry is another billable request. Counting it keeps the total
          // honest, and — because `record` is what the hard limit reads — stops
          // a backoff loop from spending past the limit that was checked once
          // before the first attempt.
          this.usage.record(1);
          // Honour Retry-After; otherwise exponential backoff with full jitter,
          // capped at 8s per the spec.
          const base = normalized.retryAfterMs ?? Math.min(500 * 2 ** (attempt - 1), 8000);
          return timer(normalized.retryAfterMs ? base : Math.random() * base);
        },
      }),
    );
  }
}

/**
 * Build the absolute target URL.
 *
 * `URLSearchParams` rather than string concatenation, so a search query
 * containing `#`, `&` or a quoted phrase is encoded exactly once — the
 * double-encoding bug this repo has already been bitten by.
 */
export function buildUrl(config: TwitterConfig, spec: TwitterRequest): string {
  const url = new URL(spec.path, config.entry.baseUrl);
  for (const [name, value] of Object.entries(spec.params ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }
  return url.toString();
}
