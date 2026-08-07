import { inject, Injectable } from '@angular/core';
import { CorsProxy, CorsProxyRefusal } from '../cors-proxy/cors-proxy';
import { resolveEndpoint } from './webmention-discovery';

/**
 * Telling the other site that you linked to it.
 *
 * **Most sends will report `no-endpoint`, and that is the correct outcome, not
 * a failure.** Mastodon does not accept webmentions — it federates over
 * ActivityPub, which has native Like and Announce activities, so there is no
 * gap for webmention to fill. Bluesky does not either, and neither do RSS items
 * or tweets. The audience that does is people running indieweb blogs.
 *
 * That shapes the UI more than the code: a red error on every Mastodon like
 * would train the user to ignore the feature within a day. `no-endpoint` is a
 * neutral state meaning *your record is published; there was nobody to notify*.
 *
 * ## Why this needs the CORS proxy
 *
 * Both halves — reading a stranger's HTML to find their endpoint, and POSTing
 * to it — are cross-origin requests to arbitrary hosts with no CORS contract
 * with anyone. Neither works from a browser directly.
 *
 * Unusually for this app, that is close to harmless here: a webmention carries
 * two public URLs and no secret whatsoever, so it goes through the
 * *uncredentialed* {@link CorsProxy.proxyRequest} path, which refuses to carry
 * credentials by construction. No consent dialog is needed because there is
 * nothing to consent to disclosing — unlike Mataroa, where the proxy sees an
 * API key.
 */
export type DeliveryState =
  /** Checked; the target does not accept webmentions. The normal case. */
  | 'no-endpoint'
  /** The endpoint returned 2xx — accepted for verification, not "verified". */
  | 'delivered'
  /** Reachable, and refused it. */
  | 'failed'
  /** No proxy able to make this request is configured. */
  | 'unsupported';

export interface DeliveryResult {
  state: DeliveryState;
  /** The endpoint we found, when we found one. */
  endpoint: string | null;
  /** One sentence for the UI. Never dresses `no-endpoint` up as success. */
  message: string;
}

@Injectable({ providedIn: 'root' })
export class WebmentionSend {
  private readonly proxy = inject(CorsProxy);

  /**
   * Per-batch endpoint memo.
   *
   * Several queued entries often target the same host, and discovering the same
   * endpoint five times is five requests to a stranger's site. Deliberately
   * **not** persisted: caching "this site has no endpoint" across sessions
   * would quietly outlive the day someone adds one.
   */
  private readonly cache = new Map<string, string | null>();

  /** Forget memoised endpoints. Called between batches. */
  resetCache(): void {
    this.cache.clear();
  }

  /**
   * Discover the target's endpoint and, if it has one, notify it.
   *
   * `source` is the URL on *your* site carrying the record — it must already be
   * live, because a conscientious receiver fetches it to verify the link. The
   * caller waits for the site build before getting here.
   */
  async send(targetUrl: string, sourceUrl: string): Promise<DeliveryResult> {
    let endpoint: string | null;
    try {
      endpoint = await this.discover(targetUrl);
    } catch (error: unknown) {
      if (error instanceof CorsProxyRefusal) {
        return {
          state: 'unsupported',
          endpoint: null,
          message: 'Set up a CORS proxy to send webmentions. Your record is published either way.',
        };
      }
      // Could not read the page at all — offline, DNS, a 500. We genuinely do
      // not know whether it accepts webmentions, and guessing "failed" would
      // overstate it.
      return {
        state: 'no-endpoint',
        endpoint: null,
        message: 'Could not check whether this site accepts webmentions.',
      };
    }

    if (!endpoint) {
      return {
        state: 'no-endpoint',
        endpoint: null,
        message: 'This site does not accept webmentions. Your record is published.',
      };
    }

    return this.deliver(endpoint, targetUrl, sourceUrl);
  }

  private async discover(targetUrl: string): Promise<string | null> {
    const cached = this.cache.get(targetUrl);
    if (cached !== undefined) {
      return cached;
    }
    // Throws CorsProxyRefusal when nothing is configured, which `send` maps to
    // `unsupported` rather than swallowing.
    const proxied = this.proxy.proxyRequest(targetUrl);
    const response = await fetch(proxied.url, {
      headers: toHeaderRecord(proxied.headers),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const endpoint = resolveEndpoint(
      targetUrl,
      response.headers.get('Link'),
      await response.text(),
    );
    this.cache.set(targetUrl, endpoint);
    return endpoint;
  }

  private async deliver(
    endpoint: string,
    targetUrl: string,
    sourceUrl: string,
  ): Promise<DeliveryResult> {
    let proxied: { url: string; headers: unknown };
    try {
      proxied = this.proxy.proxyRequest(endpoint);
    } catch {
      return {
        state: 'unsupported',
        endpoint,
        message: 'This webmention cannot be sent through the configured proxy.',
      };
    }

    const body = new URLSearchParams({ source: sourceUrl, target: targetUrl });
    let response: Response;
    try {
      response = await fetch(proxied.url, {
        method: 'POST',
        headers: {
          ...toHeaderRecord(proxied.headers),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch {
      // A proxy that will not forward a POST at all — AllOrigins, for one — is
      // a configuration limit, not the target refusing. Reporting it as
      // `failed` would blame the wrong party.
      return {
        state: 'unsupported',
        endpoint,
        message:
          'The configured CORS proxy cannot send this. Choose one that forwards POST requests.',
      };
    }

    if (response.ok) {
      // Many endpoints return 202 and verify asynchronously, so this means
      // "accepted for processing", never "verified". The copy says so.
      return {
        state: 'delivered',
        endpoint,
        message: 'Webmention accepted — the other site will verify it shortly.',
      };
    }
    return {
      state: 'failed',
      endpoint,
      message: `That site's webmention endpoint refused this (HTTP ${response.status}).`,
    };
  }
}

/** `HttpHeaders`-ish to a plain record, since this uses `fetch` not HttpClient. */
function toHeaderRecord(headers: unknown): Record<string, string> {
  const source = headers as { keys?: () => string[]; get?: (key: string) => string | null };
  if (typeof source?.keys !== 'function' || typeof source.get !== 'function') {
    return {};
  }
  const record: Record<string, string> = {};
  for (const key of source.keys()) {
    const value = source.get(key);
    if (value !== null) {
      record[key] = value;
    }
  }
  return record;
}
