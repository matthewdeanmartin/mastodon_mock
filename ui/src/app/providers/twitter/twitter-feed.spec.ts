import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Status } from '../../models';
import { TwitterApi, TwitterPage } from './twitter-api';
import { TwitterFeed, TIMELINE_TTL_MS } from './twitter-feed';
import { TwitterFollow, TwitterFollows } from './twitter-follows';

const FOLLOW: TwitterFollow = {
  username: 'NASA',
  displayName: 'NASA',
  addedAt: 0,
  enabled: true,
};

function status(id: string, username = 'NASA'): Status {
  return {
    provider: 'twitter',
    providerRef: { tweetId: id, authorId: '11348282' },
    id: `twitter:${id}`,
    created_at: '2026-07-31T00:00:00.000Z',
    account: { username, display_name: username, avatar: 'a.png' },
  } as unknown as Status;
}

const page = (statuses: Status[]): TwitterPage => ({
  statuses,
  cursor: null,
  hasMore: false,
  skipped: 0,
});

describe('TwitterFeed', () => {
  let feed: TwitterFeed;
  let follows: TwitterFollows;
  let getUserPosts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    getUserPosts = vi.fn().mockReturnValue(of(page([status('1')])));
    TestBed.configureTestingModule({
      providers: [{ provide: TwitterApi, useValue: { getUserPosts } }],
    });
    feed = TestBed.inject(TwitterFeed);
    follows = TestBed.inject(TwitterFollows);
  });

  describe('the cache exists to save money, not milliseconds', () => {
    it('serves a second read without a request', async () => {
      await firstValueFrom(feed.timeline(FOLLOW));
      await firstValueFrom(feed.timeline(FOLLOW));
      expect(getUserPosts).toHaveBeenCalledTimes(1);
      expect(feed.requestCount()).toBe(1);
    });

    it('refetches once the entry is stale', async () => {
      vi.useFakeTimers();
      try {
        await firstValueFrom(feed.timeline(FOLLOW));
        vi.advanceTimersByTime(TIMELINE_TTL_MS + 1);
        await firstValueFrom(feed.timeline(FOLLOW));
        expect(getUserPosts).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('refetches when the user explicitly asks', async () => {
      await firstValueFrom(feed.timeline(FOLLOW));
      await firstValueFrom(feed.timeline(FOLLOW, true));
      expect(getUserPosts).toHaveBeenCalledTimes(2);
    });

    it('does not re-bill a handle that just failed', async () => {
      // Without this, an account that no longer exists costs a 404 on every
      // navigation to its page.
      getUserPosts.mockReturnValue(throwError(() => new Error('User not found')));
      await expect(firstValueFrom(feed.timeline(FOLLOW))).rejects.toThrow();
      // Second read is suppressed rather than billed again.
      await expect(firstValueFrom(feed.timeline(FOLLOW))).resolves.toEqual([]);
      expect(getUserPosts).toHaveBeenCalledTimes(1);
      expect(feed.lastError('NASA')).toMatch(/not found/i);
    });

    it('lets an explicit refresh retry a failed handle', async () => {
      getUserPosts.mockReturnValue(throwError(() => new Error('boom')));
      await expect(firstValueFrom(feed.timeline(FOLLOW))).rejects.toThrow();
      getUserPosts.mockReturnValue(of(page([status('1')])));
      await expect(firstValueFrom(feed.timeline(FOLLOW, true))).resolves.toHaveLength(1);
    });

    it('serves stale content rather than nothing when a refresh fails', async () => {
      await firstValueFrom(feed.timeline(FOLLOW));
      getUserPosts.mockReturnValue(throwError(() => new Error('offline')));
      vi.useFakeTimers();
      try {
        vi.advanceTimersByTime(TIMELINE_TTL_MS + 1);
        await expect(firstValueFrom(feed.timeline(FOLLOW))).rejects.toThrow();
        // The failure is recorded, so the *next* read serves what we still have
        // instead of billing again.
        await expect(firstValueFrom(feed.timeline(FOLLOW))).resolves.toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('cost estimates', () => {
    it('counts only what would actually go to the network', async () => {
      expect(feed.estimateCost(['a', 'b', 'c'])).toBe(3);
      await firstValueFrom(feed.timeline(FOLLOW));
      // NASA is cached now, so refreshing the set honestly costs one less.
      expect(feed.estimateCost(['NASA', 'other'])).toBe(1);
    });

    it('counts everything when forced', async () => {
      await firstValueFrom(feed.timeline(FOLLOW));
      expect(feed.estimateCost(['NASA', 'other'], true)).toBe(2);
    });
  });

  describe('profile details are banked from fetches that happen anyway', () => {
    it('records the numeric id off an authored post', async () => {
      follows.add({ username: 'NASA', displayName: 'NASA' });
      await firstValueFrom(feed.timeline(FOLLOW));
      expect(follows.find('NASA')?.userId).toBe('11348282');
    });

    it('does not take the id from someone else post', async () => {
      // The first post may be a retweet of another account; taking its author
      // id would make every later fetch ask for the wrong person's timeline.
      follows.add({ username: 'NASA', displayName: 'NASA' });
      getUserPosts.mockReturnValue(of(page([status('1', 'SomeoneElse')])));
      await firstValueFrom(feed.timeline(FOLLOW));
      expect(follows.find('NASA')?.userId).toBeUndefined();
    });
  });

  it('evict forces the next read to refetch', async () => {
    await firstValueFrom(feed.timeline(FOLLOW));
    feed.evict('NASA');
    await firstValueFrom(feed.timeline(FOLLOW));
    expect(getUserPosts).toHaveBeenCalledTimes(2);
  });
});
