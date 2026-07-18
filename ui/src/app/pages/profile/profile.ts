import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, Relationship, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { ReportDialog } from '../../report-dialog/report-dialog';
import { ListDialog } from '../../list-dialog/list-dialog';
import { VerifiedBadge } from '../../verified-badge/verified-badge';

@Component({
  selector: 'app-profile',
  imports: [RouterLink, StatusCard, ReportDialog, ListDialog, VerifiedBadge],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private auth = inject(Auth);
  private location = inject(Location);

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
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.load(id);
      }
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.relationship.set(null);
    this.reportDone.set(false);
    this.api.getAccount(id).subscribe((a) => {
      this.account.set(a);
      this.loading.set(false);
    });
    this.loadStatuses(id);
    this.loadPinned(id);
    this.api.relationships([id]).subscribe((rels) => this.relationship.set(rels[0] ?? null));
    this.loadFeatured(id);
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
      });
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
    this.api.getAccountStatuses(id, { pinned: true }).subscribe({
      next: (pinned) => this.pinnedStatuses.set(pinned),
      error: () => {
        // No pinned strip, the rest of the profile still works.
      },
    });
  }

  private loadFeatured(id: string): void {
    this.featured.set([]);
    this.featuredFollowing.set(new Set());
    this.api.accountEndorsements(id).subscribe({
      next: (accounts) => {
        this.featured.set(accounts);
        if (!accounts.length) {
          return;
        }
        this.api.relationships(accounts.map((a) => a.id)).subscribe({
          next: (rels) =>
            this.featuredFollowing.set(
              new Set(rels.filter((r) => r.following || r.requested).map((r) => r.id)),
            ),
          error: () => {
            // Follow buttons just show for everyone; following again is harmless.
          },
        });
      },
      error: () => {
        // Older servers (pre-4.4) 404 here; the section simply doesn't render.
      },
    });
  }

  followFeatured(target: Account): void {
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
