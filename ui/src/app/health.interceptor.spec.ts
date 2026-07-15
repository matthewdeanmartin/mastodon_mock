import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { healthInterceptor } from './health.interceptor';
import { externalFetch } from './providers/external-fetch';
import { ServerHealth } from './server-health';

describe('healthInterceptor', () => {
  let httpMock: HttpTestingController;
  let health: ServerHealth;
  let http: HttpClient;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ServerHealth,
        provideHttpClient(withInterceptors([healthInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    health = TestBed.inject(ServerHealth);
    http = TestBed.inject(HttpClient);
  });

  afterEach(() => httpMock.verify());

  it('marks the server down on a network error (status 0)', () => {
    http.get('/api/v1/timelines/home').subscribe({ error: () => undefined });
    httpMock.expectOne('/api/v1/timelines/home').error(new ProgressEvent('error'), { status: 0 });
    expect(health.down()).toBe(true);
  });

  it('marks the server down on a 5xx', () => {
    http.get('/api/v1/timelines/home').subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/v1/timelines/home')
      .flush('boom', { status: 503, statusText: 'Service Unavailable' });
    expect(health.down()).toBe(true);
  });

  it('does NOT mark down on 401 (that means "log in", not "server down")', () => {
    http.get('/api/v1/accounts/verify_credentials').subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/v1/accounts/verify_credentials')
      .flush('unauthorized', { status: 401, statusText: 'Unauthorized' });
    expect(health.down()).toBe(false);
  });

  it('does NOT mark down on 403', () => {
    http.get('/api/v1/admin/accounts').subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/v1/admin/accounts')
      .flush('forbidden', { status: 403, statusText: 'Forbidden' });
    expect(health.down()).toBe(false);
  });

  it('does NOT mark down on 404', () => {
    http.get('/api/v1/statuses/nope').subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/v1/statuses/nope')
      .flush('not found', { status: 404, statusText: 'Not Found' });
    expect(health.down()).toBe(false);
  });

  it('ignores external fetches entirely (a dead RSS feed is not a dead server)', () => {
    http
      .get('https://example.com/feed.xml', { responseType: 'text', context: externalFetch() })
      .subscribe({ error: () => undefined });
    httpMock
      .expectOne('https://example.com/feed.xml')
      .error(new ProgressEvent('error'), { status: 0 });
    expect(health.down()).toBe(false);

    // Nor does a foreign success clear a real down state.
    health.markDown();
    http
      .get('https://example.com/feed.xml', { responseType: 'text', context: externalFetch() })
      .subscribe();
    httpMock.expectOne('https://example.com/feed.xml').flush('<rss/>');
    expect(health.down()).toBe(true);
  });

  it('clears a down state when a later request succeeds', () => {
    // First, go down.
    http.get('/api/v1/timelines/home').subscribe({ error: () => undefined });
    httpMock.expectOne('/api/v1/timelines/home').error(new ProgressEvent('error'), { status: 0 });
    expect(health.down()).toBe(true);

    // A successful response clears it.
    http.get('/api/v2/instance').subscribe();
    httpMock.expectOne('/api/v2/instance').flush({ domain: 'x' });
    expect(health.down()).toBe(false);
  });

  it('clears a down state even when the server answers with a 4xx (it is reachable)', () => {
    health.markDown();
    expect(health.down()).toBe(true);

    http.get('/api/v1/statuses/nope').subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/v1/statuses/nope')
      .flush('nf', { status: 404, statusText: 'Not Found' });
    expect(health.down()).toBe(false);
  });
});
