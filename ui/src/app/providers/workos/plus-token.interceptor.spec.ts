import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorsProxySettings } from '../cors-proxy/cors-proxy-settings';
import { FeatureFlags } from '../../feature-flags';
import {
  PLUS_TOKEN_HEADER,
  plusTokenInterceptor,
  PlusTokenSource,
} from './plus-token.interceptor';

const PROXY = 'https://mawkingbird-cors-proxy.matthewdeanmartin.workers.dev';

/**
 * A stand-in token source.
 *
 * Provided in place of the real one so no dynamic import happens here — see
 * `PlusTokenSource` for why the interceptor loads `PlusSession` lazily.
 */
class FakePlusTokenSource {
  token = vi.fn().mockResolvedValue('supporter-token');
}

describe('plusTokenInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let settings: CorsProxySettings;
  let plus: FakePlusTokenSource;

  beforeEach(() => {
    localStorage.clear();
    plus = new FakePlusTokenSource();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([plusTokenInterceptor])),
        provideHttpClientTesting(),
        { provide: PlusTokenSource, useValue: plus },
      ],
    });
    // The Plus entry is canary-flagged, and `CorsProxySettings.chosen()`
    // enforces that on every read — so without this the proxy resolves to null
    // and nothing under test would run.
    TestBed.inject(FeatureFlags).setState('proxy-mawkingbird-plus', 'production');
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(CorsProxySettings);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** Fire a GET and return the intercepted request. */
  const fire = async (url: string): Promise<TestRequest> => {
    http.get(url).subscribe({ error: () => undefined });
    // The interceptor awaits a token before forwarding, so the request does
    // not exist synchronously.
    await Promise.resolve();
    await Promise.resolve();
    const request = httpMock.expectOne(url);
    request.flush('');
    return request;
  };

  it('attaches the token to a proxy request when Plus is selected', async () => {
    settings.select('mawkingbird-plus');

    const request = await fire(`${PROXY}/?route=feeds&url=https%3A%2F%2Fexample.com%2Ffeed.xml`);

    expect(request.request.headers.get(PLUS_TOKEN_HEADER)).toBe('supporter-token');
  });

  it('does not attach it when the free Mawkingbird proxy is selected', async () => {
    settings.select('mawkingbird');

    const request = await fire(`${PROXY}/?route=feeds&url=https%3A%2F%2Fexample.com%2Ffeed.xml`);

    expect(request.request.headers.has(PLUS_TOKEN_HEADER)).toBe(false);
    expect(plus.token).not.toHaveBeenCalled();
  });

  it('never attaches it to a host that is not the proxy', async () => {
    settings.select('mawkingbird-plus');

    const request = await fire('https://example.com/feed.xml');

    // The blast radius of getting this wrong is handing a bearer credential to
    // whichever host a user typed into their feed list.
    expect(request.request.headers.has(PLUS_TOKEN_HEADER)).toBe(false);
  });

  it('is not fooled by a target URL that mentions the proxy host', async () => {
    settings.select('mawkingbird-plus');

    const request = await fire('https://evil.test/?pretend=workers.dev');

    // Origin comparison, not a substring match. A proxied URL carries its
    // target in the query string, so `includes` would be exactly wrong here.
    expect(request.request.headers.has(PLUS_TOKEN_HEADER)).toBe(false);
  });

  it('sends the request unauthenticated when no token can be minted', async () => {
    settings.select('mawkingbird-plus');
    plus.token.mockResolvedValue(null);

    const request = await fire(`${PROXY}/?route=feeds&url=https%3A%2F%2Fexample.com%2Ffeed.xml`);

    // Free-tier limits, not a failure. A supporter mid-refresh must not see a
    // broken feed.
    expect(request.request.headers.has(PLUS_TOKEN_HEADER)).toBe(false);
  });

  it('does nothing when no proxy is configured at all', async () => {
    const request = await fire('https://example.com/feed.xml');

    expect(request.request.headers.has(PLUS_TOKEN_HEADER)).toBe(false);
    expect(plus.token).not.toHaveBeenCalled();
  });
});
