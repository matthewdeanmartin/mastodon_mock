import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../api';
import { Auth } from '../auth';
import { Account, Relationship } from '../models';
import { VerifiedBadge } from '../verified-badge/verified-badge';
import { AnonymousAccount } from '../providers/anonymous/anonymous-account';
import { AnonymousFollows } from '../providers/anonymous/anonymous-follows';

/** Which list this widget pages through. */
export type PeopleMode = 'followers' | 'following';

/** Per-account follow state, so the button can show the right label + spinner. */
type FollowState = 'idle' | 'busy';

/**
 * A pageable browser for an account's followers or following list. Renders each
 * account as a card (avatar, name, bio, counts) with a follow/unfollow toggle
 * wired to the viewer's real relationship, plus a "More" button that pages to
 * the next batch. Relationships are fetched one page at a time so the toggle is
 * always accurate without over-fetching.
 */
@Component({
  selector: 'app-people-browser',
  imports: [RouterLink, VerifiedBadge],
  templateUrl: './people-browser.html',
  styleUrl: './people-browser.css',
})
export class PeopleBrowser {
  private api = inject(Api);
  private auth = inject(Auth);
  private anonymous = inject(AnonymousAccount);
  private anonymousFollows = inject(AnonymousFollows);

  /** Whose followers/following to show. */
  readonly accountId = input.required<string>();
  /** 'followers' (people who follow them) or 'following' (people they follow). */
  readonly mode = input<PeopleMode>('followers');

  protected accounts = signal<Account[]>([]);
  protected loading = signal(true);
  protected loadingMore = signal(false);
  /** An empty page came back: the list is fully paged in. */
  protected exhausted = signal(false);
  protected error = signal(false);

  /** Relationship per account id, for the follow button state. */
  private rels = signal<Map<string, Relationship>>(new Map());
  /** In-flight follow toggles, so their buttons disable + show progress. */
  private pending = signal<Map<string, FollowState>>(new Map());

  protected me = this.auth.account;

  constructor() {
    // Reload from scratch whenever the target account or the mode changes.
    effect(() => {
      // Touch the inputs so the effect re-runs on either change.
      this.accountId();
      this.mode();
      this.reset();
      this.loadFirst();
    });
  }

  private reset(): void {
    this.accounts.set([]);
    this.rels.set(new Map());
    this.pending.set(new Map());
    this.loading.set(true);
    this.loadingMore.set(false);
    this.exhausted.set(false);
    this.error.set(false);
  }

  private fetch(maxId?: string) {
    const id = this.accountId();
    return this.mode() === 'followers'
      ? this.api.accountFollowers(id, maxId)
      : this.api.accountFollowing(id, maxId);
  }

  private loadFirst(): void {
    if (this.isLocalAnonymousList()) {
      const accounts =
        this.mode() === 'following'
          ? this.anonymousFollows.follows().map((follow) => follow.account)
          : [];
      this.accounts.set(accounts);
      this.rels.set(
        new Map(
          accounts.map((account) => [
            account.id,
            this.anonymousFollows.relationship(account, this.anonymous.server()),
          ]),
        ),
      );
      this.loading.set(false);
      this.exhausted.set(true);
      return;
    }
    this.fetch().subscribe({
      next: (page) => {
        this.loading.set(false);
        this.accounts.set(page);
        this.exhausted.set(!page.length);
        this.loadRelationships(page);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
      },
    });
  }

  loadMore(): void {
    const last = this.accounts().at(-1);
    if (!last || this.loadingMore() || this.exhausted()) {
      return;
    }
    this.loadingMore.set(true);
    this.fetch(last.id).subscribe({
      next: (page) => {
        this.loadingMore.set(false);
        if (!page.length) {
          this.exhausted.set(true);
          return;
        }
        const seen = new Set(this.accounts().map((a) => a.id));
        const fresh = page.filter((a) => !seen.has(a.id));
        if (!fresh.length) {
          this.exhausted.set(true);
          return;
        }
        this.accounts.update((list) => [...list, ...fresh]);
        this.loadRelationships(fresh);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  /** Fetch relationships for a batch (skips myself; I can't follow myself). */
  private loadRelationships(page: Account[]): void {
    const meId = this.me()?.id;
    const ids = page.map((a) => a.id).filter((id) => id !== meId);
    if (!ids.length) {
      return;
    }
    this.api.relationships(ids).subscribe((list) => {
      this.rels.update((map) => {
        const next = new Map(map);
        for (const r of list) {
          next.set(r.id, r);
        }
        return next;
      });
    });
  }

  /** True once we know the viewer follows (or has requested to follow) them. */
  isFollowing(a: Account): boolean {
    const r = this.rels().get(a.id);
    return !!r && (r.following || r.requested);
  }

  /** A locked account we've asked to follow but who hasn't accepted yet. */
  isRequested(a: Account): boolean {
    return !!this.rels().get(a.id)?.requested;
  }

  isBusy(a: Account): boolean {
    return this.pending().get(a.id) === 'busy';
  }

  isSelf(a: Account): boolean {
    return a.id === this.me()?.id;
  }

  /** The label for the toggle, given follow/request/hover state. */
  followLabel(a: Account): string {
    if (this.isRequested(a)) {
      return 'Requested';
    }
    return this.isFollowing(a) ? 'Following' : 'Follow';
  }

  toggleFollow(a: Account): void {
    if (this.isBusy(a) || this.isSelf(a)) {
      return;
    }
    this.setPending(a.id, 'busy');
    if (this.isLocalAnonymousList()) {
      if (this.anonymousFollows.isFollowing(a, this.anonymous.server())) {
        this.anonymousFollows.unfollow(a, this.anonymous.server());
        this.accounts.update((accounts) => accounts.filter((account) => account.id !== a.id));
        this.rels.update((rels) => {
          const next = new Map(rels);
          next.delete(a.id);
          return next;
        });
      } else {
        const result = this.anonymousFollows.follow(a, this.anonymous.server());
        if (result.ok) {
          this.rels.update((rels) => new Map(rels).set(a.id, result.relationship));
        }
      }
      this.clearPending(a.id);
      return;
    }
    const following = this.isFollowing(a);
    const call = following ? this.api.unfollow(a.id) : this.api.follow(a.id);
    call.subscribe({
      next: (rel) => {
        this.rels.update((map) => new Map(map).set(a.id, rel));
        this.clearPending(a.id);
      },
      error: () => this.clearPending(a.id),
    });
  }

  private setPending(id: string, state: FollowState): void {
    this.pending.update((map) => new Map(map).set(id, state));
  }

  private clearPending(id: string): void {
    this.pending.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
  }

  protected emptyLabel = computed(() =>
    this.mode() === 'followers' ? 'No followers yet.' : 'Not following anyone yet.',
  );

  private isLocalAnonymousList(): boolean {
    return this.auth.isAnonymous && this.accountId() === this.anonymous.account().id;
  }
}
