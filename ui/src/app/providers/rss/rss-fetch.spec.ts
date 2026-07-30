import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CorsProxySettings } from '../cors-proxy/cors-proxy-settings';
import { CorsProxyUsageStore } from '../cors-proxy/cors-proxy-usage';
import { Server } from '../../server';
import { RssFetch } from './rss-fetch';

const FEED_XML = `<?xml version="1.0"?><rss><channel><title>A Feed</title></channel></rss>`;

describe('RssFetch', () => {
  let fetcher: RssFetch;
  let http: HttpTestingController;
  let settings: CorsProxySettings;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fetcher = TestBed.inject(RssFetch);
    http = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(CorsProxySettings);
    TestBed.inject(Server).setBaseUrl('https://mastodon.social');
  });

  it('fetches straight from the publisher by default', () => {
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('does not touch the proxy even when one is configured, unless asked', () => {
    settings.select('allorigins');
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    // The whole point of per-feed opt-in: configuring a proxy must not silently
    // reroute every feed through it.
    http.expectOne('https://example.com/feed.xml').flush(FEED_XML);
    http.verify();
  });

  it('routes through the proxy when the feed opted in', () => {
    settings.select('allorigins');
    fetcher.fetchFeed('https://example.com/feed.xml', { useProxy: true }).subscribe();
    http
      .expectOne('https://api.allorigins.win/raw?url=https%3A%2F%2Fexample.com%2Ffeed.xml')
      .flush(FEED_XML);
    http.verify();
  });

  it('sends the API key as the header the proxy documents', () => {
    settings.select('corssh');
    settings.setKey('secret-key');
    fetcher.fetchFeed('https://example.com/feed.xml', { useProxy: true }).subscribe();

    const req = http.expectOne('https://proxy.cors.sh/https://example.com/feed.xml');
    expect(req.request.headers.get('x-cors-api-key')).toBe('secret-key');
    req.flush(FEED_XML);
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

  it('counts proxied requests and failures without recording addresses', () => {
    settings.select('allorigins');
    const usage = TestBed.inject(CorsProxyUsageStore);

    fetcher.fetchFeed('https://example.com/a.xml', { useProxy: true }).subscribe();
    http.expectOne(() => true).flush(FEED_XML);
    expect(usage.usage().requests).toBe(1);
    expect(usage.usage().failures).toBe(0);

    fetcher
      .fetchFeed('https://example.com/b.xml', { useProxy: true })
      .subscribe({ error: () => undefined });
    http.expectOne(() => true).flush('', { status: 429, statusText: 'Too Many Requests' });
    expect(usage.usage()).toMatchObject({ requests: 2, failures: 1 });

    expect(localStorage.getItem('mockingbird_cors_proxy_usage')).not.toContain('example.com');
  });

  it('does not count direct fetches as proxy traffic', () => {
    fetcher.fetchFeed('https://example.com/feed.xml').subscribe();
    http.expectOne(() => true).flush(FEED_XML);
    expect(TestBed.inject(CorsProxyUsageStore).usage().requests).toBe(0);
  });

  it('points at the proxy settings when a direct fetch is blocked', async () => {
    const errorPromise = new Promise<Error>((resolve) => {
      fetcher.fetchFeed('https://example.com/feed.xml').subscribe({ error: resolve });
    });
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
    http.expectOne(() => true).flush('', { status: 403, statusText: 'Forbidden' });
    expect((await errorPromise).message).toMatch(/proxy rejected the request/i);
  });
});
