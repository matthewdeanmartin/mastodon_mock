import { inject, Injectable, signal } from '@angular/core';
import {
  catchError,
  forkJoin,
  map,
  Observable,
  of,
  switchMap,
  tap,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';
import { Api } from '../api';
import { Auth } from '../auth';
import { ClientPrefs, homeWindowMs } from '../client-prefs';
import { HomeDiagnostics } from '../home-diagnostics';
import { Status } from '../models';
import { FeedProvider } from './provider';
import { ProviderRegistry } from './provider-registry';

/** Each active source earns at least this many posts in one loading round. */
const SOURCE_PAGE_SIZE = 20;

/**
 * How long one foreign source may hold up the whole round.
 *
 * The round is a `forkJoin`, so Home renders nothing until every source settles
 * — which means the slowest source sets the time-to-first-post for all of them.
 * That was fine while "slow" meant a sluggish RSS host. It stopped being fine
 * when the free CORS proxies this app depends on started refusing in bulk:
 * a provider that retries with backoff behind a dead proxy can legitimately take
 * a minute to fail, and for that minute Home looked frozen with a spinner.
 *
 * Ten seconds is past any healthy response and well short of the retry budget
 * that caused the freeze. A source that misses it is dropped **from this round
 * only** — it is not marked exhausted, because a timeout is not evidence the
 * source is empty, and its own cache may well answer instantly next round.
 */
const SOURCE_TIMEOUT_MS = 10_000;

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
  /** Epoch ms before which posts are not loaded, or null for no limit. */
  private cutoff: number | null = null;

  /**
   * How many posts the current window dropped, so Home can offer to widen it.
   *
   * Counted rather than inferred: "you are only seeing today" is useful, but
   * only if the app can say there is actually something older to see.
   */
  readonly droppedByWindow = signal(0);

  /**
   * Whether a post is inside the loading window.
   *
   * An unparseable date counts as *inside*. `normalizeTimestamp` already yields
   * null rather than now() for a bad date, and those statuses carry epoch 0 —
   * dropping them would silently hide a post because its provider sent a date
   * we could not read, which is a worse failure than showing it.
   */
  private withinWindow(status: Status): boolean {
    if (this.cutoff === null) {
      return true;
    }
    const ms = Date.parse(status.created_at);
    return Number.isNaN(ms) || ms === 0 || ms >= this.cutoff;
  }

  /** Start over from the top using the providers currently visible to the user. */
  reset(): void {
    const windowMs = homeWindowMs(this.prefs.homeWindow());
    this.cutoff = windowMs === null ? null : Date.now() - windowMs;
    this.droppedByWindow.set(0);
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
    // The round is a forkJoin: nothing renders until the slowest source settles,
    // so pairing this with `round-success`'s elapsedMs and the per-source timeout
    // warnings is what names the culprit behind a Home feed that felt frozen.
    const roundStartedAt = Date.now();
    this.diagnostics.info('aggregator:round-start', {
      mastodonEnabled: !this.mastodonExhausted,
      foreignProviders: this.foreign
        .filter((source) => !source.exhausted)
        .map((source) => source.provider.id),
      sourceTimeoutMs: SOURCE_TIMEOUT_MS,
    });

    if (!this.mastodonExhausted) {
      sourcePages.push(
        this.api.homeTimeline(this.mastodonMaxId).pipe(
          map((items) => {
            this.mastodonMaxId = items.at(-1)?.id ?? this.mastodonMaxId;
            if (items.length < SOURCE_PAGE_SIZE) {
              this.mastodonExhausted = true;
            }
            // A page is newest-first, so once it crosses the cutoff everything
            // beyond it is older still — stop rather than paging into the
            // archive. This is what keeps "Today" from loading a year.
            const fresh = items.filter((item) => this.withinWindow(item));
            if (fresh.length < items.length) {
              this.droppedByWindow.update((n) => n + (items.length - fresh.length));
              this.mastodonExhausted = true;
            }
            return fresh;
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
          elapsedMs: Date.now() - roundStartedAt,
          providerCounts: this.providerCounts(items),
          hasMore: this.hasMore(),
        }),
      ),
    );
  }

  /**
   * Keep paging one foreign source until its round reaches the quota or exhausts.
   *
   * `deadline` is shared across the recursion so the *source* gets
   * {@link SOURCE_TIMEOUT_MS} in total, not that much per page. Applying the
   * timeout to each call individually would let a source that pages five times
   * hold the round for fifty seconds while never once tripping the limit.
   */
  private fetchForeignPage(
    source: ForeignSource,
    collected: Status[] = [],
    deadline = Date.now() + SOURCE_TIMEOUT_MS,
  ): Observable<Status[]> {
    if (source.exhausted || collected.length >= SOURCE_PAGE_SIZE) {
      return of(collected);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      this.diagnostics.warn('foreign:round-deadline', {
        provider: source.provider.id,
        collected: collected.length,
        budgetMs: SOURCE_TIMEOUT_MS,
      });
      return of(collected);
    }
    const startedAt = Date.now();
    return source.provider.fetchPage().pipe(
      // A source that has stopped answering must not hold Home hostage. It keeps
      // whatever it already collected and is left *unexhausted*: a timeout says
      // "not now", not "nothing left", and next round its cache may answer at once.
      timeout({
        each: remaining,
        with: () => throwError(() => new TimeoutError()),
      }),
      // A browser-only source can fail for reasons outside our control (most
      // commonly an RSS server without CORS headers). One unavailable source
      // must never reject forkJoin and discard every healthy Home source.
      catchError((error: unknown) => {
        const timedOut = error instanceof TimeoutError;
        // Only a real failure exhausts the source. Marking a timed-out source
        // exhausted would drop it for the rest of the session over one slow round.
        source.exhausted = !timedOut;
        if (timedOut) {
          this.diagnostics.warn('foreign:page-timeout', {
            provider: source.provider.id,
            waitedMs: Date.now() - startedAt,
            budgetMs: SOURCE_TIMEOUT_MS,
            collected: collected.length,
            note: 'dropped from this round only; source stays eligible',
          });
        } else {
          this.diagnostics.error('foreign:page-error', error, {
            provider: source.provider.id,
            waitedMs: Date.now() - startedAt,
            collected: collected.length,
          });
        }
        // `null`, not `[]`: an empty page below means "this source is spent" and
        // exhausts it. A timeout must not be read that way, and the exhaustion
        // decision for a real failure has already been made right here.
        return of<Status[] | null>(null);
      }),
      switchMap((items) => {
        if (items === null) {
          return of(collected);
        }
        if (!items.length) {
          source.exhausted = true;
          return of(collected);
        }
        // Same rule as Mastodon: a source that has gone past the cutoff has
        // nothing newer left to give, so stop paging it. Without this, a
        // provider that merges many low-rate sources (RSS, and Anonymous
        // client-side follows worst of all) keeps paging until it has loaded
        // every post it has ever seen.
        const fresh = items.filter((item) => this.withinWindow(item));
        if (fresh.length < items.length) {
          this.droppedByWindow.update((n) => n + (items.length - fresh.length));
          source.exhausted = true;
        }
        return this.fetchForeignPage(source, [...collected, ...fresh], deadline);
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
