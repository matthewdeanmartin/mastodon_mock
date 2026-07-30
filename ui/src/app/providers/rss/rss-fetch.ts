import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  catchError,
  defer,
  from,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { ClientPrefs } from '../../client-prefs';
import { CorsProxy } from '../cors-proxy/cors-proxy';
import { CorsProxyUsageStore } from '../cors-proxy/cors-proxy-usage';
import { externalFetch } from '../external-fetch';
import { RssCache } from './rss-cache';
import { ParsedFeed, parseFeed } from './rss-parser';

/**
 * Fetches and parses a feed, going to the network as rarely as it can.
 *
 * Direct from the browser by default, which is the only mode that involves
 * nobody but the reader and the publisher. Feeds whose hosts don't send CORS
 * headers can't be read that way; for those the user may opt *that feed* in to
 * the CORS proxy they configured, which is the only way this class ever uses
 * one. There is no automatic fallback: a proxy operator can read and rewrite
 * everything that passes through it, so routing traffic through one is a
 * decision the user makes per feed rather than a silent retry.
 *
 * ## Three layers stand between a caller and a request
 *
 * 1. **The persistent cache** ({@link RssCache}, IndexedDB). A feed fetched
 *    successfully is reused for {@link ClientPrefs.rssCacheTtlHours} — 24 hours
 *    by default.
 * 2. **In-flight sharing.** Concurrent callers for the same feed share one
 *    request. The global `dedupeInterceptor` deliberately skips external
 *    fetches, so without this the home timeline, a profile page and an article
 *    view opening together would each issue their own.
 * 3. **A failure cooldown.** After a failed attempt the feed is left alone for
 *    {@link FAILURE_COOLDOWN_MS} and the stale copy is served instead. This is
 *    what stops a throttled proxy from being hammered into staying throttled.
 *
 * Before this existed, opening one article cost at least two full feed
 * downloads (the item, then its comment feed) with nothing shared or retained —
 * which is how a free proxy's rate limit gets exhausted by ordinary reading.
 */
@Injectable({ providedIn: 'root' })
export class RssFetch {
  private http = inject(HttpClient);
  private corsProxy = inject(CorsProxy);
  private proxyUsage = inject(CorsProxyUsageStore);
  private cache = inject(RssCache);
  private prefs = inject(ClientPrefs);

  /**
   * Requests currently on the wire, by feed URL.
   *
   * Keyed on the *feed* URL rather than the proxied request URL so a direct and
   * a proxied caller for the same feed still share, and so the entry survives a
   * proxy configuration change mid-flight.
   */
  private inFlight = new Map<string, Observable<ParsedFeed>>();

  /**
   * Fetch and parse one feed.
   *
   * @param options.useProxy Route through the configured CORS proxy. Only ever
   * set from a subscription's own opt-in flag, or from the user explicitly
   * retrying a feed that just failed.
   *
   * A refusal from the proxy guard propagates rather than falling back to a
   * direct fetch: it means the guard rejected this target, which the user needs
   * to see.
   */
  fetchFeed(
    url: string,
    options: { useProxy?: boolean; forceRefresh?: boolean; noCache?: boolean } = {},
  ): Observable<ParsedFeed> {
    // `noCache` is for one-off reads of URLs that are not subscriptions — the
    // anonymous provider's `<profile>.rss` fallback, which has its own
    // per-follow deferral and would otherwise fill the cache with entries no
    // feed list ever refers to.
    if (options.noCache) {
      return this.buildRequest(url, options);
    }

    const ttlMs = options.forceRefresh ? 0 : this.prefs.rssCacheTtlHours() * 60 * 60 * 1000;

    // `defer` so the cache lookup happens per subscription rather than at call
    // time — callers build these observables and subscribe later.
    return defer(() =>
      from(this.cache.get(url, ttlMs)).pipe(
        switchMap((cached) => {
          if (cached && !cached.stale) {
            return of(cached.feed);
          }
          return from(this.shouldSkipNetwork(url, options.forceRefresh === true)).pipe(
            switchMap((skip) => {
              // Throttled or recently failed: the stale copy is the best answer
              // available, and going to the network would only deepen the hole.
              if (skip && cached) {
                return of(cached.feed);
              }
              return this.networkFetch(url, options).pipe(
                catchError((error: unknown) => {
                  // Serving day-old articles beats showing an error, so a stale
                  // copy wins over a failure — but only after the failure has
                  // been recorded, so the cooldown actually engages.
                  //
                  // A proxy *refusal* is the exception: it means the guard or
                  // the configuration rejected this feed, which is the user's
                  // to fix and must not be masked by stale content.
                  if (cached && !isConfigurationError(error)) {
                    return of(cached.feed);
                  }
                  return throwError(() => error);
                }),
              );
            }),
          );
        }),
      ),
    );
  }

  /** Whether a recent failure means this feed should be left alone for now. */
  private async shouldSkipNetwork(url: string, forceRefresh: boolean): Promise<boolean> {
    if (forceRefresh) {
      return false;
    }
    return this.cache.inCooldown(url);
  }

  /**
   * Go to the network for this feed, sharing one request between concurrent
   * callers and writing the result to the cache.
   */
  private networkFetch(url: string, options: { useProxy?: boolean }): Observable<ParsedFeed> {
    const existing = this.inFlight.get(url);
    if (existing) {
      return existing;
    }

    const request = this.buildRequest(url, options).pipe(
      switchMap((feed) => from(this.cache.put(url, feed)).pipe(map(() => feed))),
      catchError((error: unknown) => {
        // A misconfigured proxy is not the feed failing, so it must not start a
        // cooldown — the user fixes the setting and expects the next try to go.
        if (isConfigurationError(error)) {
          return throwError(() => error);
        }
        return from(this.cache.markFailure(url)).pipe(switchMap(() => throwError(() => error)));
      }),
      // The in-flight entry must be dropped however the request ends, or one
      // failure would be replayed to every later caller.
      tap({
        complete: () => this.inFlight.delete(url),
        error: () => this.inFlight.delete(url),
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.inFlight.set(url, request);
    return request;
  }

  private buildRequest(url: string, options: { useProxy?: boolean }): Observable<ParsedFeed> {
    const viaProxy = options.useProxy === true;

    let requestUrl = url;
    let headers: HttpHeaders | undefined;
    if (viaProxy) {
      try {
        const proxied = this.corsProxy.proxyRequest(url);
        requestUrl = proxied.url;
        headers = proxied.headers;
      } catch (error: unknown) {
        return throwError(() =>
          error instanceof Error ? error : new Error('This feed cannot be proxied.'),
        );
      }
    }

    return this.http
      .get(requestUrl, {
        responseType: 'text',
        context: externalFetch(),
        ...(headers ? { headers } : {}),
      })
      .pipe(
        tap({
          next: () => viaProxy && this.proxyUsage.record(true),
          error: () => viaProxy && this.proxyUsage.record(false),
        }),
        map((xml) => parseFeed(xml)),
        catchError((err: unknown) => throwError(() => new Error(describe(err, viaProxy)))),
      );
  }
}

/**
 * Whether an error is the app's own configuration refusing, rather than the
 * network failing.
 *
 * These must reach the user unchanged: they are fixed by editing a setting, and
 * hiding one behind a stale cached copy would leave someone staring at
 * yesterday's articles wondering why their new proxy never took effect.
 */
function isConfigurationError(error: unknown): boolean {
  // Matched by name rather than `instanceof` so this module needn't import the
  // cors-proxy package just for a type guard.
  return error instanceof Error && error.name === 'CorsProxyRefusal';
}

function describe(err: unknown, viaProxy: boolean): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return viaProxy
        ? "Couldn't reach this feed through the CORS proxy either. The proxy may be down, " +
            'rate-limiting you, or refusing this address — check it on Settings → ' +
            'Connections → CORS proxy.'
        : "Couldn't reach this feed from the browser. Either the address is wrong or the " +
            "site doesn't allow cross-origin (CORS) access. Mockingbird has no server of " +
            'its own, so a blocked feed can only be read through a CORS proxy — you can set ' +
            'one up on Settings → Connections → CORS proxy, then turn it on for this feed.';
    }
    if (viaProxy && (err.status === 401 || err.status === 403)) {
      return `The CORS proxy rejected the request (${err.status}). It probably needs an API key, or the key it has is wrong or out of quota.`;
    }
    if (viaProxy && err.status === 429) {
      return 'The CORS proxy is rate-limiting you. Wait a little, or switch to a proxy you hold a key for.';
    }
    return viaProxy
      ? `The CORS proxy answered ${err.status}.`
      : `The feed's server answered ${err.status}.`;
  }
  return err instanceof Error ? err.message : 'Unknown error reading the feed.';
}
