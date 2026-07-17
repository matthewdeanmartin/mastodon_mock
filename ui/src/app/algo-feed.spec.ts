import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgoFeed } from './algo-feed';
import { Api } from './api';
import { Auth } from './auth';
import { Account, Status } from './models';

function makeAccount(id: string): Account {
  return { id, username: `u${id}`, acct: `u${id}`, display_name: `User ${id}` } as Account;
}

function makeStatus(id: string, overrides: Partial<Status> = {}): Status {
  return {
    id,
    created_at: '2026-07-01T00:00:00.000Z',
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: makeAccount('author'),
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

/** Counts as `(favs+1)(boosts+1)(replies+1)` per the smoothed-product rule. */
function withEngagement(s: Status, favs: number, boosts: number, replies: number): Status {
  return { ...s, favourites_count: favs, reblogs_count: boosts, replies_count: replies };
}

interface ApiMock {
  accountFollowing: ReturnType<typeof vi.fn>;
  accountFollowers: ReturnType<typeof vi.fn>;
  homeTimeline: ReturnType<typeof vi.fn>;
  getAccountStatuses: ReturnType<typeof vi.fn>;
  followedTags: ReturnType<typeof vi.fn>;
  tagTimeline: ReturnType<typeof vi.fn>;
}

describe('AlgoFeed', () => {
  let api: ApiMock;
  let account: ReturnType<typeof signal<Account | null>>;

  beforeEach(() => {
    api = {
      accountFollowing: vi.fn(() => of([])),
      accountFollowers: vi.fn(() => of([])),
      homeTimeline: vi.fn(() => of([])),
      getAccountStatuses: vi.fn(() => of([])),
      followedTags: vi.fn(() => of([])),
      tagTimeline: vi.fn(() => of([])),
    };
    account = signal<Account | null>(makeAccount('me'));
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: api },
        { provide: Auth, useValue: { account } },
      ],
    });
    // Deterministic shuffle/tag pick.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not build without an account', () => {
    account.set(null);
    const feed = TestBed.inject(AlgoFeed);
    feed.refresh();
    expect(feed.error()).toBe(true);
    expect(api.homeTimeline).not.toHaveBeenCalled();
  });

  it('gathers all four buckets, dedupes, and ranks by smoothed engagement', () => {
    const mutual = makeAccount('m1');
    api.accountFollowing.mockReturnValue(of([makeAccount('f1'), mutual]));
    api.accountFollowers.mockReturnValue(of([mutual, makeAccount('stranger')]));

    const boostTarget = withEngagement(makeStatus('target'), 9, 0, 0); // score 10
    const home = [
      makeStatus('boost', { reblog: boostTarget, account: makeAccount('f1') }),
      withEngagement(makeStatus('orig', { account: makeAccount('f1') }), 1, 1, 1), // 8
      makeStatus('reply', { in_reply_to_id: 'x', account: makeAccount('f1') }),
      makeStatus('mine', { account: makeAccount('me') }),
    ];
    api.homeTimeline.mockReturnValue(of(home));

    const mutualPost = withEngagement(makeStatus('mp', { account: mutual }), 99, 0, 0); // 100
    // Duplicate of the boost target under the mutual's own authorship.
    api.getAccountStatuses.mockReturnValue(of([mutualPost, boostTarget]));

    api.followedTags.mockReturnValue(of([{ name: 'cats' }]));
    const tagPost = withEngagement(makeStatus('tp', { account: makeAccount('stranger') }), 4, 0, 0); // 5
    api.tagTimeline.mockReturnValue(of([tagPost]));

    const feed = TestBed.inject(AlgoFeed);
    feed.refresh();

    expect(feed.loading()).toBe(false);
    expect(feed.builtAt()).not.toBeNull();
    expect(feed.hashtag()).toBe('cats');
    // 2 discovery + 1 home + 1 mutual + 1 followedTags + 1 tag page.
    expect(feed.callsUsed()).toBe(6);

    const posts = feed.posts();
    // The home boost wrapper deduped away: its target was already in as 'mutual'.
    expect(posts.map((p) => p.status.id)).toEqual(['mp', 'target', 'orig', 'tp']);
    expect(posts.map((p) => p.source)).toEqual(['mutual', 'mutual', 'original', 'hashtag']);
    // Replies and my own posts are excluded.
    expect(posts.some((p) => p.status.id === 'reply' || p.status.id === 'mine')).toBe(false);
    // Hashtag post by a non-followed account is platform content.
    expect(posts.find((p) => p.status.id === 'tp')?.friend).toBe(false);
    expect(posts.find((p) => p.status.id === 'orig')?.friend).toBe(true);
  });

  it('keeps only one entry when two boosts wrap the same target', () => {
    const target = makeStatus('t');
    api.homeTimeline.mockReturnValue(
      of([makeStatus('b1', { reblog: target }), makeStatus('b2', { reblog: target })]),
    );
    const feed = TestBed.inject(AlgoFeed);
    feed.refresh();
    expect(feed.posts()).toHaveLength(1);
  });

  it('pages the home timeline on max_id until a short page, capped at 5 pages', () => {
    const fullPage = (start: number) =>
      Array.from({ length: 20 }, (_, i) => makeStatus(`h${start + i}`));
    api.homeTimeline
      .mockReturnValueOnce(of(fullPage(0)))
      .mockReturnValueOnce(of(fullPage(20)))
      .mockReturnValueOnce(of([makeStatus('last')]));

    const feed = TestBed.inject(AlgoFeed);
    feed.refresh();

    expect(api.homeTimeline).toHaveBeenCalledTimes(3);
    expect(api.homeTimeline).toHaveBeenNthCalledWith(2, 'h19');
    expect(api.homeTimeline).toHaveBeenNthCalledWith(3, 'h39');
  });

  it('skips the mutual and hashtag buckets once the pool already holds 100 posts', () => {
    const mutual = makeAccount('m1');
    api.accountFollowing.mockReturnValue(of([mutual]));
    api.accountFollowers.mockReturnValue(of([mutual]));
    const fullPage = (start: number) =>
      Array.from({ length: 20 }, (_, i) => makeStatus(`h${start + i}`));
    api.homeTimeline.mockImplementation((maxId?: string) => {
      const start = maxId ? Number(maxId.slice(1)) + 1 : 0;
      return of(fullPage(start));
    });

    const feed = TestBed.inject(AlgoFeed);
    feed.refresh();

    expect(api.homeTimeline).toHaveBeenCalledTimes(5); // page cap
    expect(api.getAccountStatuses).not.toHaveBeenCalled();
    expect(api.followedTags).not.toHaveBeenCalled();
    expect(feed.posts()).toHaveLength(100);
  });

  it('samples at most 8 mutuals', () => {
    const mutuals = Array.from({ length: 12 }, (_, i) => makeAccount(`m${i}`));
    api.accountFollowing.mockReturnValue(of(mutuals));
    api.accountFollowers.mockReturnValue(of(mutuals));

    const feed = TestBed.inject(AlgoFeed);
    feed.refresh();

    expect(api.getAccountStatuses).toHaveBeenCalledTimes(8);
  });

  it('tolerates individual bucket failures', () => {
    const mutual = makeAccount('m1');
    api.accountFollowing.mockReturnValue(of([mutual]));
    api.accountFollowers.mockReturnValue(of([mutual]));
    api.getAccountStatuses.mockReturnValue(throwError(() => new Error('boom')));
    api.followedTags.mockReturnValue(throwError(() => new Error('boom')));
    api.homeTimeline.mockReturnValue(of([makeStatus('h1')]));

    const feed = TestBed.inject(AlgoFeed);
    feed.refresh();

    expect(feed.error()).toBe(false);
    expect(feed.posts().map((p) => p.status.id)).toEqual(['h1']);
  });

  it('ensureBuilt builds once and then serves the cache', () => {
    api.homeTimeline.mockReturnValue(of([makeStatus('h1')]));
    const feed = TestBed.inject(AlgoFeed);
    feed.ensureBuilt();
    feed.ensureBuilt();
    expect(api.homeTimeline).toHaveBeenCalledTimes(1);
  });

  it('updateStatus and removeStatus edit the cached feed in place', () => {
    api.homeTimeline.mockReturnValue(of([makeStatus('h1'), makeStatus('h2')]));
    const feed = TestBed.inject(AlgoFeed);
    feed.refresh();

    const original = feed.posts()[0].status;
    const updated = { ...original, favourited: true };
    feed.updateStatus(original, updated);
    expect(feed.posts()[0].status.favourited).toBe(true);

    feed.removeStatus('h2');
    expect(feed.posts()).toHaveLength(1);
  });
});
