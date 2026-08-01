import { computed, inject, Injectable } from '@angular/core';
import {
  catchError,
  concatMap,
  from,
  map,
  Observable,
  of,
  takeWhile,
  tap,
  toArray,
} from 'rxjs';
import { Account, Status } from '../../models';
import { TwitterApi, TwitterPage } from './twitter-api';
import { TwitterFollow, TwitterFollows } from './twitter-follows';
import { TwitterUsage } from './twitter-usage';

/**
 * How long a fetched timeline is reused before another request is allowed.
 *
 * The spec suggests 30–120 seconds for a first timeline page (§13). Five
 * minutes is deliberately at the generous end of "fresh enough", because
 * freshness here is not free: every miss is a billable request. Someone
 * navigating between the Feeds hub and an account's page three times in a
 * minute should pay once.
 */
export const TIMELINE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  page: TwitterPage;
  fetchedAt: number;
}

/**
 * One followed account's posts, cached and cost-aware.
 *
 * ## Why the cache is a correctness feature, not an optimization
 *
 * Everywhere else in this app a cache saves latency. Here it saves money, which
 * changes what the right behaviour is at the margins:
 *
 * - A cache hit is preferred even when slightly stale, because the alternative
 *   costs a credit rather than a few hundred milliseconds.
 * - A *failed* fetch is not retried on the next navigation. Without that, a
 *   handle that no longer exists would bill a 404 every time its page is
 *   opened.
 * - Refresh is always an explicit act. Nothing here polls, and nothing
 *   refetches on focus or reconnect.
 *
 * In-memory rather than IndexedDB (unlike {@link RssCache}): these URLs and
 * media links expire, the data is someone's live timeline, and persisting a
 * stranger's posts across sessions buys little. A page reload costs one
 * request, which is the honest price of asking for current data.
 */
@Injectable({ providedIn: 'root' })
export class TwitterFeed {
  private api = inject(TwitterApi);
  private follows = inject(TwitterFollows);
  private usage = inject(TwitterUsage);

  private cache = new Map<string, CacheEntry>();
  /** Handles whose last fetch failed, so a broken one is not billed repeatedly. */
  private failed = new Map<string, { message: string; at: number }>();

  /**
   * Requests spent, delegated to {@link TwitterUsage}.
   *
   * Kept as a passthrough rather than a second counter: the transport is the
   * only thing that can count accurately (it sees retries and the direct probe),
   * and two counters that disagree would be worse than one.
   */
  readonly requestCount = computed(() => this.usage.total());

  /** Whether this account's posts can be served without a request. */
  isCached(username: string): boolean {
    const entry = this.cache.get(key(username));
    return !!entry && Date.now() - entry.fetchedAt < TIMELINE_TTL_MS;
  }

  /** When this account was last fetched, or null. */
  fetchedAt(username: string): number | null {
    return this.cache.get(key(username))?.fetchedAt ?? null;
  }

  /**
   * How many requests loading these accounts would cost right now.
   *
   * Drives the "Refresh all (7 requests)" label. Counts only what would
   * actually go to the network, so a second press moments later honestly
   * reports a smaller number rather than repeating the first estimate.
   */
  estimateCost(usernames: string[], force = false): number {
    return force ? usernames.length : usernames.filter((u) => !this.isCached(u)).length;
  }

  /**
   * One account's recent posts.
   *
   * @param force Bypass the cache. Only ever set from an explicit user action —
   * never from a navigation, a focus event, or a retry.
   */
  timeline(follow: TwitterFollow, force = false): Observable<Status[]> {
    const cacheKey = key(follow.username);
    const cached = this.cache.get(cacheKey);
    if (!force && cached && Date.now() - cached.fetchedAt < TIMELINE_TTL_MS) {
      return of(cached.page.statuses);
    }
    // A handle that just failed is not re-billed on the next navigation. An
    // explicit refresh still gets through, because that is the user asking.
    const failure = this.failed.get(cacheKey);
    if (!force && failure && Date.now() - failure.at < TIMELINE_TTL_MS) {
      return cached ? of(cached.page.statuses) : of([]);
    }

    return this.api.getUserPosts({ userId: follow.userId, username: follow.username }).pipe(
      tap((page) => {
        this.cache.set(cacheKey, { page, fetchedAt: Date.now() });
        this.failed.delete(cacheKey);
        // Bank the stable id and current profile details for free, from a fetch
        // that was happening anyway.
        const author = page.statuses[0]?.reblog?.account ?? page.statuses[0]?.account;
        this.follows.recordProfile(follow.username, {
          userId: authorIdOf(page, follow.username),
          displayName: author?.display_name,
          avatar: author?.avatar,
        });
      }),
      map((page) => page.statuses),
      catchError((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Could not load posts.';
        this.failed.set(cacheKey, { message, at: Date.now() });
        throw error;
      }),
    );
  }

  /** The last failure for an account, for a row to explain itself. */
  lastError(username: string): string | null {
    return this.failed.get(key(username))?.message ?? null;
  }

  /**
   * Load several accounts at once, sequentially.
   *
   * Sequential rather than `forkJoin`, which is the opposite of what this app
   * does everywhere else and is deliberate. Ten parallel requests through a free
   * CORS proxy is the exact shape that trips its per-origin rate limit — which
   * was observed happening during development — and once throttled, the
   * remaining requests fail *having already been billed*. Paying for ten
   * failures is the worst possible outcome, so the requests go one at a time and
   * stop at the first sign of trouble.
   *
   * A per-account failure does not abort the batch — one dead handle should not
   * cost the reader the other nine — but a rate limit does, because continuing
   * would spend money on requests that are now certain to fail.
   */
  refreshMany(
    follows: TwitterFollow[],
    force = false,
  ): Observable<{ loaded: number; failed: string[]; stopped: boolean }> {
    const failed: string[] = [];
    let loaded = 0;

    return from(follows).pipe(
      concatMap((follow) =>
        this.timeline(follow, force).pipe(
          map(() => {
            loaded++;
            return { fatal: false };
          }),
          catchError((error: unknown) => {
            failed.push(follow.username);
            // Once throttled, every further request in this batch is money spent
            // on a certain failure.
            const fatal =
              error instanceof Error && /rate-limit|429|daily limit/i.test(error.message);
            return of({ fatal });
          }),
        ),
      ),
      takeWhile((result) => !result.fatal, true),
      toArray(),
      map((results) => ({
        loaded,
        failed,
        stopped: results.some((result) => result.fatal),
      })),
    );
  }

  /**
   * A post already held in the cache, by its namespaced id.
   *
   * Lets the thread page render the post someone just clicked without paying to
   * fetch it again — they were looking at it a moment ago, so the app already
   * has it. Returns null when the cache has been dropped (a reload, a new tab),
   * and the caller falls back to a real lookup.
   *
   * Searches nested reblogs and quotes too, since those are clickable in their
   * own right.
   */
  findCached(statusId: string): Status | null {
    for (const entry of this.cache.values()) {
      for (const status of entry.page.statuses) {
        if (status.id === statusId) {
          return status;
        }
        if (status.reblog?.id === statusId) {
          return status.reblog;
        }
        const quoted = status.quote?.quoted_status;
        if (quoted?.id === statusId) {
          return quoted;
        }
      }
    }
    return null;
  }

  /** Drop everything cached for one account, so the next read refetches. */
  evict(username: string): void {
    this.cache.delete(key(username));
    this.failed.delete(key(username));
  }
}

function key(username: string): string {
  return username.toLowerCase();
}

/**
 * The followed account's own numeric id, read off a post they authored.
 *
 * Deliberately not just `statuses[0].account.id`: the first post may be a
 * retweet, whose outer account *is* the follow but whose id we want, or a reply.
 * The namespaced account id is a handle, so this digs the raw provider id out of
 * `providerRef` where the adapter recorded it.
 */
function authorIdOf(page: TwitterPage, username: string): string | undefined {
  const needle = username.toLowerCase();
  for (const status of page.statuses) {
    if (status.account.username.toLowerCase() === needle) {
      const ref = status.providerRef as { authorId?: string } | undefined;
      if (ref?.authorId) {
        return ref.authorId;
      }
    }
  }
  return undefined;
}

/** Convenience for a page that has an `Account` rather than a follow. */
export function followFromAccount(account: Account): TwitterFollow {
  return {
    username: account.username,
    displayName: account.display_name,
    avatar: account.avatar,
    addedAt: Date.now(),
    enabled: true,
  };
}
