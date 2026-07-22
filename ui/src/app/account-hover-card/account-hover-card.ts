import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Account, Relationship } from '../models';
import { Api } from '../api';
import { Auth } from '../auth';
import { HumanCountPipe } from '../human-count.pipe';
import { VerifiedBadge } from '../verified-badge/verified-badge';
import { AnonymousAccount } from '../providers/anonymous/anonymous-account';
import { AnonymousFollows } from '../providers/anonymous/anonymous-follows';

/**
 * Small card shown when hovering an account's avatar or name: bio,
 * post/following/follower counts, and a relationship-aware follow action.
 * the wrapping element (`.hover-anchor`, see status-card.css) owns the
 * show-on-hover behavior. Account details come from the status; relationship
 * state is fetched lazily only when the viewer enters the card.
 */
@Component({
  selector: 'app-account-hover-card',
  imports: [VerifiedBadge, HumanCountPipe],
  template: `
    <div class="hover-card" (mouseenter)="loadRelationship()">
      <img
        class="hc-avatar"
        [src]="account().avatar_static || account().avatar"
        alt=""
        loading="lazy"
        decoding="async"
      />
      <div class="hc-name">
        {{ account().display_name || account().username }}
        <app-verified-badge [account]="account()" />
      </div>
      <div class="hc-acct muted">&#64;{{ account().acct }}</div>
      @if (account().note) {
        <div class="hc-note" [innerHTML]="account().note"></div>
      }
      @if (hasStats) {
        <div class="hc-stats muted">
          <span
            ><strong>{{ account().statuses_count | humanCount }}</strong> posts</span
          >
          <span
            ><strong>{{ account().following_count | humanCount }}</strong> following</span
          >
          <span
            ><strong>{{ account().followers_count | humanCount }}</strong> followers</span
          >
        </div>
      }
      @if (showFollowButton()) {
        <button
          type="button"
          class="btn btn-sm hc-follow"
          [class.following]="isFollowingState()"
          [disabled]="relationshipLoading() || followBusy()"
          (click)="toggleFollow($event)"
        >
          {{ relationshipLoading() || followBusy() ? '…' : followLabel() }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 40;
      visibility: hidden;
      opacity: 0;
      transition:
        opacity 0.12s ease,
        visibility 0.12s;
      pointer-events: auto;
    }
    .hover-card {
      width: 280px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--col-bg);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
      font-weight: 400;
      font-size: 14px;
      line-height: 1.4;
      text-align: left;
      white-space: normal;
    }
    .hc-avatar {
      width: 48px;
      height: 48px;
      border-radius: 9999px;
      object-fit: cover;
      background: var(--border);
    }
    .hc-name {
      margin-top: 6px;
      font-weight: 700;
      color: var(--text);
    }
    .hc-acct {
      font-size: 13px;
    }
    .hc-note {
      margin-top: 6px;
      color: var(--text);
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
    }
    .hc-stats {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      font-size: 13px;
    }
    .hc-stats strong {
      color: var(--text);
    }
    .hc-follow {
      width: auto;
      min-width: 92px;
      margin-top: 10px;
    }
  `,
})
export class AccountHoverCard {
  private api = inject(Api);
  private auth = inject(Auth);
  private anonymous = inject(AnonymousAccount);
  private anonymousFollows = inject(AnonymousFollows);
  private destroyRef = inject(DestroyRef);

  readonly account = input.required<Account>();
  protected relationship = signal<Relationship | null>(null);
  protected relationshipLoading = signal(false);
  protected followBusy = signal(false);
  private relationshipLoadedFor: string | null = null;

  protected showFollowButton = computed(
    () =>
      this.account().id !== this.auth.account()?.id &&
      !!this.account().id &&
      !this.account().id.includes(':'),
  );
  protected isFollowingState = computed(
    () => !!this.relationship()?.following || !!this.relationship()?.requested,
  );
  protected followLabel = computed(() => {
    const relationship = this.relationship();
    if (relationship?.requested) return 'Requested';
    if (relationship?.following) return 'Following';
    return this.account().locked ? 'Request' : 'Follow';
  });

  protected loadRelationship(): void {
    const account = this.account();
    if (!this.showFollowButton() || this.relationshipLoadedFor === account.id) return;
    this.relationshipLoadedFor = account.id;
    if (this.auth.isAnonymous) {
      this.relationship.set(this.anonymousFollows.relationship(account, this.anonymous.server()));
      return;
    }
    this.relationshipLoading.set(true);
    this.api
      .relationships([account.id])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (relationships) => this.relationship.set(relationships[0] ?? null),
        error: () => this.relationshipLoading.set(false),
        complete: () => this.relationshipLoading.set(false),
      });
  }

  protected toggleFollow(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.relationshipLoading() || this.followBusy()) return;
    const account = this.account();
    if (this.auth.isAnonymous) {
      const relationship = this.isFollowingState()
        ? this.anonymousFollows.unfollow(account, this.anonymous.server())
        : this.anonymousFollows.follow(account, this.anonymous.server()).relationship;
      this.relationship.set(relationship);
      return;
    }
    this.followBusy.set(true);
    const request = this.isFollowingState()
      ? this.api.unfollow(account.id)
      : this.api.follow(account.id);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (relationship) => this.relationship.set(relationship),
      error: () => this.followBusy.set(false),
      complete: () => this.followBusy.set(false),
    });
  }

  /**
   * Foreign accounts (e.g. Bluesky, id `bsky:did:…`) carry no counts — the
   * adapters zero-fill them — so showing "0 posts, 0 followers" would just be
   * wrong. Hide the stats row rather than lie.
   */
  protected get hasStats(): boolean {
    const id = this.account().id;
    return typeof id === 'string' && !id.includes(':');
  }
}
