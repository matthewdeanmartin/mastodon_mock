import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClientPrefs } from '../../client-prefs';
import { CorsProxySettings } from '../cors-proxy/cors-proxy-settings';
import { CorsProxyUsageStore } from '../cors-proxy/cors-proxy-usage';
import { Server } from '../../server';
import { CachedFeed, CachedFeedRecord, RssCache } from './rss-cache';
import { RssFetch } from './rss-fetch';
import { ParsedFeed } from './rss-parser';
import { enableProxyFlags } from '../../testing/enable-proxy-flags';

const FEED_XML = `<?xml version="1.0"?><rss><channel><title>A Feed</title></channel></rss>`;

/**
 * An in-memory stand-in for the IndexedDB cache.
 *
 * IndexedDB is not available in this environment, so the real cache would
 * silently no-op and none of the caching behaviour could be asserted. This
 * keeps the same async shape — every method returns a promise — so the timing
 * the production code has to cope with is still exercised.
 */
class FakeRssCache {
  records = new Map<string, CachedFeedRecord>();
  putCount = 0;

  /** Route key -> epoch ms until which that route is cooling down. */
  cooldowns = new Map<string, number>();

  async get(url: string, ttlMs: number): Promise<CachedFeed | null> {
    const record = this.records.get(url);
    // Mirrors the real cache: a record with no successful fetch is not a hit.
    if (!record || record.fetchedAt <= 0) {
      return null;
    }
    return {
      feed: record.feed,
      fetchedAt: record.fetchedAt,
      stale: ttlMs <= 0 || Date.now() - record.fetchedAt >= ttlMs,
    };
  }

  async inCooldown(key: string): Promise<boolean> {
    const until = this.cooldowns.get(key);
    return until !== undefined && Date.now() < until;
  }

  async put(url: string, feed: ParsedFeed): Promise<void> {
    this.putCount++;
    this.records.set(url, { url, feed, fetchedAt: Date.now() });
  }

  markFailure(key: string): void {
    this.cooldowns.set(key, Date.now() + 15 * 60 * 1000);
  }

  clearCooldown(key: string): void {
    this.cooldowns.delete(key);
  }

  async evict(url: string): Promise<void> {
    this.records.delete(url);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async entries(): Promise<CachedFeedRecord[]> {
    return [...this.records.values()];
  }

  /** Seed a successful read as though it happened `ageMs` ago. */
  seed(url: string, title: string, ageMs = 0): void {
    this.records.set(url, {
      url,
      feed: { title, link: null, items: [] },
      fetchedAt: Date.now() - ageMs,
    });
  }
}

/** Let the cache lookup's promise chain settle before asserting on requests. */
async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

describe('RssFetch', () => {
  let fetcher: RssFetch;
  let http: HttpTestingController;
  let settings: CorsProxySettings;
  let cache: FakeRssCache;

  beforeEach(() => {
    localStorage.clear();
    cache = new FakeRssCache();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RssCache, useValue: cache },
      ],
    });
    // These specs use a third-party proxy as the vehicle for testing proxy
    enableProxyFlags();
    fetcher = TestBed.inject(RssFetch);
    http = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(CorsProxySettings);
    TestBed.inject(Server).setBaseUrl('https://mastodon.social');
  });

  it('fetches straight from the publisher by default', async () => {
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('does not touch the proxy even when one is configured, unless asked', async () => {
    settings.select('allorigins');
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();
    // The whole point of per-feed opt-in: configuring a proxy must not silently
    // reroute every feed through it.
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('routes through the proxy when the feed opted in', async () => {
    settings.select('allorigins');
    fetcher.fetchFeed('https://example.com/feed.xml', { useProxy: true }).subscribe();
    await settle();
    http
      .expectOne('https://api.allorigins.win/raw?url=https%3A%2F%2Fexample.com%2Ffeed.xml')
      .flush(FEED_XML);
    http.verify();
  });

  it('sends the API key as the header the proxy documents', async () => {
    settings.select('corssh');
    settings.setKey('secret-key');
    fetcher.fetchFeed('https://example.com/feed.xml', { useProxy: true }).subscribe();
    await settle();

    const req = http.expectOne('https://proxy.cors.sh/https://example.com/feed.xml');
    expect(req.request.headers.get('x-cors-api-key')).toBe('secret-key');
    req.flush(FEED_XML);
  });

  // ------------------------------------------------------------- caching
  // Every request here is one a rate-limited CORS proxy would otherwise have
  // to serve, so each of these is a bug that cost real quota.

  it('serves a fresh cached feed without touching the network', async () => {
    cache.seed('https://example.com/feed.xml', 'Cached Feed');
    const feed = await new Promise<ParsedFeed>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe(resolve);
    });
    expect(feed.title).toBe('Cached Feed');
    // The whole point: no request at all.
    http.verify();
  });

  it('refetches once the cached copy is older than the TTL', async () => {
    // Default TTL is 24h; seed something two days old.
    cache.seed('https://example.com/feed.xml', 'Stale', 48 * 60 * 60 * 1000);
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('honours a shortened TTL from settings', async () => {
    TestBed.inject(ClientPrefs).setRssCacheTtlHours(1);
    cache.seed('https://example.com/feed.xml', 'Two hours old', 2 * 60 * 60 * 1000);
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('always refetches when the TTL is zero', async () => {
    TestBed.inject(ClientPrefs).setRssCacheTtlHours(0);
    cache.seed('https://example.com/feed.xml', 'Just cached');
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('forceRefresh bypasses a perfectly fresh cache entry', async () => {
    cache.seed('https://example.com/feed.xml', 'Fresh');
    fetcher.fetchFeed('https://example.com/feed.xml', { forceRefresh: true }).subscribe();
    await settle();
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('shares one request between concurrent callers of the same feed', async () => {
    // The global dedupe interceptor skips external fetches, so without the
    // in-flight map the timeline, a profile and an article opening together
    // would each issue their own request for the same feed.
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();

    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('caches a successful read so the next call is free', async () => {
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    await settle();
    expect(cache.putCount).toBe(1);

    const second = await new Promise<ParsedFeed>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe(resolve);
    });
    expect(second.title).toBe('A Feed');
    http.verify();
  });

  it('serves the stale copy when the network fails', async () => {
    cache.seed('https://example.com/feed.xml', 'Yesterday', 48 * 60 * 60 * 1000);
    const result = new Promise<ParsedFeed>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe(resolve);
    });
    await settle();
    http.expectOne(() => true).flush('', { status: 522, statusText: 'Origin Down' });

    // A day-old article beats an error message.
    expect((await result).title).toBe('Yesterday');
  });

  it('never serves an empty placeholder as though it were the feed', async () => {
    // Regression. A failed fetch used to write a record holding an empty
    // ParsedFeed; the next read treated that husk as a cache hit, so a feed
    // that had failed once rendered as "0 posts" instead of reporting an error.
    // The symptom was maddening because the subscription's title was correct —
    // it had been captured by a *different*, successful fetch.
    const first = new Promise<Error>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe({ error: resolve });
    });
    await settle();
    http.expectOne(() => true).flush('', { status: 522, statusText: 'Origin Down' });
    await first;

    // Nothing readable was stored, so the feed is not "cached and empty".
    expect(await cache.get('https://example.com/feed.xml', 24 * 60 * 60 * 1000)).toBeNull();

    // And the next read reports the throttle rather than yielding zero items.
    const second = await new Promise<Error>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe({
        next: () => resolve(new Error('served a feed instead of failing')),
        error: resolve,
      });
    });
    expect(second.message).toMatch(/isn't being retried yet|couldn't be read/i);
    http.verify();
  });

  it('a failed direct fetch does not block the proxied retry of the same feed', async () => {
    // Regression, and the reason a proxied feed showed nothing: adding a
    // CORS-blocked feed fails directly, then the user retries via proxy. A
    // feed-wide cooldown suppressed that retry, so the feed never loaded.
    settings.select('allorigins');

    const direct = new Promise<Error>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe({ error: resolve });
    });
    await settle();
    http.expectOne('https://example.com/feed.xml').error(new ProgressEvent('error'), { status: 0 });
    await direct;

    // The proxied route is a different route and must still be attempted.
    fetcher.fetchFeed('https://example.com/feed.xml', { useProxy: true }).subscribe();
    await settle();
    http
      .expectOne('https://api.allorigins.win/raw?url=https%3A%2F%2Fexample.com%2Ffeed.xml')
      .flush(FEED_XML);
    http.verify();
  });

  it("a successful fetch clears that route's cooldown", async () => {
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe({ error: () => undefined });
    await settle();
    http.expectOne(() => true).flush('', { status: 500, statusText: 'Server Error' });
    await settle();
    expect(await cache.inCooldown('direct:https://example.com/feed.xml')).toBe(true);

    // forceRefresh ignores the cooldown; succeeding must clear it.
    fetcher.fetchFeed('https://example.com/feed.xml', { forceRefresh: true }).subscribe();
    await settle();
    http.expectOne(() => true).flush(FEED_XML);
    await settle();
    expect(await cache.inCooldown('direct:https://example.com/feed.xml')).toBe(false);
  });

  it('stops hitting a failing feed for a cooldown period', async () => {
    cache.seed('https://example.com/feed.xml', 'Yesterday', 48 * 60 * 60 * 1000);
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();
    http.expectOne(() => true).flush('', { status: 429, statusText: 'Too Many Requests' });
    await settle();

    // The second attempt must not reach the network: hammering a proxy that is
    // already throttling us is exactly how the rate limit stays exhausted.
    const feed = await new Promise<ParsedFeed>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe(resolve);
    });
    expect(feed.title).toBe('Yesterday');
    http.verify();
  });

  it('surfaces the failure when there is no cached copy to fall back on', async () => {
    const error = new Promise<Error>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe({ error: resolve });
    });
    await settle();
    http.expectOne(() => true).flush('', { status: 522, statusText: 'Origin Down' });
    expect((await error).message).toContain('522');
  });

  it('never caches or cools down a proxy misconfiguration', async () => {
    cache.seed('https://example.com/feed.xml', 'Yesterday', 48 * 60 * 60 * 1000);
    // No proxy configured, but the feed asks for one: a settings error, which
    // must reach the user rather than being masked by stale content.
    const error = await new Promise<Error>((resolve) => {
      fetcher
        .fetchFeed('https://example.com/feed.xml', { useProxy: true })
        .subscribe({ error: resolve });
    });
    expect(error.message).toMatch(/No CORS proxy is configured/i);
    expect(cache.records.get('https://example.com/feed.xml')?.failedAt).toBeUndefined();
  });

  it('skips the cache entirely for noCache reads', async () => {
    cache.seed('https://example.com/feed.xml', 'Cached');
    fetcher.fetchFeed('https://example.com/feed.xml', { noCache: true }).subscribe();
    // Synchronous, and ignores the seeded entry.
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    expect(cache.putCount).toBe(0);
    http.verify();
  });

  it('errors rather than fetching directly when no proxy is configured', async () => {
    // The refusal is synchronous, so this resolves without any HTTP activity.
    const error = await new Promise<Error>((resolve) => {
      fetcher
        .fetchFeed('https://example.com/feed.xml', { useProxy: true })
        .subscribe({ error: resolve });
    });
    expect(error.message).toMatch(/No CORS proxy is configured/i);
    // Critically: no request at all. A silent direct fetch would defeat the
    // user's decision to route this feed through a proxy.
    http.verify();
  });

  it('refuses to proxy a credential-bearing host, and makes no request', async () => {
    settings.select('allorigins');
    const error = await new Promise<Error>((resolve) => {
      fetcher.fetchFeed('https://api.github.com/user', { useProxy: true }).subscribe({
        error: resolve,
      });
    });
    expect(error.message).toMatch(/connected account/i);
    http.verify();
  });

  it('counts proxied requests and failures without recording addresses', async () => {
    settings.select('allorigins');
    const usage = TestBed.inject(CorsProxyUsageStore);

    fetcher.fetchFeed('https://example.com/a.xml', { useProxy: true }).subscribe();
    await settle();
    http.expectOne(() => true).flush(FEED_XML);
    expect(usage.usage().requests).toBe(1);
    expect(usage.usage().failures).toBe(0);

    fetcher
      .fetchFeed('https://example.com/b.xml', { useProxy: true })
      .subscribe({ error: () => undefined });
    await settle();
    http.expectOne(() => true).flush('', { status: 429, statusText: 'Too Many Requests' });
    expect(usage.usage()).toMatchObject({ requests: 2, failures: 1 });

    expect(localStorage.getItem('mockingbird_cors_proxy_usage')).not.toContain('example.com');
  });

  it('does not count direct fetches as proxy traffic', async () => {
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    await settle();
    http.expectOne(() => true).flush(FEED_XML);
    expect(TestBed.inject(CorsProxyUsageStore).usage().requests).toBe(0);
  });

  it('points at the proxy settings when a direct fetch is blocked', async () => {
    const errorPromise = new Promise<Error>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe({ error: resolve });
    });
    await settle();
    http.expectOne(() => true).error(new ProgressEvent('error'), { status: 0 });
    expect((await errorPromise).message).toMatch(/CORS proxy/i);
  });

  it('blames the proxy, not the feed, when a proxied fetch is rejected', async () => {
    settings.select('corssh');
    settings.setKey('k');
    const errorPromise = new Promise<Error>((resolve) => {
      fetcher
        .fetchFeed('https://example.com/feed.xml', { useProxy: true })
        .subscribe({ error: resolve });
    });
    await settle();
    http.expectOne(() => true).flush('', { status: 403, statusText: 'Forbidden' });
    expect((await errorPromise).message).toMatch(/proxy rejected the request/i);
  });
});
