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

interface SuggestionCandidate {
  account: Account;
  boosters: Set<string>;
  sources: Set<string>;
  occurrences: number;
  lastSeen: number;
}

function accountKey(account: Account): string {
  if (account.url) return account.url.toLowerCase().replace(/\/$/, '');
  return account.acct.toLowerCase();
}

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
  private candidates = new Map<string, SuggestionCandidate>();

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
      const me = this.auth.account();
      const meKey = me ? accountKey(me) : '';
      for (const s of statuses) {
        const boosted = s.reblog?.account;
        const key = boosted ? accountKey(boosted) : '';
        if (boosted && key !== meKey && key !== accountKey(s.account)) {
          const candidate = this.candidates.get(key) ?? {
            account: boosted,
            boosters: new Set<string>(),
            sources: new Set<string>(),
            occurrences: 0,
            lastSeen: 0,
          };
          candidate.account = boosted;
          candidate.boosters.add(accountKey(s.account));
          candidate.sources.add(s.provider ?? 'mastodon');
          candidate.occurrences += 1;
          candidate.lastSeen = Math.max(candidate.lastSeen, Date.parse(s.created_at) || 0);
          this.candidates.set(key, candidate);
        }
      }
      if (!this.candidates.size) {
        this.suggestions.set([]);
        return;
      }
      const ranked = [...this.candidates.values()].sort(
        (a, b) =>
          b.boosters.size - a.boosters.size ||
          b.sources.size - a.sources.size ||
          b.occurrences - a.occurrences ||
          b.lastSeen - a.lastSeen,
      );
      if (this.auth.isAnonymous) {
        this.suggestions.set(
          ranked
            .map((candidate) => candidate.account)
            .filter(
              (account) => !this.anonymousFollows.isFollowing(account, this.anonymous.server()),
            ),
        );
        return;
      }
      const ids = ranked.map((candidate) => candidate.account.id);
      this.api.relationships(ids).subscribe({
        next: (rels) => {
          const excluded = new Set(
            rels.filter((r) => r.following || r.requested || r.blocking).map((r) => r.id),
          );
          this.suggestions.set(
            ranked
              .map((candidate) => candidate.account)
              .filter((account) => !excluded.has(account.id)),
          );
        },
        error: () => this.suggestions.set(ranked.map((candidate) => candidate.account)),
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
