import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, tap, throwError } from 'rxjs';
import { CorsProxy } from '../cors-proxy/cors-proxy';
import { CorsProxyUsageStore } from '../cors-proxy/cors-proxy-usage';
import { externalFetch } from '../external-fetch';
import { ParsedFeed, parseFeed } from './rss-parser';

/**
 * Fetches and parses a feed.
 *
 * Direct from the browser by default, which is the only mode that involves
 * nobody but the reader and the publisher. Feeds whose hosts don't send CORS
 * headers can't be read that way; for those the user may opt *that feed* in to
 * the CORS proxy they configured, which is the only way this class ever uses
 * one. There is no automatic fallback: a proxy operator can read and rewrite
 * everything that passes through it, so routing traffic through one is a
 * decision the user makes per feed rather than a silent retry.
 */
@Injectable({ providedIn: 'root' })
export class RssFetch {
  private http = inject(HttpClient);
  private corsProxy = inject(CorsProxy);
  private proxyUsage = inject(CorsProxyUsageStore);

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
  fetchFeed(url: string, options: { useProxy?: boolean } = {}): Observable<ParsedFeed> {
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
