import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { Api, AccountStatusesOptions } from '../api';
import { AnonymousPublicApi } from '../providers/anonymous/anonymous-public-api';
import { AnonymousPublicRef } from '../providers/anonymous/anonymous-route-ref';
import { HumanTimePipe } from '../human-time.pipe';
import { Account, Status } from '../models';
import { StatusCard } from '../status-card/status-card';
import {
  ActivityBucket,
  Heatmap,
  Liveliness,
  computeLiveliness,
  estimateTotalReach,
  hasMonthlyRange,
  hasWeeklyRange,
  monthlyActivity,
  postHeatmap,
  PostLengthRange,
  postLengthRange,
  repliesGiven,
  replyRatio,
  weekdayHistogram,
  weeklyActivity,
} from '../account-metrics';
import { LANG_NAMES, LangShare, detectLanguageMix, sharePct } from '../language-detect';
import { stripHtml } from '../sentiment';

/** How many of the account's most recent posts the component analyzes. */
const SAMPLE_SIZE = 100;
/** Mastodon caps account-statuses pages at 40. */
const PAGE_LIMIT = 40;
/** Guard against endless paging on very sparse accounts. */
const MAX_PAGES = 5;
/** Extra pages a user may request via "get more posts", each = one API call. */
const LOAD_MORE_CHOICES = [1, 3, 5, 10] as const;

/**
 * Rudimentary Twitter-style analytics for any account, deliberately cheap:
 * everything is computed from the account's last ~100 posts (3 API calls) plus
 * one page of followers — no history endpoints, no per-day queries, nothing
 * expensive. Boosts of others are excluded from the sample (their engagement
 * isn't ours). The API calls fire in ngOnInit, so mounting this component is
 * what triggers them — keep it behind a lazily-shown tab to stay non-eager.
 */
@Component({
  selector: 'app-account-analytics',
  imports: [RouterLink, StatusCard, HumanTimePipe],
  templateUrl: './account-analytics.html',
  styleUrl: './account-analytics.css',
})
export class AccountAnalytics implements OnInit {
  private api = inject(Api);
  private anonymousPublic = inject(AnonymousPublicApi);

  /** The account to analyze. */
  readonly account = input.required<Account>();
  /** Present when the account is an anonymous public profile (read-only API). */
  readonly publicRef = input<AnonymousPublicRef | null>(null);

  protected loading = signal(true);
  protected error = signal(false);
  /** The analyzed sample: own posts only, newest first. */
  protected posts = signal<Status[]>([]);
  protected followers = signal<Account[]>([]);
  protected followersLoaded = signal(false);

  /** True while a user-requested "load more" batch is in flight. */
  protected loadingMore = signal(false);
  /** False once the account has no older posts left to page. */
  protected hasMore = signal(true);
  /** maxId cursor for the next page beyond the current sample. */
  private cursor: string | undefined;
  /** How many extra pages the "load more" control offers, each one API call. */
  protected readonly loadMoreChoices = LOAD_MORE_CHOICES;

  ngOnInit(): void {
    const acc = this.account();
    const id = this.publicRef()?.id ?? acc.id;
    this.fetchPosts(id, [], undefined, 0);
    this.getFollowers(id).subscribe({
      next: (accounts) => {
        this.followers.set(accounts);
        this.followersLoaded.set(true);
      },
      error: () => this.followersLoaded.set(true),
    });
  }

  private getFollowers(id: string): Observable<Account[]> {
    const ref = this.publicRef();
    return ref
      ? this.anonymousPublic.getAccountFollowers({ ...ref, id })
      : this.api.accountFollowers(id);
  }

  private getStatuses(id: string, opts: AccountStatusesOptions): Observable<Status[]> {
    const ref = this.publicRef();
    return ref
      ? this.anonymousPublic.getAccountStatuses({ ...ref, id }, opts)
      : this.api.getAccountStatuses(id, opts);
  }

  /**
   * Page own statuses (boosts excluded server-side) until the sample is full.
   * The initial load fetches enough pages to reach {@link SAMPLE_SIZE} (an
   * overage on the last page is fine and always has been). Unlike the initial
   * cap, {@link loadMore} lets the user deliberately spend more API calls to
   * widen the window — no {@link SAMPLE_SIZE} truncation there.
   */
  private fetchPosts(id: string, acc: Status[], maxId: string | undefined, page: number): void {
    this.getStatuses(id, { limit: PAGE_LIMIT, maxId, excludeReblogs: true }).subscribe({
      next: (batch) => {
        const all = [...acc, ...batch];
        const exhausted = batch.length < PAGE_LIMIT;
        if (exhausted || all.length >= SAMPLE_SIZE || page + 1 >= MAX_PAGES) {
          this.posts.set(all);
          this.cursor = all.length ? all[all.length - 1].id : undefined;
          this.hasMore.set(!exhausted);
          this.loading.set(false);
        } else {
          this.fetchPosts(id, all, batch[batch.length - 1].id, page + 1);
        }
      },
      error: () => {
        this.posts.set(acc);
        this.loading.set(false);
        this.error.set(acc.length === 0);
      },
    });
  }

  /**
   * Fetch `pages` more pages of older posts on demand — each page is exactly
   * one API call, so the control asks the user how many to spend. Appends to
   * the existing sample; every metric recomputes automatically off `posts()`.
   */
  loadMore(pages: number): void {
    if (this.loadingMore() || !this.hasMore()) {
      return;
    }
    const id = this.publicRef()?.id ?? this.account().id;
    this.loadingMore.set(true);
    this.fetchMore(id, pages, 0);
  }

  private fetchMore(id: string, remaining: number, done: number): void {
    if (remaining <= 0) {
      this.loadingMore.set(false);
      return;
    }
    this.getStatuses(id, {
      limit: PAGE_LIMIT,
      maxId: this.cursor,
      excludeReblogs: true,
    }).subscribe({
      next: (batch) => {
        if (batch.length) {
          this.posts.update((prev) => [...prev, ...batch]);
          this.cursor = batch[batch.length - 1].id;
        }
        if (batch.length < PAGE_LIMIT) {
          this.hasMore.set(false);
          this.loadingMore.set(false);
          return;
        }
        this.fetchMore(id, remaining - 1, done + 1);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  // --- KPI tiles ---

  protected totalFavourites = computed(() =>
    this.posts().reduce((sum, s) => sum + s.favourites_count, 0),
  );
  protected totalBoosts = computed(() => this.posts().reduce((sum, s) => sum + s.reblogs_count, 0));
  protected totalReplies = computed(() =>
    this.posts().reduce((sum, s) => sum + s.replies_count, 0),
  );

  /** Average engagements (favs + boosts + replies) per analyzed post. */
  protected avgEngagement = computed(() => {
    const n = this.posts().length;
    if (!n) {
      return 0;
    }
    return (
      Math.round(((this.totalFavourites() + this.totalBoosts() + this.totalReplies()) / n) * 10) /
      10
    );
  });

  /** Posts per day across the sample's time span (newest → oldest). */
  protected postsPerDay = computed(() => {
    const posts = this.posts();
    if (posts.length < 2) {
      return posts.length;
    }
    const newest = new Date(posts[0].created_at).getTime();
    const oldest = new Date(posts[posts.length - 1].created_at).getTime();
    const days = Math.max(1, (newest - oldest) / 86_400_000);
    return Math.round((posts.length / days) * 10) / 10;
  });

  /** When the oldest analyzed post was made — names the sample's period. */
  protected oldestPostDate = computed(() => this.posts().at(-1)?.created_at ?? null);

  // --- Conversation and post length ---

  /**
   * How much of the sample is replies to other people, as a percentage.
   *
   * The tile that answers "is anyone actually home?" — a 0% account that posts
   * daily is usually a feed or a cross-poster rather than a person.
   */
  protected replyRatioPct = computed(() => replyRatio(this.posts()));

  /** The raw count behind the ratio, shown as the tile's subtitle. */
  protected repliesGiven = computed(() => repliesGiven(this.posts()));

  /** Shortest and longest original post, in visible characters. */
  protected lengthRange = computed<PostLengthRange | null>(() => postLengthRange(this.posts()));

  // --- Reach (estimated; see account-metrics.ts REACH_MODEL) ---

  /** Total estimated reach across the sample — followers + boost/fav model. */
  protected totalReach = computed(() =>
    estimateTotalReach(this.posts(), this.account().followers_count),
  );

  /** Estimated reach per post. */
  protected reachPerPost = computed(() => {
    const n = this.posts().length;
    return n ? Math.round(this.totalReach() / n) : 0;
  });

  /**
   * Reach trend: newer-half vs older-half average reach, as a percent change.
   * Null when the sample is too small to split meaningfully.
   */
  protected reachTrendPct = computed<number | null>(() => {
    const posts = this.posts();
    if (posts.length < 6) {
      return null;
    }
    const followers = this.account().followers_count;
    const mid = Math.floor(posts.length / 2);
    const newer = posts.slice(0, mid); // newest-first, so this is the recent half
    const older = posts.slice(mid);
    const avg = (list: Status[]) => estimateTotalReach(list, followers) / list.length;
    const olderAvg = avg(older);
    if (olderAvg <= 0) {
      return null;
    }
    return Math.round(((avg(newer) - olderAvg) / olderAvg) * 100);
  });

  // --- Liveliness (recency-weighted, relative to now) ---

  protected liveliness = computed<Liveliness>(() => computeLiveliness(this.posts()));

  // --- Time-window activity ("when they post") ---

  protected weekly = computed<ActivityBucket[]>(() =>
    weeklyActivity(this.posts(), this.account().followers_count),
  );
  protected monthly = computed<ActivityBucket[]>(() =>
    monthlyActivity(this.posts(), this.account().followers_count),
  );
  protected showWeekly = computed(() => hasWeeklyRange(this.posts()));
  protected showMonthly = computed(() => hasMonthlyRange(this.posts()));
  protected weekdays = computed(() => weekdayHistogram(this.posts()));

  /** Max post count in a weekly bucket, for bar scaling. */
  protected weeklyPeak = computed(() => Math.max(1, ...this.weekly().map((b) => b.posts)));
  /** Max post count in a monthly bucket, for bar scaling. */
  protected monthlyPeak = computed(() => Math.max(1, ...this.monthly().map((b) => b.posts)));
  /** Max post count in a weekday bucket, for bar scaling. */
  protected weekdayPeak = computed(() => Math.max(1, ...this.weekdays().map((b) => b.posts)));

  /** CSS class for the liveliness pill. */
  protected livelinessClass = computed(() => 'live-' + this.liveliness().label.toLowerCase());

  // --- Language mix (cheap script/stop-word detector) ---

  /**
   * Estimated language distribution across the sample. Each post contributes its
   * text plus its Mastodon-declared `language` as an authoritative prior.
   */
  protected languages = computed<LangShare[]>(() =>
    detectLanguageMix(this.posts().map((s) => ({ text: stripHtml(s.content), meta: s.language }))),
  );

  langName(code: LangShare['lang']): string {
    return LANG_NAMES[code];
  }
  langPct = sharePct;

  private engagement(s: Status): number {
    return s.favourites_count + s.reblogs_count + s.replies_count;
  }

  /** Top 3 posts by total engagement (ties break toward newer). */
  protected topPosts = computed(() =>
    [...this.posts()]
      .sort((a, b) => this.engagement(b) - this.engagement(a))
      .slice(0, 3)
      .filter((s) => this.engagement(s) > 0),
  );

  /** The follower with the biggest audience of their own. */
  protected topFollower = computed<Account | null>(() => {
    const list = this.followers();
    if (!list.length) {
      return null;
    }
    return list.reduce((best, a) => (a.followers_count > best.followers_count ? a : best));
  });

  // --- Contribution heatmap ---

  /**
   * The "lawn". Covers only the span the sample covers, so a busy account gets
   * a few dense weeks rather than a mostly-empty year — use "get more posts"
   * above to widen it.
   */
  protected heatmap = computed<Heatmap>(() => postHeatmap(this.posts()));

  /** Levels 0–4, for the legend swatches. */
  protected readonly heatLevels = [0, 1, 2, 3, 4];

  /** The grid is decorative per-cell; this sentence is what screen readers get. */
  protected heatmapSummary = computed(() => {
    const map = this.heatmap();
    return `Posting calendar: ${this.posts().length} posts across ${map.days} days, ${map.activeDays} of which had posts. Busiest day: ${map.peak}.`;
  });

  /** Compact display for tile values: 12,345 → 12.3K. */
  fmt(n: number): string {
    if (n >= 1_000_000) {
      return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (n >= 10_000) {
      return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return n.toLocaleString();
  }
}
