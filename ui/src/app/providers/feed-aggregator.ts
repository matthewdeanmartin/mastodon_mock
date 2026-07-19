import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap, tap } from 'rxjs';
import { Api } from '../api';
import { Auth } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { HomeDiagnostics } from '../home-diagnostics';
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
  private auth = inject(Auth);
  private prefs = inject(ClientPrefs);
  private registry = inject(ProviderRegistry);
  private diagnostics = inject(HomeDiagnostics);

  private mastodonMaxId: string | undefined;
  private mastodonExhausted = false;
  private foreign: ForeignSource[] = [];

  /** Start over from the top using the providers currently visible to the user. */
  reset(): void {
    this.mastodonMaxId = undefined;
    this.mastodonExhausted = this.auth.isAnonymous || !this.prefs.isProviderVisible('mastodon');
    this.foreign = this.registry
      .linked()
      .filter((provider) => this.prefs.isProviderVisible(provider.id))
      .map((provider) => {
        provider.reset();
        return { provider, exhausted: false };
      });
    // Safety net: an authenticated reader whose persisted filters hide *every*
    // source (e.g. mastodon + all linked providers toggled off, from a shared
    // localStorage prefs blob) would otherwise get a permanently empty home
    // feed with no visible chip to recover — Mastodon is their primary network,
    // so keep it enabled rather than honour a filter that shows nothing.
    if (!this.auth.isAnonymous && this.mastodonExhausted && !this.foreign.length) {
      this.mastodonExhausted = false;
      this.diagnostics.warn('aggregator:all-sources-hidden-fallback');
    }
    this.diagnostics.info('aggregator:reset', {
      mode: this.auth.mode() ?? 'unauthenticated',
      mastodonVisible: this.prefs.isProviderVisible('mastodon'),
      mastodonEnabled: !this.mastodonExhausted,
      linkedProviders: this.registry.linked().map((provider) => provider.id),
      enabledForeignProviders: this.foreign.map((source) => source.provider.id),
    });
  }

  hasMore(): boolean {
    return !this.mastodonExhausted || this.foreign.some((source) => !source.exhausted);
  }

  /** Fetch one quota-sized round from every active source and merge it by date. */
  nextPage(): Observable<Status[]> {
    const sourcePages: Observable<Status[]>[] = [];
    this.diagnostics.info('aggregator:round-start', {
      mastodonEnabled: !this.mastodonExhausted,
      foreignProviders: this.foreign
        .filter((source) => !source.exhausted)
        .map((source) => source.provider.id),
    });

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
          tap({
            next: (items) =>
              this.diagnostics.info('mastodon:page-success', {
                posts: items.length,
                exhausted: this.mastodonExhausted,
              }),
            error: (error: unknown) => this.diagnostics.error('mastodon:page-error', error),
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
      this.diagnostics.warn('aggregator:no-enabled-sources');
      return of([]);
    }
    return forkJoin(sourcePages).pipe(
      map((pages) => pages.flat().sort((a, b) => time(b) - time(a))),
      tap((items) =>
        this.diagnostics.info('aggregator:round-success', {
          posts: items.length,
          providerCounts: this.providerCounts(items),
          hasMore: this.hasMore(),
        }),
      ),
    );
  }

  /** Keep paging one foreign source until its round reaches the quota or exhausts. */
  private fetchForeignPage(source: ForeignSource, collected: Status[] = []): Observable<Status[]> {
    if (source.exhausted || collected.length >= SOURCE_PAGE_SIZE) {
      return of(collected);
    }
    return source.provider.fetchPage().pipe(
      // A browser-only source can fail for reasons outside our control (most
      // commonly an RSS server without CORS headers). One unavailable source
      // must never reject forkJoin and discard every healthy Home source.
      catchError((error: unknown) => {
        source.exhausted = true;
        this.diagnostics.error('foreign:page-error', error, { provider: source.provider.id });
        return of<Status[]>([]);
      }),
      switchMap((items) => {
        if (!items.length) {
          source.exhausted = true;
          return of(collected);
        }
        return this.fetchForeignPage(source, [...collected, ...items]);
      }),
    );
  }

  private providerCounts(statuses: Status[]): Record<string, number> {
    return statuses.reduce<Record<string, number>>((counts, status) => {
      const provider = status.provider ?? 'mastodon';
      counts[provider] = (counts[provider] ?? 0) + 1;
      return counts;
    }, {});
  }
}
