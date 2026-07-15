import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../api';
import { Status } from '../models';
import { FeedAggregator } from './feed-aggregator';
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

/** Minute-spaced mastodon statuses, newest first, on 2026-07-14. */
function mastodonPage(startMinute: number, count: number): Status[] {
  return Array.from({ length: count }, (_, i) => {
    const minute = String(startMinute - i).padStart(2, '0');
    return makeStatus(`m${startMinute - i}`, `2026-07-14T10:${minute}:00.000Z`);
  });
}

interface FakeRss {
  linked: ReturnType<typeof signal<boolean>>;
  pages: Status[][];
}

describe('FeedAggregator', () => {
  let homeTimeline: ReturnType<typeof vi.fn>;
  let fakeRss: FakeRss;

  beforeEach(() => {
    homeTimeline = vi.fn();
    fakeRss = { linked: signal(false), pages: [] };
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: { homeTimeline } },
        {
          provide: RssProvider,
          useValue: {
            id: 'rss',
            label: 'RSS',
            badge: '📡 RSS',
            linked: fakeRss.linked,
            errors: signal<string[]>([]),
            reset: vi.fn(),
            fetchPage: vi.fn(() => of(fakeRss.pages.shift() ?? [])),
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

  it('holds back RSS items older than the last fetched Mastodon post until it exhausts', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    // A full mastodon page (not exhausted) spanning 10:59..10:40; one ancient RSS item.
    homeTimeline.mockReturnValueOnce(of(mastodonPage(59, 20))).mockReturnValueOnce(of([]));
    fakeRss.pages = [[rssStatus('r-old', '2026-07-01T00:00:00.000Z')]];

    aggregator.reset();
    const page1 = await firstValueFrom(aggregator.nextPage());
    expect(page1.map((s) => s.id)).not.toContain('r-old');

    // Mastodon exhausts on the next page; now the old RSS item may flow.
    const page2 = await firstValueFrom(aggregator.nextPage());
    expect(page2.map((s) => s.id)).toEqual(['r-old']);
    expect(aggregator.hasMore()).toBe(false);
  });

  it('caps a single feed to 5 items per page (flood control), deferring the rest', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    homeTimeline.mockReturnValue(of([]));
    fakeRss.pages = [
      Array.from({ length: 8 }, (_, i) => rssStatus(`r${i}`, `2026-07-14T10:0${7 - i}:00.000Z`)),
    ];

    aggregator.reset();
    const page1 = await firstValueFrom(aggregator.nextPage());
    expect(page1.map((s) => s.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);

    const page2 = await firstValueFrom(aggregator.nextPage());
    expect(page2.map((s) => s.id)).toEqual(['r5', 'r6', 'r7']);
  });

  it('does not cap items from different feeds', async () => {
    const aggregator = TestBed.inject(FeedAggregator);
    fakeRss.linked.set(true);
    homeTimeline.mockReturnValue(of([]));
    fakeRss.pages = [
      Array.from({ length: 12 }, (_, i) =>
        rssStatus(
          `r${i}`,
          `2026-07-14T10:${String(30 - i).padStart(2, '0')}:00.000Z`,
          `rss:feed${i % 2}`,
        ),
      ),
    ];

    aggregator.reset();
    const page = await firstValueFrom(aggregator.nextPage());
    expect(page).toHaveLength(10);
  });
});
