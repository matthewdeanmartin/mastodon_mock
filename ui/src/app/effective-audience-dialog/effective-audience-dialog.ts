import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FocusTrap } from '../a11y/focus-trap';
import { AudienceScan, AudienceSide } from '../audience-scan';
import {
  DORMANT_AFTER_DAYS,
  LOW_CADENCE_POSTS_PER_DAY,
  AudienceEstimate,
} from '../effective-audience';
import { AnonymousPublicRef } from '../providers/anonymous/anonymous-route-ref';
import { Account } from '../models';
import { Terminology } from '../terminology';

/** Accounts per request, mirrored from the scanner for the cost estimate. */
const PAGE_SIZE = 80;

/**
 * "This will cost about 63 requests — still want it?", then the progress, then
 * the answer.
 *
 * Three states in one dialog because they are one thought: the user is deciding
 * whether the number is worth the wait, watching it be earned, and then reading
 * it. Splitting them across components would mean the estimate that justified
 * the scan is off-screen by the time the scan is running.
 *
 * Nothing here writes, so unlike {@link BulkActionsDialog} there is no
 * confirmation to get right and no backup to offer — the only real
 * responsibility is being honest about cost beforehand and about coverage
 * afterwards.
 */
@Component({
  selector: 'app-effective-audience-dialog',
  imports: [FocusTrap],
  templateUrl: './effective-audience-dialog.html',
  styleUrl: './effective-audience-dialog.css',
})
export class EffectiveAudienceDialog {
  protected words = inject(Terminology).words;
  private readonly scan = inject(AudienceScan);

  readonly account = input.required<Account>();
  readonly publicRef = input<AnonymousPublicRef | null>(null);
  readonly closed = output<void>();

  /** Which sides to measure. Both by default — they answer different questions. */
  protected readonly wantFollowers = signal(true);
  protected readonly wantFollowing = signal(true);

  protected readonly state = this.scan.state;
  protected readonly percent = this.scan.percent;
  protected readonly apiCalls = this.scan.apiCalls;
  protected readonly running = this.scan.running;

  /** True before the user has committed — the consent screen. */
  protected readonly asking = computed(() => !this.state());

  protected readonly followersTotal = computed(() => this.account().followers_count ?? 0);
  protected readonly followingTotal = computed(() => this.account().following_count ?? 0);

  /** Requests one side will take, rounded up — the honest headline cost. */
  private pagesFor(total: number): number {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }

  /** Estimated total requests for the current selection. */
  protected readonly estimatedCalls = computed(() => {
    let calls = 0;
    if (this.wantFollowers()) {
      calls += this.pagesFor(this.followersTotal());
    }
    if (this.wantFollowing()) {
      calls += this.pagesFor(this.followingTotal());
    }
    return calls;
  });

  /** Per-side request estimate, for the checkbox labels. */
  protected callsFor(total: number): number {
    return total > 0 ? this.pagesFor(total) : 0;
  }

  /** "45s" / "3 min" — the cost in the unit people actually think in. */
  protected readonly estimatedTime = computed(() => {
    const seconds = this.estimatedSeconds();
    return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`;
  });

  /** Whole-percent scan progress for one side, for the bar and its ARIA value. */
  protected pctOf(scanned: number, total: number): number {
    return total > 0 ? Math.min(100, Math.round((scanned / total) * 100)) : 0;
  }

  /** Coverage as a whole percent, for the sampling caveat. */
  protected coveragePct(result: AudienceEstimate): number {
    return Math.round(result.coverage * 100);
  }

  /**
   * A rough wall-clock estimate for the consent screen.
   *
   * Deliberately vague and deliberately pessimistic — requests are not free and
   * a rate limit can stretch this a long way. Better to over-quote and finish
   * early than to promise 20 seconds and take four minutes.
   */
  protected readonly estimatedSeconds = computed(() => Math.ceil(this.estimatedCalls() * 0.6));

  protected readonly canStart = computed(
    () => (this.wantFollowers() || this.wantFollowing()) && this.estimatedCalls() > 0,
  );

  /** Copy for the thresholds, so the dialog and the module can't drift apart. */
  protected readonly dormantDays = DORMANT_AFTER_DAYS;
  protected readonly lowCadenceRate = LOW_CADENCE_POSTS_PER_DAY;

  protected readonly followersResult = computed(() => this.state()?.results.followers ?? null);
  protected readonly followingResult = computed(() => this.state()?.results.following ?? null);

  /**
   * Finished sides paired with their labels, in display order.
   *
   * Built here rather than looping a literal array in the template: an inline
   * `['following', 'followers']` is a new array identity on every change
   * detection pass, which defeats `@for` tracking and re-creates both result
   * blocks each tick.
   */
  protected readonly resultRows = computed(() => {
    const rows: { side: AudienceSide; label: string; result: AudienceEstimate }[] = [];
    const following = this.followingResult();
    if (following) {
      rows.push({ side: 'following', label: 'Friends', result: following });
    }
    const followers = this.followersResult();
    if (followers) {
      rows.push({ side: 'followers', label: 'Followers', result: followers });
    }
    return rows;
  });

  /** True once at least one side has produced numbers worth showing. */
  protected readonly hasResults = computed(
    () => !!this.followersResult() || !!this.followingResult(),
  );

  protected readonly stopped = computed(() => this.state()?.phase === 'cancelled');
  protected readonly failed = computed(() => this.state()?.phase === 'failed');

  protected toggleFollowers(): void {
    this.wantFollowers.update((on) => !on);
  }

  protected toggleFollowing(): void {
    this.wantFollowing.update((on) => !on);
  }

  protected start(): void {
    const sides: AudienceSide[] = [];
    // Following first: it is almost always the smaller list, so the cheaper
    // half of a two-sided scan produces numbers while the expensive one runs.
    if (this.wantFollowing()) {
      sides.push('following');
    }
    if (this.wantFollowers()) {
      sides.push('followers');
    }
    if (!sides.length) {
      return;
    }
    void this.scan.start({
      accountId: this.account().id,
      followersTotal: this.followersTotal(),
      followingTotal: this.followingTotal(),
      sides,
      publicRef: this.publicRef(),
    });
  }

  protected stop(): void {
    this.scan.cancel();
  }

  /**
   * Close the dialog.
   *
   * The scan is left running if it is still going: it lives in a root service
   * precisely so closing this window doesn't throw away four minutes of paging,
   * and reopening picks the same state back up.
   */
  protected close(): void {
    this.closed.emit();
  }

  /** Start over — clears the finished scan so the consent screen returns. */
  protected again(): void {
    this.scan.dismiss();
  }

  /**
   * How much of the audience the numbers rest on.
   *
   * A partial scan says "1,240 of 5,000 (25%)". A complete one just says
   * "2,914 scanned": once everything has been read, "2,914 of 2,914 (100%)" is
   * three ways of saying one number, and when the server's counter disagrees
   * slightly it actively misleads by implying an exact match we never checked.
   */
  protected coverageLabel(result: AudienceEstimate): string {
    if (result.complete) {
      return `${result.scanned.toLocaleString()} scanned`;
    }
    const pct = Math.round(result.coverage * 100);
    return `${result.scanned.toLocaleString()} of ${result.total.toLocaleString()} (${pct}%)`;
  }

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
