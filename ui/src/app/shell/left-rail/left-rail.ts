import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountHoverCard } from '../../account-hover-card/account-hover-card';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, Tag } from '../../models';
import { HomeTimelineFeed } from '../../home-timeline-feed';
import { HumanCountPipe } from '../../human-count.pipe';
import { Terminology } from '../../terminology';
import { VerifiedBadge } from '../../verified-badge/verified-badge';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';
import { AnonymousAccount } from '../../providers/anonymous/anonymous-account';

/**
 * Left sidebar: the signed-in user's profile card (2018-Twitter style), a
 * "Who to follow" widget, and trending hashtags beneath it. Suggestions are
 * derived synthetically: accounts whose posts were boosted by other people on
 * the user's home timeline, uniquified, minus yourself and anyone you follow.
 */
@Component({
  selector: 'app-left-rail',
  imports: [RouterLink, VerifiedBadge, AccountHoverCard, HumanCountPipe],
  templateUrl: './left-rail.html',
  styleUrl: './left-rail.css',
})
export class LeftRail implements OnInit {
  protected auth = inject(Auth);
  private api = inject(Api);
  private homeTimelineFeed = inject(HomeTimelineFeed);
  private anonymousFollows = inject(AnonymousFollows);
  private anonymous = inject(AnonymousAccount);
  protected words = inject(Terminology).words;
  private candidates = new Map<string, Account>();

  protected suggestions = signal<Account[]>([]);
  /** Ids the user followed from this widget (flips the button to "Following"). */
  protected followed = signal<Set<string>>(new Set());
  protected trends = signal<Tag[]>([]);
  protected followingCount = computed(() =>
    this.auth.isAnonymous
      ? this.anonymousFollows.count()
      : (this.auth.account()?.following_count ?? 0),
  );

  /** Most recent day's use count for a trending tag, if the server provides one. */
  uses(tag: Tag): string | null {
    return tag.history?.[0]?.uses ?? null;
  }

  ngOnInit(): void {
    this.api.trendingTags().subscribe({
      next: (tags) => this.trends.set(tags),
      error: () => {
        // Sidebar widget: fail silently.
      },
    });
    this.homeTimelineFeed.loaded.subscribe((statuses) => {
      const me = this.auth.account()?.id;
      for (const s of statuses) {
        const boosted = s.reblog?.account;
        if (boosted && boosted.id !== me && boosted.id !== s.account.id) {
          this.candidates.set(boosted.id, boosted);
        }
      }
      if (!this.candidates.size) {
        this.suggestions.set([]);
        return;
      }
      const ids = [...this.candidates.keys()];
      if (this.auth.isAnonymous) {
        this.suggestions.set(
          ids
            .map((id) => this.candidates.get(id)!)
            .filter(
              (account) => !this.anonymousFollows.isFollowing(account, this.anonymous.server()),
            ),
        );
        return;
      }
      this.api.relationships(ids).subscribe({
        next: (rels) => {
          const excluded = new Set(
            rels.filter((r) => r.following || r.requested || r.blocking).map((r) => r.id),
          );
          this.suggestions.set(
            ids.filter((id) => !excluded.has(id)).map((id) => this.candidates.get(id)!),
          );
        },
        error: () => this.suggestions.set([...this.candidates.values()]),
      });
    });
  }

  follow(account: Account): void {
    if (this.auth.isAnonymous) {
      const result = this.anonymousFollows.follow(account, this.anonymous.server());
      if (result.ok) {
        this.followed.update((set) => new Set(set).add(account.id));
        this.suggestions.update((items) => items.filter((item) => item.id !== account.id));
      }
      return;
    }
    this.api.follow(account.id).subscribe({
      next: () => this.followed.update((set) => new Set(set).add(account.id)),
      error: () => {
        // Leave the button as-is; the user can retry.
      },
    });
  }
}
