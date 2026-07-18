import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { Api } from '../api';
import { ClientPrefs } from '../client-prefs';
import { Status } from '../models';
import { FeedProvider } from './provider';
import { ProviderRegistry } from './provider-registry';

/** Each active source earns at least this many posts in one loading round. */
const SOURCE_PAGE_SIZE = 20;

interface ForeignSource {
  provider: FeedProvider;
  exhausted: boolean;
}

function time(status: Status): number {
  const ms = Date.parse(status.created_at);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Loads the home feed in per-source rounds, then merges each round newest-first.
 *
 * Every visible active source contributes at least 20 posts when available:
 * Mastodon first, then each linked foreign provider. Provider pages are kept
 * whole, so a page that crosses 20 may make the round larger. This prevents a
 * busy Mastodon timeline from squeezing RSS or Bluesky out of the loaded feed.
 */
@Injectable({ providedIn: 'root' })
export class FeedAggregator {
  private api = inject(Api);
  private prefs = inject(ClientPrefs);
  private registry = inject(ProviderRegistry);

  private mastodonMaxId: string | undefined;
  private mastodonExhausted = false;
  private foreign: ForeignSource[] = [];

  /** Start over from the top using the providers currently visible to the user. */
  reset(): void {
    this.mastodonMaxId = undefined;
    this.mastodonExhausted = !this.prefs.isProviderVisible('mastodon');
    this.foreign = this.registry
      .linked()
      .filter((provider) => this.prefs.isProviderVisible(provider.id))
      .map((provider) => {
        provider.reset();
        return { provider, exhausted: false };
      });
  }

  hasMore(): boolean {
    return !this.mastodonExhausted || this.foreign.some((source) => !source.exhausted);
  }

  /** Fetch one quota-sized round from every active source and merge it by date. */
  nextPage(): Observable<Status[]> {
    const sourcePages: Observable<Status[]>[] = [];

    if (!this.mastodonExhausted) {
      sourcePages.push(
        this.api.homeTimeline(this.mastodonMaxId).pipe(
          map((items) => {
            this.mastodonMaxId = items.at(-1)?.id ?? this.mastodonMaxId;
            if (items.length < SOURCE_PAGE_SIZE) {
              this.mastodonExhausted = true;
            }
            return items;
          }),
        ),
      );
    }

    sourcePages.push(
      ...this.foreign
        .filter((source) => !source.exhausted)
        .map((source) => this.fetchForeignPage(source)),
    );

    if (!sourcePages.length) {
      return of([]);
    }
    return forkJoin(sourcePages).pipe(
      map((pages) => pages.flat().sort((a, b) => time(b) - time(a))),
    );
  }

  /** Keep paging one foreign source until its round reaches the quota or exhausts. */
  private fetchForeignPage(source: ForeignSource, collected: Status[] = []): Observable<Status[]> {
    if (source.exhausted || collected.length >= SOURCE_PAGE_SIZE) {
      return of(collected);
    }
    return source.provider.fetchPage().pipe(
      switchMap((items) => {
        if (!items.length) {
          source.exhausted = true;
          return of(collected);
        }
        return this.fetchForeignPage(source, [...collected, ...items]);
      }),
    );
  }
}
