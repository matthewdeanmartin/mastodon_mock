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
      categories: [],
      author: null,
      commentsFeedUrl: null,
      commentCount: null,
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

  it('getFeed returns the feed account plus every item, newest first', async () => {
    const provider = setUp(() =>
      of(feed('a', ['2026-07-10T00:00:00.000Z', '2026-07-14T00:00:00.000Z'])),
    );
    const { account, statuses } = await firstValueFrom(provider.getFeed('https://a.example/feed'));
    expect(account.display_name).toBe('a');
    expect(statuses.map((s) => s.created_at)).toEqual([
      '2026-07-14T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
    ]);
  });

  it('getFeedItem resolves one item by guid and surfaces its comment info', async () => {
    const provider = setUp(() =>
      of({
        title: 'a',
        link: null,
        items: [
          {
            guid: 'a-0',
            title: 'Post',
            link: 'https://x.example/a/0',
            publishedAt: '2026-07-14T00:00:00.000Z',
            html: '<p>body</p>',
            enclosures: [],
            categories: [],
            author: null,
            commentsFeedUrl: 'https://x.example/a/0/comments',
            commentCount: 4,
          },
        ],
      }),
    );
    const view = await firstValueFrom(provider.getFeedItem('https://a.example/feed', 'a-0'));
    expect(view.status.id).toBe('rss:https://a.example/feed::a-0');
    expect(view.commentsFeedUrl).toBe('https://x.example/a/0/comments');
    expect(view.commentCount).toBe(4);
  });

  it('getFeedItem errors when the guid is gone from the feed', async () => {
    const provider = setUp(() => of(feed('a', ['2026-07-14T00:00:00.000Z'])));
    await expect(
      firstValueFrom(provider.getFeedItem('https://a.example/feed', 'missing')),
    ).rejects.toThrow(/no longer in the feed/);
  });

  it('getComments adapts a comment feed into oldest-first replies with authors', async () => {
    const provider = setUp(() =>
      of({
        title: 'Comments on Post',
        link: null,
        items: [
          {
            guid: 'c2',
            title: 'Comment by Bob',
            link: 'https://x.example/a/0#c2',
            publishedAt: '2026-07-15T00:00:00.000Z',
            html: '<p>Second</p>',
            enclosures: [],
            categories: [],
            author: 'Bob',
            commentsFeedUrl: null,
            commentCount: null,
          },
          {
            guid: 'c1',
            title: 'Comment by Ann',
            link: 'https://x.example/a/0#c1',
            publishedAt: '2026-07-14T00:00:00.000Z',
            html: '<p>First</p>',
            enclosures: [],
            categories: [],
            author: 'Ann',
            commentsFeedUrl: null,
            commentCount: null,
          },
        ],
      }),
    );
    const parentId = 'rss:https://a.example/feed::a-0';
    const comments = await firstValueFrom(
      provider.getComments('https://a.example/comments', 'https://a.example/feed', parentId),
    );
    // Oldest first (chronological reading order).
    expect(comments.map((c) => c.account.display_name)).toEqual(['Ann', 'Bob']);
    expect(comments.every((c) => c.in_reply_to_id === parentId)).toBe(true);
    expect(comments[0].id).toBe(`${parentId}::comment::c1`);
  });
});
