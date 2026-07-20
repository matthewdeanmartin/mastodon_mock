import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiMetrics, EndpointStat, normalizeEndpoint } from './api-metrics';
import { Server } from '../server';

function storageKey(server: string): string {
  return `mockingbird_api_metrics:${encodeURIComponent(server)}`;
}

describe('normalizeEndpoint', () => {
  it('collapses numeric id segments to :id', () => {
    expect(normalizeEndpoint('/api/v1/accounts/12345/followers')).toBe(
      '/api/v1/accounts/:id/followers',
    );
  });

  it('collapses provider-scoped (colon) ids', () => {
    expect(normalizeEndpoint('/api/v1/statuses/rss:https%3A%2F%2Fx.com%2Ffeed')).toBe(
      '/api/v1/statuses/:id',
    );
  });

  it('drops the query string', () => {
    expect(normalizeEndpoint('/api/v1/timelines/home?max_id=999&limit=40')).toBe(
      '/api/v1/timelines/home',
    );
  });

  it('strips the origin', () => {
    expect(normalizeEndpoint('https://mastodon.social/api/v1/bookmarks')).toBe('/api/v1/bookmarks');
  });

  it('keeps route names that merely contain letters and digits but are short', () => {
    expect(normalizeEndpoint('/api/v2/search')).toBe('/api/v2/search');
    expect(normalizeEndpoint('/api/v1/trends/tags')).toBe('/api/v1/trends/tags');
  });
});

describe('ApiMetrics', () => {
  let metrics: ApiMetrics;
  let server: Server;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [ApiMetrics, Server] });
    server = TestBed.inject(Server);
    server.setBaseUrl('https://mastodon.social');
    metrics = TestBed.inject(ApiMetrics);
  });

  afterEach(() => localStorage.clear());

  function row(key: string): EndpointStat | undefined {
    return metrics.stats().find((s) => s.key === key);
  }

  it('aggregates repeated calls to one endpoint into a single row', () => {
    metrics.record('GET', '/api/v1/accounts/1/followers', 100, 200, true);
    metrics.record('GET', '/api/v1/accounts/2/followers', 200, 200, true);

    const r = row('GET /api/v1/accounts/:id/followers');
    expect(r?.count).toBe(2);
    expect(r?.totalMs).toBe(300);
    expect(r?.minMs).toBe(100);
    expect(r?.maxMs).toBe(200);
    expect(ApiMetrics.mean(r!)).toBe(150);
  });

  it('separates rows by HTTP method', () => {
    metrics.record('GET', '/api/v1/statuses/1', 10, 200, true);
    metrics.record('POST', '/api/v1/statuses/1', 20, 200, true);
    expect(metrics.stats().length).toBe(2);
  });

  it('counts errors and records them in the ring, newest first', () => {
    metrics.record('GET', '/api/v1/bookmarks', 50, 200, true);
    metrics.record('GET', '/api/v1/bookmarks', 50, 500, false);
    metrics.record('POST', '/api/v1/statuses', 0, 0, false);

    expect(row('GET /api/v1/bookmarks')?.errors).toBe(1);
    expect(metrics.totals().errors).toBe(2);

    const errs = metrics.errors();
    expect(errs.length).toBe(2);
    // Newest first: the network failure (status 0) came last.
    expect(errs[0].status).toBe(0);
    expect(errs[0].endpoint).toBe('/api/v1/statuses');
    expect(errs[1].status).toBe(500);
  });

  it('computes a stable standard deviation from sum-of-squares', () => {
    // Samples 10 and 30 → mean 20, variance 100, stddev 10.
    metrics.record('GET', '/api/v1/x', 10, 200, true);
    metrics.record('GET', '/api/v1/x', 30, 200, true);
    const r = row('GET /api/v1/x')!;
    expect(ApiMetrics.mean(r)).toBe(20);
    expect(Math.round(ApiMetrics.stddev(r))).toBe(10);
  });

  it('buckets calls over time and bumps the same bucket for near-simultaneous calls', () => {
    metrics.record('GET', '/api/v1/a', 5, 200, true);
    metrics.record('GET', '/api/v1/b', 5, 200, true);
    const timeline = metrics.timeline();
    expect(timeline.length).toBe(1);
    expect(timeline[0].count).toBe(2);
  });

  it('reset clears everything and empties the stored blob', () => {
    metrics.record('GET', '/api/v1/bookmarks', 42, 200, true);
    metrics.reset();
    expect(metrics.stats().length).toBe(0);
    expect(metrics.errors().length).toBe(0);
    expect(metrics.totals().count).toBe(0);

    // reset() flushes synchronously — the stored blob is now empty.
    const stored = JSON.parse(localStorage.getItem(storageKey('https://mastodon.social')) ?? '{}');
    expect(stored.e).toEqual([]);
  });

  it('restores aggregates from a persisted blob', () => {
    metrics.record('GET', '/api/v1/bookmarks', 42, 200, true);
    metrics.reset(); // flushes; now write a known blob and reload via a new instance.

    const blob = {
      v: 1,
      e: [['GET /api/v1/favourites', 3, 1, 300, 50, 150, 34000, 200, 111]],
      b: [[60000, 3, 1]],
      x: [[111, 'GET', '/api/v1/favourites', 500, 'HTTP 500 after 100ms']],
    };
    localStorage.setItem(storageKey('https://mastodon.social'), JSON.stringify(blob));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ApiMetrics, Server] });
    TestBed.inject(Server).setBaseUrl('https://mastodon.social');
    const reloaded = TestBed.inject(ApiMetrics);

    const r = reloaded.stats().find((s) => s.key === 'GET /api/v1/favourites');
    expect(r?.count).toBe(3);
    expect(r?.errors).toBe(1);
    expect(reloaded.errors().length).toBe(1);
    expect(reloaded.timeline().length).toBe(1);
  });

  it('aggregates accounts on one server and isolates activity on another server', () => {
    metrics.record('GET', '/api/v1/home', 10, 200, true);
    metrics.record('GET', '/api/v1/home', 20, 200, true);
    expect(metrics.totals().count).toBe(2);

    server.setBaseUrl('https://msdn.social');
    metrics.record('GET', '/api/v1/home', 30, 200, true);
    expect(metrics.serverLabel()).toBe('https://msdn.social');
    expect(metrics.totals().count).toBe(1);

    server.setBaseUrl('https://mastodon.social');
    expect(metrics.totals().count).toBe(2);
  });

  it('deletes the old global metrics blob instead of migrating it', () => {
    localStorage.setItem('mockingbird_api_metrics', JSON.stringify({ v: 1, e: [], b: [], x: [] }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ApiMetrics, Server] });

    TestBed.inject(ApiMetrics);

    expect(localStorage.getItem('mockingbird_api_metrics')).toBeNull();
  });
});
