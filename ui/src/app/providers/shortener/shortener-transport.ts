import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';
import { CorsProxy, CorsProxyRefusal } from '../cors-proxy/cors-proxy';
import { externalFetch } from '../external-fetch';
import { ShortenerProxyConsent } from './proxy-consent';
import {
  LinkProviderError,
  looksCorsBlocked,
  ProviderErrorHints,
  toLinkProviderError,
} from './shortener-errors';
import { ShortenerSettings } from './shortener-settings';
import { ShortenerId } from './shortener-provider';

/**
 * The one place a shortener request is actually sent.
 *
 * Every adapter goes through {@link request}, which owns three concerns the
 * adapters should not each re-implement: authentication, the direct-then-proxy
 * decision, and retry policy.
 *
 * ## The direct-then-proxy decision
 *
 * These APIs are designed for server-to-server use, and most of them do not send
 * `Access-Control-Allow-Origin` to a browser. But "most" is not "all", it varies
 * per endpoint, and it changes over time — so this never assumes. It tries the
 * direct request first, every time. Only when the browser reports the
 * indistinguishable `status: 0` failure (CORS, DNS, or offline — the browser
 * deliberately will not say which) does the proxy come into play, and then only
 * if the user has already consented for this exact provider-and-proxy pair.
 *
 * When there is no consent on file this throws {@link ProxyConsentRequired},
 * which is not an error the page shows as a failure: it is the signal to ask.
 * The connect flow catches it, presents the disclosure, and re-runs the request
 * if the user accepts. That is why it carries the reason rather than being
 * flattened into a generic `CORS_BLOCKED`.
 *
 * ## Retry policy
 *
 * The spec is specific and this follows it: retry `429` and transient `5xx` with
 * backoff, and *never* retry a create. A retried create is the one operation
 * that can silently produce two links where the user asked for one, because a
 * timeout does not tell you whether the first attempt landed. Adapters mark
 * creates with `idempotent: false` and get one attempt.
 */

/** Thrown when a request needs the proxy and the user has not yet been asked. */
export class ProxyConsentRequired extends Error {
  constructor(
    readonly shortener: ShortenerId,
    /** True when no proxy is configured at all, so the ask is "go configure one". */
    readonly noProxyConfigured: boolean,
  ) {
    super(
      noProxyConfigured
        ? 'This service refuses direct browser requests, and no CORS proxy is configured.'
        : 'This service refuses direct browser requests. Sending your API key through the proxy needs your consent.',
    );
    this.name = 'ProxyConsentRequired';
  }
}

export interface ShortenerRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Absolute URL, query string included. */
  url: string;
  body?: unknown;
  /** Extra headers beyond authorization and content negotiation. */
  headers?: Record<string, string>;
  /**
   * Whether repeating this request is safe. Creates are never idempotent — see
   * the retry note above.
   */
  idempotent: boolean;
  /** Provider-specific error refinement. */
  hints?: ProviderErrorHints;
}

const MAX_RETRIES = 2;

@Injectable({ providedIn: 'root' })
export class ShortenerTransport {
  private http = inject(HttpClient);
  private settings = inject(ShortenerSettings);
  private proxy = inject(CorsProxy);
  private consent = inject(ShortenerProxyConsent);

  /**
   * Send an authenticated request to the active provider.
   *
   * @throws LinkProviderError for anything the caller should show as a failure.
   * @throws ProxyConsentRequired when the caller should ask, then retry.
   */
  request<T>(provider: ShortenerId, spec: ShortenerRequest): Observable<T> {
    const config = this.settings.resolve();
    if (!config) {
      return throwError(
        () =>
          new LinkProviderError(
            'AUTHENTICATION_FAILED',
            this.settings.blockedReason() ?? 'No link shortener is configured.',
            provider,
          ),
      );
    }

    const direct = () =>
      this.send<T>(provider, spec, spec.url, this.authHeaders(config.authorization, spec));

    return direct().pipe(
      catchError((error: unknown) => {
        if (!looksCorsBlocked(error)) {
          return throwError(() => toLinkProviderError(error, provider, spec.hints));
        }
        return this.viaProxy<T>(provider, spec, config.authorization);
      }),
    );
  }

  /**
   * Whether a proxy retry is possible right now, and what it would cost.
   *
   * Used by the connect flow to decide which disclosure to show *before* the
   * request is attempted a second time, so the dialog can name the operator.
   */
  proxyPosture(provider: ShortenerId): {
    configured: boolean;
    consented: boolean;
    selfHosted: boolean;
  } {
    const entry = this.proxy.entry();
    return {
      configured: this.proxy.available(),
      consented: entry ? this.consent.granted(provider, entry.id) : false,
      selfHosted: this.proxy.isSelfHosted(),
    };
  }

  private viaProxy<T>(
    provider: ShortenerId,
    spec: ShortenerRequest,
    authorization: string,
  ): Observable<T> {
    const entry = this.proxy.entry();
    if (!entry || !this.proxy.available()) {
      return throwError(() => new ProxyConsentRequired(provider, true));
    }
    if (!this.consent.granted(provider, entry.id)) {
      return throwError(() => new ProxyConsentRequired(provider, false));
    }

    let proxied: { url: string; headers: HttpHeaders };
    try {
      proxied = this.proxy.proxyCredentialedRequest(spec.url, true);
    } catch (error: unknown) {
      // A refusal here is a genuine safety stop (mixed content, userinfo), not
      // a missing consent — surface it as the error it is.
      const message =
        error instanceof CorsProxyRefusal ? error.message : 'This request cannot be proxied.';
      return throwError(() => new LinkProviderError('CORS_BLOCKED', message, provider));
    }

    // The proxy's own key rides alongside the provider's. Both are needed: one
    // authenticates us to the proxy, the other to the shortener.
    let headers = this.authHeaders(authorization, spec);
    proxied.headers.keys().forEach((name) => {
      const value = proxied.headers.get(name);
      if (value) {
        headers = headers.set(name, value);
      }
    });

    return this.send<T>(provider, spec, proxied.url, headers).pipe(
      catchError((error: unknown) =>
        throwError(() => toLinkProviderError(error, provider, spec.hints)),
      ),
    );
  }

  private authHeaders(authorization: string, spec: ShortenerRequest): HttpHeaders {
    let headers = new HttpHeaders()
      .set('Authorization', authorization)
      .set('Accept', 'application/json');
    for (const [name, value] of Object.entries(spec.headers ?? {})) {
      headers = headers.set(name, value);
    }
    return headers;
  }

  /**
   * Issue one HTTP request, with retry for the transient cases only.
   *
   * `externalFetch()` keeps the Mastodon auth interceptor from attaching the
   * instance token to a third-party host, and keeps the health interceptor from
   * treating a shortener outage as the Mastodon server being down.
   */
  private send<T>(
    provider: ShortenerId,
    spec: ShortenerRequest,
    url: string,
    headers: HttpHeaders,
  ): Observable<T> {
    const options = {
      headers,
      context: externalFetch(),
      // T.LY's DELETE carries a JSON body, which `HttpClient` supports only
      // through the generic `request` overload.
      body: spec.body,
    };

    const once = () =>
      this.http.request<T>(spec.method, url, options as never) as unknown as Observable<T>;

    if (!spec.idempotent) {
      return once();
    }

    return once().pipe(
      retry({
        count: MAX_RETRIES,
        delay: (error: unknown, attempt: number) => {
          const normalized = toLinkProviderError(error, provider, spec.hints);
          if (!normalized.transient) {
            return throwError(() => error);
          }
          // Honour Retry-After when the provider sent one; otherwise back off
          // exponentially from one second.
          const seconds = normalized.retryAfterSeconds ?? Math.min(2 ** (attempt - 1), 8);
          return timer(seconds * 1000);
        },
      }),
    );
  }
}
