import { DatePipe } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { FocusTrap } from '../a11y/focus-trap';
import { Auth } from '../auth';
import { ProfileAccountKey } from '../providers/account/profile-account-key';
import { SupporterStatus } from '../providers/account/supporter-status';
import { FoundFeed } from '../providers/rss/friend-feed-cache';
import { DEFAULT_PROBE_CAP, FriendFeedScan, PROBE_CAPS } from '../providers/rss/friend-feed-scan';
import { opmlFilename } from '../providers/rss/opml';
import { RssSubscriptions } from '../providers/rss/rss-subscriptions';

/**
 * "Find my friends' blogs": consent, progress, then the feeds.
 *
 * ## The three states are one thought
 *
 * Same shape as {@link EffectiveAudienceDialog}, and for the same reason: the
 * user is deciding whether the cost is worth it, watching it be spent, and then
 * reading what it bought. Splitting those across components would put the
 * estimate that justified the scan off-screen by the time it is running.
 *
 * ## Why the cost is quoted in sites, not accounts
 *
 * One profile carries up to four links, so "500 accounts" and "500 fetches" are
 * different numbers and only the second one is what gets spent. The control
 * therefore says *sites*, which is both the honest unit and the one the scanner
 * actually caps on.
 *
 * ## Silence about what was not found
 *
 * Friends with no links, and links with no feed, are never listed. On a large
 * following list that would be hundreds of rows saying nothing — and the point
 * of the dialog is the handful of blogs that *were* found. A single "checked N
 * sites" line explains the absence without enumerating it.
 */
// i18n friendFeeds.title: Find your friends’ blogs
// i18n friendFeeds.lead: People put their websites in their profile. This checks those links for a feed and collects whatever it finds into one file.
// i18n friendFeeds.plusTitle: Part of Mawkingbird Plus
// i18n friendFeeds.plusWhy: Checking hundreds of websites is the most expensive thing this app can do, so it is kept for supporters.
// i18n friendFeeds.plusSeePlans: See what Plus includes
// i18n friendFeeds.budgetLabel: Check up to
// i18n friendFeeds.budgetSites: {{count}} sites
// i18n friendFeeds.cost: Each site is one request, so this is up to <strong>{{count}}</strong> of them. Sites checked in an earlier run are free, and you can stop at any point.
// i18n friendFeeds.noProxy: Checking websites needs a CORS proxy. Set one up under Settings → Connections.
// i18n friendFeeds.start: Start checking
// i18n friendFeeds.cancel: Cancel
// i18n friendFeeds.close: Close
// i18n friendFeeds.stop: Stop and keep what was found
// i18n friendFeeds.walking: Reading the list of people you follow…
// i18n friendFeeds.walkingCount: {{count}} accounts read
// i18n friendFeeds.probing: Checking {{done}} of {{total}} sites · {{found}} feeds found
// i18n friendFeeds.reusedOne: {{count}} site was already checked in an earlier run
// i18n friendFeeds.reusedOther: {{count}} sites were already checked in earlier runs
// i18n friendFeeds.failed: The scan could not finish.
// i18n friendFeeds.resultNone: No feeds found. None of the websites your friends link to publish one that could be followed.
// i18n friendFeeds.resultCount.one: <strong>{{count}}</strong> feed found
// i18n friendFeeds.resultCount.other: <strong>{{count}}</strong> feeds found
// i18n friendFeeds.checked: checked {{count}} sites
// i18n friendFeeds.partial: Stopped before the end, so there may be more to find. Run it again to carry on — sites already checked will not be checked twice.
// i18n friendFeeds.generatedAt: Generated {{when}}
// i18n friendFeeds.via: from {{handle}}
// i18n friendFeeds.follow: Follow
// i18n friendFeeds.following: Following
// i18n friendFeeds.followAll: Follow all
// i18n friendFeeds.download: Download OPML
// i18n friendFeeds.rescan: Check again
// i18n friendFeeds.capReached: Added {{added}}. The other {{left}} would go over your {{limit}}-feed limit — raise it on the RSS feeds settings page.
// i18n friendFeeds.signedOut: Sign in to check the people you follow.
@Component({
  selector: 'app-friend-feeds-dialog',
  imports: [DatePipe, FocusTrap, RouterLink, TranslocoPipe],
  templateUrl: './friend-feeds-dialog.html',
  styleUrl: './friend-feeds-dialog.css',
})
export class FriendFeedsDialog {
  private scan = inject(FriendFeedScan);
  private subs = inject(RssSubscriptions);
  private accountKey = inject(ProfileAccountKey);
  private auth = inject(Auth);
  protected supporter = inject(SupporterStatus);

  readonly closed = output<void>();

  protected readonly caps = PROBE_CAPS;
  protected readonly cap = signal<number>(DEFAULT_PROBE_CAP);

  protected readonly progress = this.scan.progress;
  protected readonly result = this.scan.result;
  protected readonly running = this.scan.running;
  protected readonly percent = this.scan.percent;

  /** Feed URLs subscribed to during this dialog, so rows can say "Following". */
  protected readonly justAdded = signal(new Set<string>());

  /**
   * Set when "Follow all" ran out of room under the subscription limit.
   *
   * Structured rather than a finished string so the template translates it:
   * a message assembled here would be English for everybody.
   */
  protected readonly capOverflow = signal<{
    added: number;
    left: number;
    limit: number;
  } | null>(null);

  /** A refusal from a single `add`, already worded by RssSubscriptions. */
  protected readonly addError = signal<string | null>(null);

  /** True before anything has been asked for — the consent screen. */
  protected readonly asking = computed(() => !this.progress() && !this.result());

  protected readonly failed = computed(() => this.progress()?.phase === 'failed');

  /** Whether a scan can run at all: it needs a proxy and an account to read. */
  protected readonly available = computed(() => this.scan.available());

  /**
   * The scan needs an account id to walk the following list of, and a key to
   * file the result under. `auth.account()` settles asynchronously after a cold
   * load, so this is a signal rather than a constructor read.
   */
  protected readonly me = computed(() => this.auth.account());
  protected readonly signedIn = computed(() => this.me() !== null);

  constructor() {
    // Reopening the dialog after a scan should show what was found rather than
    // asking again — the result is the expensive part and it is already paid
    // for. Loading is cheap and idempotent.
    void this.restore();
  }

  private async restore(): Promise<void> {
    const key = this.accountKey.current();
    if (key && !this.result()) {
      await this.scan.loadStored(key);
    }
  }

  protected setCap(value: string): void {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      this.cap.set(parsed);
    }
  }

  protected async start(): Promise<void> {
    const key = this.accountKey.current();
    const me = this.me();
    if (!key || !me) {
      return;
    }
    this.capOverflow.set(null);
    this.addError.set(null);
    await this.scan.scan(me.id, key, this.cap());
  }

  protected stop(): void {
    this.scan.stop();
  }

  /** Throw away the stored answer and ask again from scratch. */
  protected async rescan(): Promise<void> {
    const key = this.accountKey.current();
    if (!key) {
      return;
    }
    await this.scan.forget(key);
  }

  protected isFollowing(feed: FoundFeed): boolean {
    return this.justAdded().has(feed.url) || this.subs.has(feed.url);
  }

  protected follow(feed: FoundFeed): void {
    const error = this.subs.add(feed.url, feed.title, feed.useProxy ?? false);
    if (error) {
      this.addError.set(error);
      return;
    }
    this.justAdded.update((set) => new Set(set).add(feed.url));
  }

  /**
   * Subscribe to everything found, up to the subscription limit.
   *
   * Fills to the ceiling and then says plainly how many were left and why,
   * rather than stopping at the first refusal or silently dropping the tail.
   * Someone who asked for all of them should get as many as they can have.
   */
  protected followAll(): void {
    const feeds = this.result()?.feeds ?? [];
    const added = new Set(this.justAdded());
    let count = 0;
    let blocked = 0;

    for (const feed of feeds) {
      if (this.isFollowing(feed)) {
        continue;
      }
      if (this.subs.remaining() <= 0) {
        blocked++;
        continue;
      }
      if (this.subs.add(feed.url, feed.title, feed.useProxy ?? false)) {
        blocked++;
        continue;
      }
      added.add(feed.url);
      count++;
    }

    this.justAdded.set(added);
    this.capOverflow.set(
      blocked > 0 ? { added: count, left: blocked, limit: this.subs.limit() } : null,
    );
  }

  /** Hand the OPML to the browser as a file. */
  protected download(): void {
    const opml = this.result()?.opml;
    if (!opml) {
      return;
    }
    const blob = new Blob([opml], { type: 'text/x-opml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = opmlFilename();
    anchor.click();
    URL.revokeObjectURL(url);
  }

  protected close(): void {
    this.closed.emit();
  }
}
