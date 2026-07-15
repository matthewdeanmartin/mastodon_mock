import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParsedFeed } from './rss-parser';
import { RssFetch } from './rss-fetch';
import { RssProvider } from './rss-provider';
import { RssSubscriptions } from './rss-subscriptions';

function feed(title: string, dates: string[]): ParsedFeed {
  return {
    title,
    link: null,
    items: dates.map((d, i) => ({
      guid: `${title}-${i}`,
      title: `${title} item ${i}`,
      link: `https://x.example/${title}/${i}`,
      publishedAt: d,
      html: '<p>x</p>',
      enclosures: [],
    })),
  };
}

describe('RssProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function setUp(fetchImpl: (url: string) => unknown) {
    TestBed.configureTestingModule({
      providers: [{ provide: RssFetch, useValue: { fetchFeed: vi.fn(fetchImpl) } }],
    });
    return TestBed.inject(RssProvider);
  }

  it('is linked only when at least one feed is enabled', () => {
    const provider = setUp(() => of(feed('a', [])));
    const subs = TestBed.inject(RssSubscriptions);
    expect(provider.linked()).toBe(false);

    subs.add('https://a.example/feed', 'A');
    expect(provider.linked()).toBe(true);

    subs.setEnabled('https://a.example/feed', false);
    expect(provider.linked()).toBe(false);
  });

  it('returns all items of all enabled feeds newest-first, then exhausts', async () => {
    const provider = setUp((url) =>
      of(
        url.includes('a.example')
          ? feed('a', ['2026-07-10T00:00:00.000Z', '2026-07-14T00:00:00.000Z'])
          : feed('b', ['2026-07-12T00:00:00.000Z']),
      ),
    );
    const subs = TestBed.inject(RssSubscriptions);
    subs.add('https://a.example/feed', 'A');
    subs.add('https://b.example/feed', 'B');

    provider.reset();
    const page = await firstValueFrom(provider.fetchPage());
    expect(page.map((s) => s.created_at)).toEqual([
      '2026-07-14T00:00:00.000Z',
      '2026-07-12T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
    ]);
    expect(page.every((s) => s.provider === 'rss')).toBe(true);

    expect(await firstValueFrom(provider.fetchPage())).toEqual([]);
  });

  it('tolerates a failing feed and records the error', async () => {
    const provider = setUp((url) =>
      url.includes('bad')
        ? throwError(() => new Error('no CORS for you'))
        : of(feed('good', ['2026-07-12T00:00:00.000Z'])),
    );
    const subs = TestBed.inject(RssSubscriptions);
    subs.add('https://good.example/feed', 'Good');
    subs.add('https://bad.example/feed', 'Bad');

    provider.reset();
    const page = await firstValueFrom(provider.fetchPage());
    expect(page).toHaveLength(1);
    expect(provider.errors()).toEqual(['Bad: no CORS for you']);
  });
});
