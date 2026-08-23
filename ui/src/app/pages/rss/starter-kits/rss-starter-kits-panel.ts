import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RSS_STARTER_KITS, RssStarterKit } from '../../../providers/rss/rss-starter-kits';
import {
  KitInstallReport,
  RssStarterKitInstall,
} from '../../../providers/rss/rss-starter-kit-install';
import { RssSubscriptions } from '../../../providers/rss/rss-subscriptions';

/**
 * The one-click starter kits offered on `/rss`.
 *
 * Shown whenever there is room to add feeds — not only on a completely empty
 * list. Somebody who took the news kit and now wants the tech one should not
 * have to unsubscribe from everything to find the offer again, and a reader with
 * three feeds still has a cold-start problem.
 */
@Component({
  selector: 'app-rss-starter-kits-panel',
  imports: [RouterLink],
  templateUrl: './rss-starter-kits-panel.html',
  styleUrl: './rss-starter-kits-panel.css',
})
export class RssStarterKitsPanel {
  protected installer = inject(RssStarterKitInstall);
  protected subs = inject(RssSubscriptions);
  protected readonly kits = RSS_STARTER_KITS;

  /** Kits with at least one feed not yet subscribed. */
  protected readonly offered = computed(() =>
    this.kits.filter((kit) => !this.installer.installed(kit)),
  );

  /**
   * Whether a kit cannot fit under the current subscription ceiling.
   *
   * Checked per kit rather than globally so the message can name a number, and
   * so a small kit stays installable when a large one no longer fits.
   */
  protected doesNotFit(kit: RssStarterKit): boolean {
    return this.installer.remaining(kit) > this.subs.remaining();
  }

  protected anyDoesNotFit(): boolean {
    return this.offered().some((kit) => this.doesNotFit(kit));
  }

  /** The publisher names in a kit, for the "what am I getting" line. */
  protected kitFeedNames(kit: RssStarterKit): string {
    return kit.feeds.map((feed) => feed.title).join(', ');
  }

  /** The titles that failed to load, for the report line. */
  protected failedNames(report: KitInstallReport): string {
    return report.failed.map((failure) => failure.title).join(', ');
  }

  protected installing(kit: RssStarterKit): boolean {
    return this.installer.progress()?.kitSlug === kit.slug;
  }

  /** Any install in flight — disables every button, not just the busy one. */
  protected busy(): boolean {
    return this.installer.progress() !== null;
  }

  protected install(kit: RssStarterKit): void {
    void this.installer.install(kit);
  }

  /** Raise the ceiling just enough for every offered kit, plus a little room. */
  protected raiseLimit(): void {
    const needed =
      this.subs.feeds().length +
      this.offered().reduce((sum, kit) => sum + this.installer.remaining(kit), 0);
    this.subs.setLimit(needed);
  }

  /** The total a "raise the limit" click would set. */
  protected neededLimit(): number {
    return (
      this.subs.feeds().length +
      this.offered().reduce((sum, kit) => sum + this.installer.remaining(kit), 0)
    );
  }
}
