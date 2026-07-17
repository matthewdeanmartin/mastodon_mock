import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { HumanTimePipe } from '../../human-time.pipe';
import { Account, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

/** How many of the user's most recent posts the page analyzes. */
const SAMPLE_SIZE = 100;
/** Mastodon caps account-statuses pages at 40. */
const PAGE_LIMIT = 40;
/** Guard against endless paging on very sparse accounts. */
const MAX_PAGES = 5;

/**
 * Rudimentary Twitter-style analytics, deliberately cheap: everything is
 * computed from the viewer's last ~100 posts (3 API calls) plus one page of
 * followers — no history endpoints, no per-day queries, nothing expensive.
 * Boosts of others are excluded from the sample (their engagement isn't ours).
 */
@Component({
  selector: 'app-analytics',
  imports: [RouterLink, StatusCard, HumanTimePipe],
  templateUrl: './analytics.html',
  styleUrl: './analytics.css',
})
export class Analytics implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);

  protected loading = signal(true);
  protected error = signal(false);
  /** The analyzed sample: own posts only, newest first. */
  protected posts = signal<Status[]>([]);
  protected followers = signal<Account[]>([]);
  protected followersLoaded = signal(false);

  ngOnInit(): void {
    const me = this.auth.account();
    if (!me) {
      this.loading.set(false);
      this.error.set(true);
      return;
    }
    this.fetchPosts(me.id, [], undefined, 0);
    this.api.accountFollowers(me.id).subscribe({
      next: (accounts) => {
        this.followers.set(accounts);
        this.followersLoaded.set(true);
      },
      error: () => this.followersLoaded.set(true),
    });
  }

  /** Page own statuses (boosts excluded server-side) until the sample is full. */
  private fetchPosts(id: string, acc: Status[], maxId: string | undefined, page: number): void {
    this.api.getAccountStatuses(id, { limit: PAGE_LIMIT, maxId, excludeReblogs: true }).subscribe({
      next: (batch) => {
        const all = [...acc, ...batch];
        if (batch.length < PAGE_LIMIT || all.length >= SAMPLE_SIZE || page + 1 >= MAX_PAGES) {
          this.posts.set(all.slice(0, SAMPLE_SIZE));
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

  protected me = computed(() => this.auth.account());

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
