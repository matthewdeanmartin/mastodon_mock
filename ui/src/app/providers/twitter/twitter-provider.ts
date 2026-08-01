import { computed, inject, Injectable, signal } from '@angular/core';
import {
  catchError,
  concatMap,
  forkJoin,
  from,
  map,
  Observable,
  of,
  switchMap,
  toArray,
} from 'rxjs';
import { Status } from '../../models';
import { FeedProvider } from '../provider';
import { TwitterFeed } from './twitter-feed';
import { TwitterFollows } from './twitter-follows';
import { TwitterSettings } from './twitter-settings';

/**
 * Followed Twitter accounts as a home-timeline source.
 *
 * ## Why this one is not like the other providers
 *
 * Every other provider here is free to call, so `FeedAggregator` may page them
 * as hard as it likes — and it does: `fetchForeignPage` re-invokes `fetchPage()`
 * in a loop until a source yields 20 posts or returns empty. For RSS that is a
 * few extra HTTP requests to publishers who do not mind. Applied naively to
 * Twitter it would be **one billed request per followed account per scroll**,
 * with the bill growing as the reader scrolls further.
 *
 * So this provider inverts the usual relationship with the network: it is a
 * *reader of the cache*, not a fetcher. `fetchPage()` returns everything it
 * already has in one page and then reports exhausted, which ends the
 * aggregator's loop after exactly one call. Nothing here ever fetches on
 * scroll, on focus, or on reconnect.
 *
 * ## Where the posts come from, then
 *
 * {@link TwitterFeed}, which is backed by IndexedDB. The practical effect is
 * that opening Mawkingbird shows the tweets from the last refresh mixed into
 * Home for free, and getting *newer* ones is an explicit act on the connector
 * page ("Refresh all") or the account's own page. That is the same bargain the
 * rest of this connector makes: reading what you already paid for is free,
 * spending is always something you asked for.
 *
 * The first `fetchPage()` after a `reset()` *may* fetch, but only for accounts
 * with nothing cached at all and only up to {@link COLD_START_BUDGET}. Without
 * that, a reader who connects Twitter and goes straight to Home would see an
 * empty section and no explanation — the feature would look broken rather than
 * unpaid-for.
 */

/**
 * How many accounts a cold Home may fetch before giving up and asking.
 *
 * Small on purpose. This exists so Home is not mysteriously empty right after
 * setup, not so Home can populate 200 follows by itself: at one request each
 * that would be a surprise bill triggered by navigation, which is exactly what
 * this connector refuses to do anywhere else. Past this, the section says how
 * to load the rest and what it will cost.
 */
export const COLD_START_BUDGET = 3;

@Injectable({ providedIn: 'root' })
export class TwitterProvider implements FeedProvider {
  private feed = inject(TwitterFeed);
  private follows = inject(TwitterFollows);
  private settings = inject(TwitterSettings);

  readonly id = 'twitter' as const;
  readonly label = 'Twitter';
  readonly badge = '🐦 Twitter';

  /**
   * Linked once the connector works *and* someone is followed.
   *
   * Both halves matter: a key with no follows produces an empty section that
   * looks broken, and follows with no working key produce an error on every
   * Home load. Neither is worth showing a chip for.
   */
  readonly linked = computed(() => this.settings.usable() && this.follows.enabled().length > 0);

  readonly errors = signal<string[]>([]);

  /**
   * How many followed accounts have nothing to show, so Home can offer to load
   * them rather than silently omitting them.
   */
  readonly unloaded = signal(0);

  private exhausted = false;

  reset(): void {
    this.exhausted = false;
    this.errors.set([]);
  }

  fetchPage(): Observable<Status[]> {
    // One page, ever. See the class comment: the aggregator's paging loop is
    // free for other providers and billable here.
    if (this.exhausted) {
      return of([]);
    }
    this.exhausted = true;
    // Wait for the saved timelines before deciding what is "cold". Reading the
    // cache too early would classify every account as unfetched and spend the
    // cold-start budget re-buying tweets already on disk.
    return from(this.feed.hydrated).pipe(switchMap(() => this.readPage()));
  }

  private readPage(): Observable<Status[]> {
    const follows = this.follows.enabled();
    if (!follows.length) {
      this.unloaded.set(0);
      return of([]);
    }

    const cold = follows.filter((follow) => !this.feed.hasAnything(follow.username));
    // Everything already on disk costs nothing, so it is always included.
    const warm = follows.filter((follow) => this.feed.hasAnything(follow.username));
    const toFetch = cold.slice(0, COLD_START_BUDGET);
    this.unloaded.set(cold.length - toFetch.length);

    // Cached reads are free and can all resolve together; the cold-start
    // fetches go one at a time. Parallel requests through a free CORS proxy is
    // the exact shape that trips its per-origin limit — observed during
    // development — and a throttled request fails *having already been billed*.
    const cachedPages = warm.length
      ? forkJoin(warm.map((follow) => this.feed.cached(follow.username)))
      : of<Status[][]>([]);

    const fetchedPages = toFetch.length
      ? from(toFetch).pipe(
          concatMap((follow) =>
            this.feed.timeline(follow).pipe(
              // One dead handle must not cost the reader the whole Home feed.
              // The aggregator reads a thrown error as "this provider is
              // finished", which would drop every other account too.
              catchError((error: unknown) => {
                const message =
                  error instanceof Error ? error.message : 'Could not load an account.';
                this.errors.update((all) => [...all, `@${follow.username}: ${message}`]);
                return of<Status[]>([]);
              }),
            ),
          ),
          toArray(),
        )
      : of<Status[][]>([]);

    return forkJoin([cachedPages, fetchedPages]).pipe(
      map(([cached, fetched]) =>
        [...cached, ...fetched]
          .flat()
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
      ),
    );
  }
}
