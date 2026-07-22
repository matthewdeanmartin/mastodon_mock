import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Account, Relationship, Status } from '../../models';
import { HumanCountPipe } from '../../human-count.pipe';
import { VerifiedBadge } from '../../verified-badge/verified-badge';
import { StatusCard } from '../../status-card/status-card';
import { AccountWithMatches } from './account-refine';

/**
 * One account in the search results, built for discovery rather than lookup: the
 * user is hunting for "economists" or "people who post about pycharm", not for a
 * specific known person, so the collapsed card is deliberately information-dense.
 * Bio, the three counts, badges, follow/mutual state, and (in topic mode) the
 * posts that made this account surface all render immediately — none of that
 * costs an API call, since the search already returned it.
 *
 * The card is presentational: it owns no API state. The parent (search page)
 * batch-fetches relationships and performs follow/unfollow, passing the current
 * `relationship` down and receiving `follow`/`unfollow` intents back up. "Expand"
 * is reserved for anything that would cost a *per-account* call, surfaced by the
 * parent through the `expanded`/`toggleExpand` channel.
 */
@Component({
  selector: 'app-account-result-card',
  imports: [RouterLink, HumanCountPipe, VerifiedBadge, StatusCard],
  templateUrl: './account-result-card.html',
  styleUrl: './account-result-card.css',
})
export class AccountResultCard {
  /** The account plus any posts that made it surface (empty in bio-only mode). */
  readonly item = input.required<AccountWithMatches>();
  /** The viewer's relationship to this account, once the parent has fetched it. */
  readonly relationship = input<Relationship | null>(null);
  /** Router link to the full profile (parent builds it for the anon/auth split). */
  readonly profileLink = input.required<(string | number)[]>();
  /** True once the parent has opened this card's expand section. */
  readonly expanded = input(false);
  /** Whether a follow/unfollow request is in flight for this card. */
  readonly followBusy = input(false);
  /** True for anonymous viewers, so the card can soften relationship labels. */
  readonly anonymous = input(false);
  /** Optional explanation for contexts such as notification-driven discovery. */
  readonly reason = input<string | null>(null);
  /** Internal route to the post that caused the account to surface, when available. */
  readonly reasonLink = input<(string | number)[] | null>(null);
  /** Show the account mute/block overflow menu. Search results leave this off. */
  readonly showModerationMenu = input(false);

  readonly follow = output<Account>();
  readonly unfollow = output<Account>();
  readonly toggleExpand = output<void>();
  readonly muteAccount = output<{ account: Account; seconds: number | null }>();
  readonly blockAccount = output<Account>();

  protected account = computed(() => this.item().account);
  protected matchingPosts = computed<Status[]>(() => this.item().matchingPosts);

  /** How many matching posts to show inline before "and N more". */
  private static readonly INLINE_POST_CAP = 3;

  protected inlinePosts = computed(() =>
    this.matchingPosts().slice(0, AccountResultCard.INLINE_POST_CAP),
  );
  protected extraPostCount = computed(() =>
    Math.max(0, this.matchingPosts().length - AccountResultCard.INLINE_POST_CAP),
  );

  protected following = computed(() => !!this.relationship()?.following);
  protected followedBy = computed(() => !!this.relationship()?.followed_by);
  protected mutual = computed(() => this.following() && this.followedBy());
  protected requested = computed(() => !!this.relationship()?.requested);

  protected readonly muteDurations: { label: string; seconds: number | null }[] = [
    { label: '1 hour', seconds: 3600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: 'forever', seconds: null },
  ];

  /** The label on the follow button, reflecting the current relationship. */
  protected followLabel = computed(() => {
    if (this.requested()) {
      return 'Requested';
    }
    if (this.mutual()) {
      return 'Mutuals';
    }
    if (this.following()) {
      return 'Following';
    }
    return this.account().locked ? 'Request' : 'Follow';
  });

  /** True when clicking the button unfollows (it currently shows a followed state). */
  protected isFollowingState = computed(() => this.following() || this.requested());

  onFollowClick(): void {
    if (this.followBusy()) {
      return;
    }
    if (this.isFollowingState()) {
      this.unfollow.emit(this.account());
    } else {
      this.follow.emit(this.account());
    }
  }
}
