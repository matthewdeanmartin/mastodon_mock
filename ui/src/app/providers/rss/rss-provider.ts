import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { Status } from '../../models';
import { FeedProvider } from '../provider';
import { feedToStatuses } from './rss-adapter';
import { RssFetch } from './rss-fetch';
import { RssSubscriptions } from './rss-subscriptions';

/**
 * RSS as a home-timeline source. Feeds have no pagination, so the first
 * `fetchPage()` after a `reset()` loads every enabled feed (tolerating
 * per-feed failures) and returns ALL items newest-first; the aggregator
 * buffers them and interleaves with Mastodon pages. Read-only by nature.
 */
@Injectable({ providedIn: 'root' })
export class RssProvider implements FeedProvider {
  private fetch = inject(RssFetch);
  private subs = inject(RssSubscriptions);

  readonly id = 'rss' as const;
  readonly label = 'RSS';
  readonly badge = '📡 RSS';
  readonly linked = computed(() => this.subs.enabledFeeds().length > 0);
  readonly errors = signal<string[]>([]);

  private exhausted = false;

  reset(): void {
    this.exhausted = false;
    this.errors.set([]);
  }

  fetchPage(): Observable<Status[]> {
    if (this.exhausted) {
      return of([]);
    }
    this.exhausted = true;
    const feeds = this.subs.enabledFeeds();
    if (!feeds.length) {
      return of([]);
    }
    const fetchedAt = new Date().toISOString();
    const failures: string[] = [];
    return forkJoin(
      feeds.map((sub) =>
        this.fetch.fetchFeed(sub.url).pipe(
          map((feed) => feedToStatuses(sub.url, feed, fetchedAt)),
          catchError((err: Error) => {
            failures.push(`${sub.title || sub.url}: ${err.message}`);
            return of<Status[]>([]);
          }),
        ),
      ),
    ).pipe(
      map((perFeed) => {
        this.errors.set(failures);
        return perFeed.flat().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      }),
    );
  }
}
