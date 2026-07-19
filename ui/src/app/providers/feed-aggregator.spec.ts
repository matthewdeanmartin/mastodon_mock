import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../api';
import { ClientPrefs } from '../client-prefs';
import { Status } from '../models';
import { FeedAggregator } from './feed-aggregator';
import { BlueskyProvider } from './bluesky/bluesky-provider';
import { RssProvider } from './rss/rss-provider';

function makeStatus(id: string, createdAt: string, overrides: Partial<Status> = {}): Status {
  return {
    id,
    created_at: createdAt,
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: 'a1', acct: 'a', username: 'a', display_name: 'A' } as Status['account'],
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
    ...overrides,
  };
}

function rssStatus(id: string, createdAt: string, feedAccountId = 'rss:feed'): Status {
  return makeStatus(id, createdAt, {
    provider: 'rss',
    account: { id: feedAccountId, acct: 'feed' } as Status['account'],
  });
}

function blueskyStatus(id: string, createdAt: string): Status {
  return makeStatus(id, createdAt, { provider: 'bluesky' });
}

/** Minute-spaced mastodon statuses, newest first, on 2026-07-14. */
function mastodonPage(startMinute: number, count: number): Status[] {
  return Array.from({ length: count }, (_, i) => {
    const minute = String(startMinute - i).padStart(2, '0');
    return makeStatus(`m${startMinute - i}`, `2026-07-14T10:${minute}:00.000Z`);
  });
}

interface FakeProvider {
  linked: ReturnType<typeof signal<boolean>>;
  pages: Status[][];
  fetchPage: ReturnType<typeof vi.fn>;
}

describe('FeedAggregator', () => {
  let homeTimeline: ReturnType<typeof vi.fn>;
  let fakeRss: FakeProvider;
  let fakeBluesky: FakeProvider;

  beforeEach(() => {
    localStorage.clear();
    homeTimeline = vi.fn();
    const fakeProvider = (): FakeProvider => {
      const fake: FakeProvider = { linked: signal(false), pages: [], fetchPage: vi.fn() };
      fake.fetchPage.mockImplementation(() => of(fake.pages.shift() ?? []));
      return fake;
    };
    fakeRss = fakeProvider();
    fakeBluesky = fakeProvider();
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: { homeTimeline } },
        {
          provide: BlueskyProvider,
          useValue: {
            id: 'bluesky',
            label: 'Bluesky',
            badge: '🦋 Bsky',
            linked: fakeBluesky.linked,
            errors: signal<string[]>([]),
            reset: vi.fn(),
            fetchPage: fakeBluesky.fetchPage,
          },
        },
        {
          provide: RssProvider,
          useValue: {
            id: 'rss',
            label: 'RSS',
            badge: '📡 RSS',
            linked: fakeRss.linked,
            errors: signal<string[]>([]),
            reset: vi.fn(),
            fetchPage: fakeRss.fetchPage,
          },
        },
      ],
    });
  });

  it('with no providers linked, passes the Mastodon timeline through page by page', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    homeTimeline.mockReturnValueOnce(of(mastodonPage(59, 20))).mockReturnValueOnce(of([]));

    aggregator.reset();
    const page1 = await firstValueFrom(aggregator.nextPage());
    expect(page1.map((s) => s.id)).toEqual(mastodonPage(59, 20).map((s) => s.id));
    expect(homeTimeline).toHaveBeenCalledWith(undefined);
    expect(aggregator.hasMore()).toBe(true);

    const page2 = await firstValueFrom(aggregator.nextPage());
    expect(page2).toEqual([]);
    expect(homeTimeline).toHaveBeenLastCalledWith('m40');
    expect(aggregator.hasMore()).toBe(false);
  });

  it('interleaves RSS items chronologically among Mastodon posts', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    // Mastodon posts at 10:59 and 10:57; RSS at 10:58 — a short, exhausted timeline.
    homeTimeline.mockReturnValueOnce(
      of([
        makeStatus('m2', '2026-07-14T10:59:00.000Z'),
        makeStatus('m1', '2026-07-14T10:57:00.000Z'),
      ]),
    );
    fakeRss.pages = [[rssStatus('r1', '2026-07-14T10:58:00.000Z')]];

    aggregator.reset();
    const page = await firstValueFrom(aggregator.nextPage());
    expect(page.map((s) => s.id)).toEqual(['m2', 'r1', 'm1']);
  });

  it('does not let a full Mastodon page squeeze out an older RSS page', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    homeTimeline.mockReturnValueOnce(of(mastodonPage(59, 20)));
    fakeRss.pages = [[rssStatus('r-old', '2026-07-01T00:00:00.000Z')]];

    aggregator.reset();
    const page1 = await firstValueFrom(aggregator.nextPage());
    expect(page1).toHaveLength(21);
    expect(page1.at(-1)?.id).toBe('r-old');
  });

  it('loads 20 posts from each of two active sources', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    homeTimeline.mockReturnValue(of(mastodonPage(59, 20)));
    fakeRss.pages = [
      Array.from({ length: 20 }, (_, i) =>
        rssStatus(`r${i}`, `2026-07-14T09:${String(59 - i).padStart(2, '0')}:00.000Z`),
      ),
    ];

    aggregator.reset();
    const page = await firstValueFrom(aggregator.nextPage());
    expect(page).toHaveLength(40);
    expect(page.filter((s) => !s.provider)).toHaveLength(20);
    expect(page.filter((s) => s.provider === 'rss')).toHaveLength(20);
  });

  it('loads a foreign source until it reaches 20 and keeps the whole crossing page', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    homeTimeline.mockReturnValue(of([]));
    fakeRss.pages = [
      Array.from({ length: 12 }, (_, i) =>
        rssStatus(`r${i}`, `2026-07-14T10:${String(59 - i).padStart(2, '0')}:00.000Z`),
      ),
      Array.from({ length: 11 }, (_, i) =>
        rssStatus(`r${i + 12}`, `2026-07-14T09:${String(59 - i).padStart(2, '0')}:00.000Z`),
      ),
    ];

    aggregator.reset();
    const page1 = await firstValueFrom(aggregator.nextPage());
    expect(page1).toHaveLength(23);
    expect(fakeRss.fetchPage).toHaveBeenCalledTimes(2);
  });

  it('loads 20 posts for each of Mastodon, Bluesky, and RSS', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    fakeBluesky.linked.set(true);
    homeTimeline.mockReturnValue(of(mastodonPage(59, 20)));
    fakeBluesky.pages = [
      Array.from({ length: 20 }, (_, i) =>
        blueskyStatus(`b${i}`, `2026-07-14T09:${String(59 - i).padStart(2, '0')}:00.000Z`),
      ),
    ];
    fakeRss.pages = [
      Array.from({ length: 20 }, (_, i) =>
        rssStatus(`r${i}`, `2026-07-14T08:${String(59 - i).padStart(2, '0')}:00.000Z`),
      ),
    ];

    aggregator.reset();
    const page = await firstValueFrom(aggregator.nextPage());
    expect(page).toHaveLength(60);
    expect(page.filter((s) => !s.provider)).toHaveLength(20);
    expect(page.filter((s) => s.provider === 'bluesky')).toHaveLength(20);
    expect(page.filter((s) => s.provider === 'rss')).toHaveLength(20);
  });

  it('treats all RSS subscriptions as one source quota', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    TestBed.inject(ClientPrefs).toggleProvider('mastodon');
    fakeRss.linked.set(true);
    fakeRss.pages = [
      Array.from({ length: 20 }, (_, i) =>
        rssStatus(
          `r${i}`,
          `2026-07-14T10:${String(30 - i).padStart(2, '0')}:00.000Z`,
          `rss:feed${i % 2}`,
        ),
      ),
    ];

    aggregator.reset();
    const page = await firstValueFrom(aggregator.nextPage());
    expect(page).toHaveLength(20);
    expect(fakeRss.fetchPage).toHaveBeenCalledTimes(1);
    expect(homeTimeline).not.toHaveBeenCalled();
  });

  it('keeps healthy sources when a browser-only provider fails', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    homeTimeline.mockReturnValueOnce(of([makeStatus('healthy', '2026-07-14T10:00:00.000Z')]));
    fakeRss.fetchPage.mockReturnValueOnce(
      throwError(() => new Error('RSS server blocked this browser with CORS')),
    );

    aggregator.reset();
    const page = await firstValueFrom(aggregator.nextPage());

    expect(page.map((status) => status.id)).toEqual(['healthy']);
    expect(aggregator.hasMore()).toBe(false);
  });
});
