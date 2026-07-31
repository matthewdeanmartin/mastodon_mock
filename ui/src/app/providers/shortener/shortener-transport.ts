import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, tap, throwError, timer } from 'rxjs';
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
  /**
   * Keep this a CORS-*simple* request: send no header that would force the
   * browser to preflight it.
   *
   * Worth understanding before setting or clearing this. A cross-origin GET with
   * only safelisted headers is sent straight out, and the server needs nothing
   * but `Access-Control-Allow-Origin` on the response. Add one non-safelisted
   * header — `Accept: application/json` counts — and the browser must first send
   * an `OPTIONS` preflight, which the server has to answer with a matching
   * `Access-Control-Allow-Headers`. A server can therefore be perfectly
   * CORS-friendly and *still* fail, purely because we asked for a header it does
   * not list in its preflight response.
   *
   * That is exactly is.gd: it returns `Access-Control-Allow-Origin: *`, but its
   * `OPTIONS` reply carries no `Access-Control-Allow-Headers`, so adding `Accept`
   * broke a request that works fine without it. The browser reports this as
   * "ACAO missing" with `Status code: 200` — blocked despite a success status,
   * which is the signature of a failed preflight rather than a blocked response.
   *
   * Providers that select JSON through the query string (is.gd's `format=json`)
   * lose nothing by omitting `Accept`. Providers behind an `Authorization`
   * header are preflighted no matter what, so this flag would buy them nothing.
   */
  simpleRequest?: boolean;
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
  /**
   * Which leg the most recent {@link request} succeeded on.
   *
   * Exists for {@link ShortenerReachability}, which has to report "worked
   * directly" versus "needed the proxy" and cannot otherwise tell: both come back
   * as an ordinary success. Deliberately not part of the observable's value —
   * every caller but the probe wants the response, not the route it took.
   */
  lastRouteUsed: 'direct' | 'proxy' | null = null;

  request<T>(provider: ShortenerId, spec: ShortenerRequest): Observable<T> {
    this.lastRouteUsed = null;
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
      this.send<T>(provider, spec, spec.url, this.authHeaders(config.auth, spec)).pipe(
        tap(() => (this.lastRouteUsed = 'direct')),
      );

    return direct().pipe(
      catchError((error: unknown) => {
        if (!looksCorsBlocked(error)) {
          return throwError(() => toLinkProviderError(error, provider, spec.hints));
        }
        return this.viaProxy<T>(provider, spec, config.auth);
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

  /**
   * The proxy leg, taken only after a direct request came back `status: 0`.
   *
   * `auth` being null is the interesting case. A request with no credential —
   * is.gd, or TinyURL before a token is added — has nothing to disclose to the
   * proxy operator, so it skips the consent gate entirely and goes through the
   * *ordinary* proxy path, the same one an RSS feed uses. Asking someone to
   * accept the risk of leaking a key they do not have would be a lie, and it
   * would train them to click through the dialog that matters.
   */
  private viaProxy<T>(
    provider: ShortenerId,
    spec: ShortenerRequest,
    auth: { header: string; value: string } | null,
  ): Observable<T> {
    const entry = this.proxy.entry();
    if (!entry || !this.proxy.available()) {
      return throwError(() => new ProxyConsentRequired(provider, true));
    }

    const carriesCredential = auth !== null;
    if (carriesCredential && !this.consent.granted(provider, entry.id)) {
      return throwError(() => new ProxyConsentRequired(provider, false));
    }

    let proxied: { url: string; headers: HttpHeaders };
    try {
      proxied = carriesCredential
        ? this.proxy.proxyCredentialedRequest(spec.url, true)
        : this.proxy.proxyRequest(spec.url);
    } catch (error: unknown) {
      // A refusal here is a genuine safety stop (mixed content, userinfo), not
      // a missing consent — surface it as the error it is.
      const message =
        error instanceof CorsProxyRefusal ? error.message : 'This request cannot be proxied.';
      return throwError(() => new LinkProviderError('CORS_BLOCKED', message, provider));
    }

    // The proxy's own key rides alongside the provider's, when there is one:
    // each authenticates us to a different party.
    let headers = this.authHeaders(auth, spec);
    proxied.headers.keys().forEach((name) => {
      const value = proxied.headers.get(name);
      if (value) {
        headers = headers.set(name, value);
      }
    });

    const proxyLabel = entry.label;
    return this.send<T>(provider, spec, proxied.url, headers).pipe(
      tap(() => (this.lastRouteUsed = 'proxy')),
      catchError((error: unknown) =>
        throwError(() => this.proxyLegError(error, provider, spec, proxyLabel)),
      ),
    );
  }

  /**
   * Turn a failure on the *proxy* leg into an error that blames the right party.
   *
   * Without this, a proxy that is overloaded, has shut down, or is answering with
   * an HTML error page gets reported as though the shortener rejected the
   * request — which sends the user off to check an API key that was never the
   * problem. The proxy is a hop the user added, so when the hop is what broke,
   * the message says so and names it.
   *
   * The two shapes worth separating:
   *
   * - A `5xx` from the proxy host. The request never reached the shortener, so
   *   nothing about the shortener can be concluded.
   * - A `status: 0`, i.e. the proxy leg *also* died before any response. The
   *   usual cause is the proxy returning an error page without CORS headers, so
   *   the browser blocks its response too and we learn nothing at all.
   *
   * Anything else — a real `4xx` carrying the shortener's own body — is passed
   * through untouched, because that genuinely is the shortener answering.
   */
  private proxyLegError(
    error: unknown,
    provider: ShortenerId,
    spec: ShortenerRequest,
    proxyLabel: string,
  ): LinkProviderError {
    if (error instanceof HttpErrorResponse && error.status >= 500) {
      return new LinkProviderError(
        'PROVIDER_UNAVAILABLE',
        `The CORS proxy (${proxyLabel}) failed with a ${error.status}, so the request never reached the shortener. The proxy may be overloaded or down — try again, or pick a different proxy in Settings.`,
        provider,
        error.status,
      );
    }
    if (looksCorsBlocked(error)) {
      return new LinkProviderError(
        'CORS_BLOCKED',
        `The CORS proxy (${proxyLabel}) could not be reached, or answered without the CORS headers a browser needs — an error page instead of data would do that. Check the proxy in Settings, or try a different one.`,
        provider,
      );
    }
    return toLinkProviderError(error, provider, spec.hints);
  }

  private authHeaders(
    auth: { header: string; value: string } | null,
    spec: ShortenerRequest,
  ): HttpHeaders {
    // `Accept` is not on the CORS safelist for this value, so setting it forces a
    // preflight. Omitted when the caller asked to stay simple — see
    // {@link ShortenerRequest.simpleRequest}.
    let headers = spec.simpleRequest
      ? new HttpHeaders()
      : new HttpHeaders().set('Accept', 'application/json');
    if (auth) {
      // The header name is the provider's, not always `Authorization`:
      // Rebrandly reads a bespoke `apikey`.
      headers = headers.set(auth.header, auth.value);
    }
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
