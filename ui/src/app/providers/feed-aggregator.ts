import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, of } from 'rxjs';
import { Api } from '../api';
import { Status } from '../models';
import { FeedProvider } from './provider';
import { ProviderRegistry } from './provider-registry';

const PAGE_SIZE = 20;
/** Flood control: at most this many items per RSS feed per page. */
const RSS_FEED_CAP_PER_PAGE = 5;

interface ForeignSource {
  provider: FeedProvider;
  buffer: Status[];
  exhausted: boolean;
}

function time(s: Status): number {
  const ms = Date.parse(s.created_at);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Merges the Mastodon home timeline with every linked provider into one
 * newest-first feed, paged like the plain home timeline. With no providers
 * linked it degenerates to exactly `api.homeTimeline()` paging.
 *
 * Correctness rule: while Mastodon still has unfetched pages, foreign items
 * older than the oldest buffered Mastodon item stay buffered — the next
 * Mastodon page may contain items that belong between them.
 */
@Injectable({ providedIn: 'root' })
export class FeedAggregator {
  private api = inject(Api);
  private registry = inject(ProviderRegistry);

  private mastodonBuffer: Status[] = [];
  private mastodonMaxId: string | undefined;
  private mastodonExhausted = false;
  private foreign: ForeignSource[] = [];

  /** Start over from the top: next `nextPage()` returns the newest page. */
  reset(): void {
    this.mastodonBuffer = [];
    this.mastodonMaxId = undefined;
    this.mastodonExhausted = false;
    this.foreign = this.registry.linked().map((provider) => {
      provider.reset();
      return { provider, buffer: [], exhausted: false };
    });
  }

  hasMore(): boolean {
    return (
      !this.mastodonExhausted ||
      this.mastodonBuffer.length > 0 ||
      this.foreign.some((f) => !f.exhausted || f.buffer.length > 0)
    );
  }

  nextPage(): Observable<Status[]> {
    const refills: Observable<unknown>[] = [];
    if (!this.mastodonExhausted && this.mastodonBuffer.length < PAGE_SIZE) {
      refills.push(
        this.api.homeTimeline(this.mastodonMaxId).pipe(
          map((items) => {
            this.mastodonBuffer.push(...items);
            this.mastodonMaxId = items.at(-1)?.id ?? this.mastodonMaxId;
            if (items.length < PAGE_SIZE) {
              this.mastodonExhausted = true;
            }
          }),
        ),
      );
    }
    for (const f of this.foreign) {
      if (!f.exhausted && f.buffer.length < PAGE_SIZE) {
        refills.push(
          f.provider.fetchPage().pipe(
            map((items) => {
              if (items.length) {
                f.buffer.push(...items);
              } else {
                f.exhausted = true;
              }
            }),
          ),
        );
      }
    }
    const refill$: Observable<unknown> = refills.length ? forkJoin(refills) : of(null);
    return refill$.pipe(map(() => this.assemblePage()));
  }

  private assemblePage(): Status[] {
    // Foreign items may not outrun Mastodon's unfetched pages.
    const boundary =
      this.mastodonExhausted || !this.mastodonBuffer.length
        ? Number.NEGATIVE_INFINITY
        : time(this.mastodonBuffer[this.mastodonBuffer.length - 1]);

    const candidates = [this.mastodonBuffer, ...this.foreign.map((f) => f.buffer)]
      .flat()
      .sort((a, b) => time(b) - time(a));

    const page: Status[] = [];
    const perFeed = new Map<string, number>();
    const taken = new Set<Status>();
    for (const s of candidates) {
      if (page.length >= PAGE_SIZE || time(s) < boundary) {
        break;
      }
      if (s.provider === 'rss') {
        const n = perFeed.get(s.account.id) ?? 0;
        if (n >= RSS_FEED_CAP_PER_PAGE) {
          continue; // deferred to a later page, still buffered
        }
        perFeed.set(s.account.id, n + 1);
      }
      page.push(s);
      taken.add(s);
    }

    this.mastodonBuffer = this.mastodonBuffer.filter((s) => !taken.has(s));
    for (const f of this.foreign) {
      f.buffer = f.buffer.filter((s) => !taken.has(s));
    }
    return page;
  }
}
