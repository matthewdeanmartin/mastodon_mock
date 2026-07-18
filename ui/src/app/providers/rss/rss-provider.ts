import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { Account, Status } from '../../models';
import { FeedProvider } from '../provider';
import { commentAccount, feedAccount, feedToStatuses, itemToStatus } from './rss-adapter';
import { ParsedItem } from './rss-parser';
import { RssFetch } from './rss-fetch';
import { RssSubscriptions } from './rss-subscriptions';

/** An RSS item plus the synthetic account and comment info the thread view needs. */
export interface RssItemView {
  status: Status;
  account: Account;
  /** Secondary feed URL carrying this item's comments (wfw:commentRss / Atom replies). */
  commentsFeedUrl: string | null;
  /** Declared comment count, when the feed advertises one. */
  commentCount: number | null;
}

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

  /**
   * The whole feed as a synthetic profile: the feed's account plus every item
   * as a Status, newest first. Backs the "feed = profile" page (/accounts/rss:…).
   */
  getFeed(feedUrl: string): Observable<{ account: Account; statuses: Status[] }> {
    const fetchedAt = new Date().toISOString();
    return this.fetch.fetchFeed(feedUrl).pipe(
      map((feed) => ({
        account: feedAccount(feedUrl, feed),
        statuses: feedToStatuses(feedUrl, feed, fetchedAt),
      })),
    );
  }

  /**
   * One item of a feed, resolved by guid, for the thread/reader view. Feeds have
   * no per-item endpoint, so this re-fetches the feed and finds the item — cheap
   * enough for a click-through, and the browser's HTTP cache usually serves it.
   */
  getFeedItem(feedUrl: string, guid: string): Observable<RssItemView> {
    const fetchedAt = new Date().toISOString();
    return this.fetch.fetchFeed(feedUrl).pipe(
      map((feed) => {
        const item = feed.items.find((i) => i.guid === guid);
        if (!item) {
          throw new Error('That item is no longer in the feed.');
        }
        const account = feedAccount(feedUrl, feed);
        return {
          status: itemToStatus(item, feedUrl, account, fetchedAt),
          account,
          commentsFeedUrl: item.commentsFeedUrl,
          commentCount: item.commentCount,
        };
      }),
    );
  }

  /**
   * A post's comments, adapted as thread descendants (replies to `parentStatusId`).
   * `commentsFeedUrl` comes from wfw:commentRss or Atom rel="replies"; the comment
   * feed's items become read-only reply Statuses attributed to their own authors.
   */
  getComments(
    commentsFeedUrl: string,
    feedUrl: string,
    parentStatusId: string,
  ): Observable<Status[]> {
    const fetchedAt = new Date().toISOString();
    return this.fetch.fetchFeed(commentsFeedUrl).pipe(
      map((feed) => {
        // Comment feeds carry their own channel title; attribute each comment to
        // its own author (dc:creator) so the thread reads like a real discussion.
        const channel = feedAccount(commentsFeedUrl, feed);
        return feed.items
          .map((item: ParsedItem) =>
            itemToStatus(item, feedUrl, commentAccount(item, commentsFeedUrl, channel), fetchedAt, {
              inReplyToId: parentStatusId,
              isComment: true,
            }),
          )
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      }),
    );
  }
}
