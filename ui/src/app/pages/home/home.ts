import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, Subscription } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Drafts } from '../../drafts';
import { ClientPrefs, FEED_MAX_COOLDOWN_MS } from '../../client-prefs';
import { Status } from '../../models';
import { CommandBar } from '../../command-bar/command-bar';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';
import { Announcements } from '../../announcements/announcements';
import { Streaming } from '../../streaming';
import { HomeTimelineFeed } from '../../home-timeline-feed';
import { HomeDiagnostics } from '../../home-diagnostics';
import { FeedAggregator } from '../../providers/feed-aggregator';
import { ProviderRegistry } from '../../providers/provider-registry';
import { Server } from '../../server';
import {
  AnonymousFeedCorpus,
  canonicalStatusKey,
} from '../../providers/anonymous/anonymous-feed-corpus';
import { AnonymousBookmarks } from '../../providers/anonymous/anonymous-bookmarks';
import { AnonymousMastodonProvider } from '../../providers/anonymous/anonymous-mastodon-provider';
import { AnonymousHomeFeedCache } from '../../providers/anonymous/anonymous-home-feed-cache';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';

/** Below this many follows, nudge toward /find-people (few follows = empty-feeling feed). */
const FOLLOW_NUDGE_THRESHOLD = 5;
const NUDGE_DISMISSED_KEY = 'mockingbird_follow_nudge_dismissed';
/** How many saved bookmarks get tacked onto the feed when the cap hits. */
const BOOKMARK_TAIL_SIZE = 40;

@Component({
  selector: 'app-home',
  imports: [CommandBar, Compose, StatusCard, Announcements, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit, OnDestroy {
  private api = inject(Api);
  protected auth = inject(Auth);
  private prefs = inject(ClientPrefs);
  private streaming = inject(Streaming);
  private homeTimelineFeed = inject(HomeTimelineFeed);
  private diagnostics = inject(HomeDiagnostics);
  private aggregator = inject(FeedAggregator);
  private registry = inject(ProviderRegistry);
  private server = inject(Server);
  private anonymousCorpus = inject(AnonymousFeedCorpus);
  private anonymousBookmarks = inject(AnonymousBookmarks);
  protected anonymousProvider = inject(AnonymousMastodonProvider);
  private anonymousHomeCache = inject(AnonymousHomeFeedCache);
  protected anonymousFollows = inject(AnonymousFollows);
  private route = inject(ActivatedRoute);
  private drafts = inject(Drafts);

  /** A draft opened from /drafts (?draft=<id>), handed to the composer. */
  protected openedDraft = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => {
        const id = params.get('draft');
        return id ? this.drafts.get(id) : undefined;
      }),
    ),
    { initialValue: undefined },
  );

  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected live = signal(false);
  /** True while auto-loading pages to reach the configured minimum feed size. */
  protected autoLoading = signal(false);

  /**
   * When the feed hit the user's maximum, the wall-clock time it happened.
   * A plain signal (not persisted) so it naturally clears on page reload;
   * the 60-minute cooldown lifts it sooner. Null means "cap not hit".
   */
  private maxHitAt = signal<number | null>(null);
  /**
   * Saved bookmarks tacked onto the bottom when the feed cap hits — something
   * the reader chose to keep, instead of an abrupt wall. Fetched once per cap.
   */
  protected bookmarkTail = signal<Status[]>([]);
  /** Ticks so `capActive` re-evaluates the cooldown without a user action. */
  private now = signal(Date.now());
  private clock: ReturnType<typeof setInterval> | null = null;

  /** The loaded feed minus providers hidden via the command-bar chips. */
  protected visible = computed(() =>
    this.statuses().filter((s) => this.prefs.isProviderVisible(s.provider ?? 'mastodon')),
  );

  /** True while the max-feed cap is in force (hit, and within the cooldown). */
  protected capActive = computed(() => {
    const hit = this.maxHitAt();
    return hit !== null && this.now() - hit < FEED_MAX_COOLDOWN_MS;
  });

  /** Roughly how many minutes remain on the cap, for the message. */
  protected capMinutesLeft = computed(() => {
    const hit = this.maxHitAt();
    if (hit === null) {
      return 0;
    }
    return Math.max(1, Math.ceil((FEED_MAX_COOLDOWN_MS - (this.now() - hit)) / 60000));
  });

  /** Show "Load more" only when there's more AND we're not capped/auto-loading. */
  protected canLoadMore = computed(
    () => this.aggregator.hasMore() && !this.capActive() && !this.autoLoading(),
  );

  private nudgeDismissed = signal(localStorage.getItem(NUDGE_DISMISSED_KEY) === 'true');

  protected followingCount = computed(() => this.auth.account()?.following_count ?? 0);

  protected showFollowNudge = computed(
    () =>
      !this.nudgeDismissed() &&
      !this.auth.isAnonymous &&
      this.auth.account() !== null &&
      this.followingCount() < FOLLOW_NUDGE_THRESHOLD,
  );

  dismissNudge(): void {
    localStorage.setItem(NUDGE_DISMISSED_KEY, 'true');
    this.nudgeDismissed.set(true);
  }

  private liveSub: Subscription | null = null;
  private pageSub: Subscription | null = null;
  private bookmarkSub: Subscription | null = null;

  ngOnInit(): void {
    this.load();
    // Re-tick every 30s so the cap message / cooldown updates on its own.
    this.clock = setInterval(() => this.now.set(Date.now()), 30000);
  }

  ngOnDestroy(): void {
    this.liveSub?.unsubscribe();
    this.pageSub?.unsubscribe();
    this.bookmarkSub?.unsubscribe();
    if (this.clock) {
      clearInterval(this.clock);
    }
  }

  toggleLive(): void {
    if (this.live()) {
      this.liveSub?.unsubscribe();
      this.liveSub = null;
      this.live.set(false);
      return;
    }
    this.live.set(true);
    // Going live starts from a fresh snapshot: refetch, then stream deltas on top.
    this.load();
    this.liveSub = this.streaming.open({ stream: 'user' }).subscribe(({ event, payload }) => {
      if (event === 'update') {
        this.statuses.update((list) => [payload as Status, ...list]);
      } else if (event === 'delete') {
        const id = payload as string;
        this.statuses.update((list) => list.filter((s) => s.id !== id));
      }
    });
  }

  load(forceRefresh = false): void {
    this.pageSub?.unsubscribe();
    this.autoLoading.set(false);
    this.loading.set(true);
    this.maxHitAt.set(null);
    this.bookmarkTail.set([]);
    this.aggregator.reset();
    if (this.auth.isAnonymous && !forceRefresh && this.anonymousHomeCache.populated()) {
      const cached = this.anonymousHomeCache.statuses();
      this.statuses.set(cached);
      this.publishMastodon(cached);
      this.loading.set(false);
      this.diagnostics.info('load:anonymous-cache-hit', { stored: cached.length });
      return;
    }
    this.diagnostics.info('load:start', {
      mode: this.auth.mode() ?? 'unauthenticated',
      server: this.server.baseUrl() || 'same-origin',
      tokenPresent: this.auth.token() !== null,
      mastodonVisible: this.prefs.isProviderVisible('mastodon'),
      hiddenProviders: this.prefs.hiddenProviders(),
      linkedProviders: this.registry.linked().map((provider) => provider.id),
      feedMin: this.prefs.feedMin(),
      feedMax: this.prefs.feedMax(),
    });
    if (this.auth.isAnonymous) {
      this.loadAnonymousStreaming();
      return;
    }
    this.pageSub = this.aggregator.nextPage().subscribe({
      next: (s) => {
        this.statuses.set(s);
        const details = {
          received: s.length,
          stored: this.statuses().length,
          visible: this.visible().length,
          providerCounts: this.providerCounts(this.statuses()),
          hasMore: this.aggregator.hasMore(),
        };
        if (this.visible().length) {
          this.diagnostics.info('load:first-page-success', details);
        } else {
          this.diagnostics.warn('load:first-page-empty', details);
        }
        this.publishMastodon(s);
        this.loading.set(false);
        // Auto-load further pages until the feed reaches the configured minimum.
        this.fillToMinimum();
      },
      error: (error: unknown) => {
        this.diagnostics.error('load:first-page-error', error, {
          mode: this.auth.mode() ?? 'unauthenticated',
          server: this.server.baseUrl() || 'same-origin',
        });
        this.loading.set(false);
      },
    });
  }

  /**
   * Anonymous home spans many slow RSS/API sources. Rather than block on all of
   * them, paint posts as each source lands: every streamed snapshot is shown in
   * arrival order (loading clears on the first one so the page feels alive), and
   * a single newest-first sort runs once the stream completes.
   */
  private loadAnonymousStreaming(): void {
    let sawFirst = false;
    this.pageSub = this.anonymousProvider.fetchPageStreaming().subscribe({
      next: (snapshot) => {
        // Snapshots are already deduped and grow monotonically; show as-is
        // (arrival order) mid-stream — the final sort happens on completion.
        this.statuses.set(snapshot);
        this.publishMastodon(snapshot);
        if (!sawFirst) {
          sawFirst = true;
          this.loading.set(false);
        }
        this.diagnostics.info('load:anonymous-stream-snapshot', {
          stored: snapshot.length,
          visible: this.visible().length,
          providerCounts: this.providerCounts(snapshot),
        });
      },
      error: (error: unknown) => {
        this.diagnostics.error('load:first-page-error', error, {
          mode: this.auth.mode() ?? 'unauthenticated',
          server: this.server.baseUrl() || 'same-origin',
        });
        this.loading.set(false);
      },
      complete: () => {
        // Everything's in: sort newest-first once, cache, and top up to the min.
        this.statuses.update((list) => this.dedupeAnonymous(list));
        this.publishMastodon(this.statuses());
        this.cacheAnonymousHome();
        this.loading.set(false);
        this.diagnostics.info('load:anonymous-stream-complete', {
          stored: this.statuses().length,
          visible: this.visible().length,
        });
        this.fillToMinimum();
      },
    });
  }

  /**
   * Keep fetching pages until the feed holds at least `feedMin` items, the
   * timeline is exhausted, or the maximum is hit. Runs one page at a time.
   */
  private fillToMinimum(): void {
    if (
      this.statuses().length >= this.prefs.feedMin() ||
      this.statuses().length >= this.prefs.feedMax() ||
      !this.aggregator.hasMore()
    ) {
      this.diagnostics.info('autoload:stop', {
        stored: this.statuses().length,
        feedMin: this.prefs.feedMin(),
        feedMax: this.prefs.feedMax(),
        hasMore: this.aggregator.hasMore(),
      });
      this.autoLoading.set(false);
      return;
    }
    this.autoLoading.set(true);
    this.pageSub = this.aggregator.nextPage().subscribe({
      next: (more) => {
        this.mergeStatuses(more);
        this.diagnostics.info('autoload:page-success', {
          received: more.length,
          stored: this.statuses().length,
          visible: this.visible().length,
        });
        this.publishMastodon(more);
        this.cacheAnonymousHome();
        this.fillToMinimum();
      },
      error: (error: unknown) => {
        this.diagnostics.error('autoload:page-error', error);
        this.autoLoading.set(false);
      },
    });
  }

  loadMore(): void {
    // Enforce the maximum: once the feed is this big, stop and start the
    // cooldown. Paging may overshoot slightly (a partial last page) — fine.
    if (this.statuses().length >= this.prefs.feedMax()) {
      this.maxHitAt.set(Date.now());
      this.loadBookmarkTail();
      return;
    }
    if (!this.canLoadMore()) {
      return;
    }
    this.autoLoading.set(true);
    this.pageSub = this.aggregator.nextPage().subscribe({
      next: (more) => {
        this.mergeStatuses(more);
        this.diagnostics.info('load-more:page-success', {
          received: more.length,
          stored: this.statuses().length,
          visible: this.visible().length,
        });
        this.publishMastodon(more);
        this.cacheAnonymousHome();
        this.autoLoading.set(false);
      },
      error: (error: unknown) => {
        this.diagnostics.error('load-more:page-error', error);
        this.autoLoading.set(false);
      },
    });
  }

  /** Later source rounds can overlap by date, so keep the accumulated feed merged. */
  private mergeStatuses(more: Status[]): void {
    this.statuses.update((statuses) =>
      this.auth.isAnonymous
        ? this.dedupeAnonymous([...statuses, ...more])
        : [...statuses, ...more].sort(
            (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
          ),
    );
  }

  /** Collapse duplicate public posts acquired through different Anonymous read routes. */
  private dedupeAnonymous(statuses: Status[]): Status[] {
    const newestFirst = statuses.sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    const seen = new Set<string>();
    return newestFirst.filter((status) => {
      const key = canonicalStatusKey(status);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private providerCounts(statuses: Status[]): Record<string, number> {
    return statuses.reduce<Record<string, number>>((counts, status) => {
      const provider = status.provider ?? 'mastodon';
      counts[provider] = (counts[provider] ?? 0) + 1;
      return counts;
    }, {});
  }

  /** Fetch the bookmark tail once per cap; a failure just means no tail. */
  private loadBookmarkTail(): void {
    if (this.bookmarkTail().length) {
      return;
    }
    if (this.auth.isAnonymous) {
      this.bookmarkTail.set(this.anonymousBookmarks.bookmarks().slice(0, BOOKMARK_TAIL_SIZE));
      return;
    }
    this.bookmarkSub = this.api.bookmarks(undefined, BOOKMARK_TAIL_SIZE).subscribe({
      next: (marks) => this.bookmarkTail.set(marks),
      error: () => undefined,
    });
  }

  onBookmarkChanged(original: Status, updated: Status): void {
    this.bookmarkTail.update((list) => list.map((s) => (s === original ? updated : s)));
  }

  onBookmarkDeleted(removed: Status): void {
    this.bookmarkTail.update((list) => list.filter((s) => s.id !== removed.id));
  }

  /** Timeline-derived widgets (who-to-follow) only understand Mastodon posts. */
  private publishMastodon(statuses: Status[]): void {
    if (this.auth.isAnonymous) {
      this.anonymousCorpus.ingest(statuses);
    }
    this.homeTimelineFeed.publish(
      statuses.filter((status) => !status.provider || status.provider === 'anonymous-mastodon'),
    );
  }

  private cacheAnonymousHome(): void {
    if (this.auth.isAnonymous) this.anonymousHomeCache.store(this.statuses());
  }

  onPosted(status: Status): void {
    this.statuses.update((s) => [status, ...s]);
  }

  onChanged(original: Status, updated: Status): void {
    this.statuses.update((list) => list.map((s) => (s === original ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
