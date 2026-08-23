import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RSS_STARTER_KITS, RssStarterKit } from '../../../providers/rss/rss-starter-kits';
import {
  KitInstallReport,
  RssStarterKitInstall,
} from '../../../providers/rss/rss-starter-kit-install';
import { RssSubscriptions } from '../../../providers/rss/rss-subscriptions';
import { RssDiscovery, DiscoveredFeed } from '../../../providers/rss/rss-discovery';
import { RssAddFeed } from '../../../providers/rss/rss-add-feed';
import { Api } from '../../../api';
import { outboundLinks } from '../../../providers/article/article-target';
import { PageDiagnostics } from '../../../page-diagnostics';
import { firstValueFrom } from 'rxjs';
import { Status } from '../../../models';

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
  protected discovery = inject(RssDiscovery);
  private api = inject(Api);
  private addFeed = inject(RssAddFeed);
  private diagnostics = inject(PageDiagnostics);

  /** Feeds being subscribed from the discovery list, by URL. */
  protected readonly adding = signal<string | null>(null);
  /** Discovery ran and found nothing — distinct from "has not run". */
  protected readonly searched = signal(false);
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

  /**
   * Look for feeds on sites that people you follow have linked to.
   *
   * Reads one page of the home timeline and reduces it to outbound links — the
   * same `outboundLinks` the article pipeline uses, so social navigation and
   * non-http URLs are already filtered out. Nothing is fetched until the user
   * presses the button, and nothing is subscribed without a second click.
   */
  protected async findFriendFeeds(): Promise<void> {
    if (this.discovery.running()) {
      return;
    }
    this.searched.set(true);
    try {
      const statuses: Status[] = (await firstValueFrom(this.api.homeTimeline())) ?? [];
      const links = statuses.flatMap((status) => {
        const source = status.reblog ?? status;
        return outboundLinks(source.content ?? '').map((url) => ({
          url,
          via: source.account.acct,
        }));
      });
      this.diagnostics.info('RSS', 'discovery:start', { links: links.length });
      await this.discovery.discover(links);
    } catch (err) {
      this.diagnostics.warn('RSS', 'discovery:timeline-failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Subscribe to one discovered feed, validating it like any manual add. */
  protected async addDiscovered(feed: DiscoveredFeed): Promise<void> {
    if (this.adding()) {
      return;
    }
    this.adding.set(feed.url);
    try {
      // Through RssAddFeed, not a bare subscription write: a `<link
      // rel=alternate>` is a claim, and this is where it gets checked.
      await firstValueFrom(this.addFeed.add(feed.url, false));
      this.discovery.found.update((all) => all.filter((f) => f.url !== feed.url));
    } catch {
      try {
        await firstValueFrom(this.addFeed.add(feed.url, true));
        this.discovery.found.update((all) => all.filter((f) => f.url !== feed.url));
      } catch (err) {
        this.diagnostics.warn('RSS', 'discovery:add-failed', {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      this.adding.set(null);
    }
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
