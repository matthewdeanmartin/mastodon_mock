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
import { FeedAggregator } from '../../providers/feed-aggregator';

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
  private auth = inject(Auth);
  private prefs = inject(ClientPrefs);
  private streaming = inject(Streaming);
  private homeTimelineFeed = inject(HomeTimelineFeed);
  private aggregator = inject(FeedAggregator);
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

  load(): void {
    this.pageSub?.unsubscribe();
    this.autoLoading.set(false);
    this.loading.set(true);
    this.maxHitAt.set(null);
    this.bookmarkTail.set([]);
    this.aggregator.reset();
    this.pageSub = this.aggregator.nextPage().subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.publishMastodon(s);
        this.loading.set(false);
        // Auto-load further pages until the feed reaches the configured minimum.
        this.fillToMinimum();
      },
      error: () => this.loading.set(false),
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
      this.autoLoading.set(false);
      return;
    }
    this.autoLoading.set(true);
    this.pageSub = this.aggregator.nextPage().subscribe({
      next: (more) => {
        this.mergeStatuses(more);
        this.publishMastodon(more);
        this.fillToMinimum();
      },
      error: () => this.autoLoading.set(false),
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
        this.publishMastodon(more);
        this.autoLoading.set(false);
      },
      error: () => this.autoLoading.set(false),
    });
  }

  /** Later source rounds can overlap by date, so keep the accumulated feed merged. */
  private mergeStatuses(more: Status[]): void {
    this.statuses.update((statuses) =>
      [...statuses, ...more].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    );
  }

  /** Fetch the bookmark tail once per cap; a failure just means no tail. */
  private loadBookmarkTail(): void {
    if (this.bookmarkTail().length) {
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
    this.homeTimelineFeed.publish(statuses.filter((s) => !s.provider));
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
