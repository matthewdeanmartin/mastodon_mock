import { Component, computed, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Location, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { Api } from '../../api';
import { Terminology } from '../../terminology';
import { Auth } from '../../auth';
import { Account, Relationship, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { ReportDialog } from '../../report-dialog/report-dialog';
import { ListDialog } from '../../list-dialog/list-dialog';
import { VerifiedBadge } from '../../verified-badge/verified-badge';
import { HumanCountPipe } from '../../human-count.pipe';
import { PeopleBrowser } from '../../people-browser/people-browser';
import { RssProvider } from '../../providers/rss/rss-provider';
import { RssSubscriptions } from '../../providers/rss/rss-subscriptions';
import { AnonymousAccount } from '../../providers/anonymous/anonymous-account';
import { AnonymousCapabilities } from '../../providers/anonymous/anonymous-capabilities';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';

/** Profile body tabs: the account's posts, who they follow, who follows them. */
type ProfileTab = 'posts' | 'following' | 'followers';

@Component({
  selector: 'app-profile',
  imports: [
    RouterLink,
    StatusCard,
    ReportDialog,
    ListDialog,
    VerifiedBadge,
    HumanCountPipe,
    PeopleBrowser,
    NgOptimizedImage,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile implements OnInit, OnDestroy {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  protected words = inject(Terminology).words;
  protected auth = inject(Auth);
  protected capabilities = inject(AnonymousCapabilities);
  private anonymous = inject(AnonymousAccount);
  protected anonymousFollows = inject(AnonymousFollows);
  private location = inject(Location);
  private rss = inject(RssProvider);
  private rssSubs = inject(RssSubscriptions);
  private destroyRef = inject(DestroyRef);
  private routeLoadSub = new Subscription();
  private statusLoadSub = new Subscription();

  /** True when this "profile" is a synthetic RSS feed (id `rss:<feedUrl>`). */
  protected isRss = signal(false);
  /** The feed URL behind an RSS profile, for the subscribe toggle. */
  private rssFeedUrl = signal<string | null>(null);
  /** Whether the viewer is currently subscribed to this feed. */
  protected rssSubscribed = computed(() => {
    const url = this.rssFeedUrl();
    return !!url && this.rssSubs.has(url) && this.rssSubs.enabledFeeds().some((f) => f.url === url);
  });

  toggleRssSubscription(): void {
    const url = this.rssFeedUrl();
    const account = this.account();
    if (!url) {
      return;
    }
    if (this.rssSubs.has(url)) {
      this.rssSubs.remove(url);
    } else {
      this.followError.set(this.rssSubs.add(url, account?.display_name || url));
    }
  }

  protected account = signal<Account | null>(null);
  protected statuses = signal<Status[]>([]);
  protected relationship = signal<Relationship | null>(null);
  protected loading = signal(true);
  protected statusesLoading = signal(false);
  protected loadingMore = signal(false);
  /** An older page came back empty: the account's history is fully loaded. */
  protected exhausted = signal(false);

  // Timeline filter toggles. Defaults mirror Mastodon's profile view:
  // boosts shown, replies hidden, pinned strip on top.
  protected showBoosts = signal(true);
  protected showReplies = signal(false);
  protected showPinned = signal(true);
  protected pinnedStatuses = signal<Status[]>([]);
  /** Which body tab is showing: the posts feed, or a people browser. */
  protected tab = signal<ProfileTab>('posts');

  setTab(tab: ProfileTab): void {
    this.tab.set(tab);
  }
  /** Invalidates in-flight status fetches when filters change or the route moves. */
  private loadSeq = 0;

  /** The main list, minus anything already shown in the pinned strip. */
  protected visibleStatuses = computed(() => {
    if (!this.showPinned()) {
      return this.statuses();
    }
    const pinnedIds = new Set(this.pinnedStatuses().map((s) => s.id));
    return this.statuses().filter((s) => !pinnedIds.has(s.id));
  });

  protected showReport = signal(false);
  protected showLists = signal(false);
  protected reportDone = signal(false);
  protected showBlockConfirm = signal(false);
  protected followError = signal<string | null>(null);

  protected isSelf = computed(() => this.account()?.id === this.auth.account()?.id);

  /** Accounts this profile features ("collections") — shown prominently up top. */
  protected featured = signal<Account[]>([]);
  /** Ids among featured() the viewer already follows (or has requested). */
  protected featuredFollowing = signal<Set<string>>(new Set());
  protected featuredBusy = signal(false);

  protected featuredToFollow = computed(() =>
    this.featured().filter(
      (f) => !this.featuredFollowing().has(f.id) && f.id !== this.auth.account()?.id,
    ),
  );

  /** Return to the previous page (e.g. back to search results). */
  goBack(): void {
    this.location.back();
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.load(id);
      }
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (this.auth.isAnonymous && this.isSelf()) {
        this.tab.set(params.get('tab') === 'following' ? 'following' : 'posts');
      }
    });
  }

  ngOnDestroy(): void {
    this.routeLoadSub.unsubscribe();
    this.statusLoadSub.unsubscribe();
  }

  load(id: string): void {
    this.routeLoadSub.unsubscribe();
    this.routeLoadSub = new Subscription();
    this.statusLoadSub.unsubscribe();
    this.loading.set(true);
    this.relationship.set(null);
    this.reportDone.set(false);
    this.followError.set(null);
    this.isRss.set(false);
    this.rssFeedUrl.set(null);
    this.tab.set('posts');
    if (id.startsWith('rss:')) {
      this.loadRss(id);
      return;
    }
    if (this.auth.isAnonymous && id === 'anonymous') {
      this.account.set(this.anonymous.account());
      this.statuses.set([]);
      this.pinnedStatuses.set([]);
      this.featured.set([]);
      this.loading.set(false);
      this.statusesLoading.set(false);
      this.exhausted.set(true);
      this.tab.set(
        this.route.snapshot.queryParamMap.get('tab') === 'following' ? 'following' : 'posts',
      );
      return;
    }
    this.routeLoadSub.add(
      this.api.getAccount(id).subscribe((a) => {
        this.account.set(a);
        if (this.auth.isAnonymous) {
          this.relationship.set(this.anonymousFollows.relationship(a, this.anonymous.server()));
        }
        this.loading.set(false);
      }),
    );
    this.loadStatuses(id);
    this.loadPinned(id);
    if (this.capabilities.canManageRelationships) {
      this.routeLoadSub.add(
        this.api.relationships([id]).subscribe((rels) => this.relationship.set(rels[0] ?? null)),
      );
    }
    this.loadFeatured(id);
  }

  /**
   * An RSS feed as a synthetic profile: the feed's account plus its items as the
   * timeline. No relationships, pinned, or featured — those are Mastodon-only.
   * Feeds have no pagination, so the whole feed loads at once (exhausted).
   */
  private loadRss(id: string): void {
    this.isRss.set(true);
    const feedUrl = id.slice('rss:'.length);
    this.rssFeedUrl.set(feedUrl);
    this.statuses.set([]);
    this.pinnedStatuses.set([]);
    this.featured.set([]);
    this.statusesLoading.set(true);
    this.exhausted.set(true);
    const seq = ++this.loadSeq;
    this.statusLoadSub = this.rss.getFeed(feedUrl).subscribe({
      next: ({ account, statuses }) => {
        if (seq !== this.loadSeq) {
          return;
        }
        this.account.set(account);
        this.statuses.set(statuses);
        this.loading.set(false);
        this.statusesLoading.set(false);
      },
      error: () => {
        if (seq !== this.loadSeq) {
          return;
        }
        // No account to show; the template falls back to "Account not found".
        this.loading.set(false);
        this.statusesLoading.set(false);
      },
    });
  }

  toggleBoosts(): void {
    this.showBoosts.update((v) => !v);
    this.reloadStatuses();
  }

  toggleReplies(): void {
    this.showReplies.update((v) => !v);
    this.reloadStatuses();
  }

  togglePinned(): void {
    this.showPinned.update((v) => !v);
  }

  private reloadStatuses(): void {
    const id = this.account()?.id;
    if (id) {
      this.loadStatuses(id);
    }
  }

  /** How many statuses a filtered profile view should end up with. */
  private static readonly TARGET_COUNT = 20;
  /** Safety cap on the fetch-until-full loop (filtered pages can come back short). */
  private static readonly MAX_PAGES = 8;

  /**
   * Load the account's statuses under the current filter toggles. Mastodon
   * applies exclude_* filtering per page, so filtered pages can return fewer
   * than `limit` items — keep paging older until TARGET_COUNT accumulate,
   * the account runs out, or MAX_PAGES is hit.
   */
  private loadStatuses(id: string): void {
    this.statusLoadSub.unsubscribe();
    this.statusLoadSub = new Subscription();
    const seq = ++this.loadSeq;
    this.statuses.set([]);
    this.statusesLoading.set(true);
    this.exhausted.set(false);
    const opts = {
      excludeReblogs: !this.showBoosts(),
      excludeReplies: !this.showReplies(),
      limit: Profile.TARGET_COUNT,
    };
    const fetchPage = (maxId: string | undefined, acc: Status[], page: number): void => {
      this.statusLoadSub.add(
        this.api.getAccountStatuses(id, { ...opts, maxId }).subscribe({
          next: (batch) => {
            if (seq !== this.loadSeq) {
              return; // A newer load superseded this one.
            }
            const all = [...acc, ...batch];
            if (batch.length > 0 && all.length < Profile.TARGET_COUNT && page < Profile.MAX_PAGES) {
              fetchPage(batch[batch.length - 1].id, all, page + 1);
              return;
            }
            this.statuses.set(all);
            this.statusesLoading.set(false);
          },
          error: () => {
            if (seq === this.loadSeq) {
              this.statuses.set(acc);
              this.statusesLoading.set(false);
            }
          },
        }),
      );
    };
    fetchPage(undefined, [], 1);
  }

  /** Fetch one older page below the current list ("Load more" at the bottom). */
  loadMore(): void {
    const id = this.account()?.id;
    const last = this.statuses().at(-1);
    if (!id || !last || this.loadingMore() || this.exhausted()) {
      return;
    }
    const seq = this.loadSeq;
    this.loadingMore.set(true);
    this.api
      .getAccountStatuses(id, {
        excludeReblogs: !this.showBoosts(),
        excludeReplies: !this.showReplies(),
        limit: Profile.TARGET_COUNT,
        maxId: last.id,
      })
      .subscribe({
        next: (batch) => {
          this.loadingMore.set(false);
          if (seq !== this.loadSeq) {
            return; // Filters changed or the route moved mid-flight.
          }
          if (!batch.length) {
            this.exhausted.set(true);
            return;
          }
          const seen = new Set(this.statuses().map((s) => s.id));
          this.statuses.update((list) => [...list, ...batch.filter((s) => !seen.has(s.id))]);
        },
        error: () => this.loadingMore.set(false),
      });
  }

  private loadPinned(id: string): void {
    this.pinnedStatuses.set([]);
    this.routeLoadSub.add(
      this.api.getAccountStatuses(id, { pinned: true }).subscribe({
        next: (pinned) => this.pinnedStatuses.set(pinned),
        error: () => {
          // No pinned strip, the rest of the profile still works.
        },
      }),
    );
  }

  private loadFeatured(id: string): void {
    this.featured.set([]);
    this.featuredFollowing.set(new Set());
    this.routeLoadSub.add(
      this.api.accountEndorsements(id).subscribe({
        next: (accounts) => {
          this.featured.set(accounts);
          if (!accounts.length) {
            return;
          }
          if (this.auth.isAnonymous) {
            this.featuredFollowing.set(
              new Set(
                accounts
                  .filter((account) =>
                    this.anonymousFollows.isFollowing(account, this.anonymous.server()),
                  )
                  .map((account) => account.id),
              ),
            );
            return;
          }
          if (!this.capabilities.canManageRelationships) {
            return;
          }
          this.routeLoadSub.add(
            this.api.relationships(accounts.map((a) => a.id)).subscribe({
              next: (rels) =>
                this.featuredFollowing.set(
                  new Set(rels.filter((r) => r.following || r.requested).map((r) => r.id)),
                ),
              error: () => {
                // Follow buttons just show for everyone; following again is harmless.
              },
            }),
          );
        },
        error: () => {
          // Older servers (pre-4.4) 404 here; the section simply doesn't render.
        },
      }),
    );
  }

  followFeatured(target: Account): void {
    if (this.auth.isAnonymous) {
      const result = this.anonymousFollows.follow(target, this.anonymous.server());
      if (result.ok) {
        this.featuredFollowing.update((set) => new Set(set).add(target.id));
        this.followError.set(null);
      } else {
        this.followError.set(result.error);
      }
      return;
    }
    this.api.follow(target.id).subscribe((rel) => {
      if (rel.following || rel.requested) {
        this.featuredFollowing.update((s) => new Set(s).add(target.id));
      }
    });
  }

  /** Follow every featured account the viewer doesn't already follow, one at a time. */
  async followAllFeatured(): Promise<void> {
    if (this.featuredBusy()) {
      return;
    }
    this.featuredBusy.set(true);
    try {
      for (const target of this.featuredToFollow()) {
        if (this.auth.isAnonymous) {
          const result = this.anonymousFollows.follow(target, this.anonymous.server());
          if (!result.ok) {
            this.followError.set(result.error);
            break;
          }
          this.featuredFollowing.update((set) => new Set(set).add(target.id));
          continue;
        }
        try {
          const rel = await firstValueFrom(this.api.follow(target.id));
          if (rel.following || rel.requested) {
            this.featuredFollowing.update((s) => new Set(s).add(target.id));
          }
        } catch {
          // Keep going; one failed follow shouldn't abort the batch.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      this.featuredBusy.set(false);
    }
  }

  toggleFollow(): void {
    const acc = this.account();
    const rel = this.relationship();
    if (!acc) {
      return;
    }
    this.followError.set(null);
    if (this.auth.isAnonymous) {
      if (rel?.following) {
        this.relationship.set(this.anonymousFollows.unfollow(acc, this.anonymous.server()));
        return;
      }
      const result = this.anonymousFollows.follow(acc, this.anonymous.server());
      this.relationship.set(result.relationship);
      if (!result.ok) {
        this.followError.set(result.error);
      }
      return;
    }
    const call = rel?.following ? this.api.unfollow(acc.id) : this.api.follow(acc.id);
    call.subscribe((updated) => this.relationship.set(updated));
  }

  /** Mute duration presets (seconds; null = until unmuted). */
  protected readonly muteDurations: { label: string; seconds: number | null }[] = [
    { label: '1 hour', seconds: 3600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: 'forever', seconds: null },
  ];

  mute(seconds: number | null): void {
    const acc = this.account();
    if (!acc) {
      return;
    }
    this.api
      .muteAccount(acc.id, seconds ?? undefined)
      .subscribe((updated) => this.relationship.set(updated));
  }

  unmute(): void {
    const acc = this.account();
    if (!acc) {
      return;
    }
    this.api.unmuteAccount(acc.id).subscribe((updated) => this.relationship.set(updated));
  }

  toggleBlock(): void {
    const acc = this.account();
    const rel = this.relationship();
    if (!acc) {
      return;
    }
    const call = rel?.blocking ? this.api.unblockAccount(acc.id) : this.api.block(acc.id);
    call.subscribe((updated) => this.relationship.set(updated));
  }

  requestBlock(): void {
    if (this.relationship()?.blocking) {
      this.toggleBlock();
      return;
    }
    this.showBlockConfirm.set(true);
  }

  confirmBlock(): void {
    this.showBlockConfirm.set(false);
    this.toggleBlock();
  }

  onChanged(updated: Status): void {
    this.statuses.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
    this.pinnedStatuses.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
    this.pinnedStatuses.update((list) => list.filter((s) => s.id !== removed.id));
  }

  onReported(): void {
    this.showReport.set(false);
    this.reportDone.set(true);
  }
}
