import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RssSubscriptions } from '../../providers/rss/rss-subscriptions';
import { PER_FEED_ITEM_CAP } from '../../providers/rss/rss-provider';
import { PageDiagnostics } from '../../page-diagnostics';
import { AddFeedDialog } from './add-feed-dialog/add-feed-dialog';

/** A URL's hostname, or null when it isn't a parseable absolute URL. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * `/rss` — the RSS *reading* surface, separate from `/settings/rss` (feed
 * management: add/remove, OPML, proxy, cache).
 *
 * Sprint 1 scope only: list subscriptions, add a feed. No read/unread,
 * starring, or headline/article toggle yet — those land in Sprint 2, and this
 * page's feed-row list is expected to grow those affordances in place rather
 * than being replaced. See sprint/rss-1-nav-and-page-skeleton.md.
 */
@Component({
  selector: 'app-rss-page',
  imports: [RouterLink, AddFeedDialog],
  templateUrl: './rss-page.html',
  styleUrl: './rss-page.css',
})
export class RssPage {
  private diagnostics = inject(PageDiagnostics);
  protected subs = inject(RssSubscriptions);
  protected readonly perFeedCap = PER_FEED_ITEM_CAP;

  protected showAddDialog = signal(false);

  openAddDialog(): void {
    this.diagnostics.info('RssPage', 'user:open-add-dialog', {});
    this.showAddDialog.set(true);
  }

  closeAddDialog(): void {
    this.showAddDialog.set(false);
  }

  rssHost(url: string): string | null {
    return hostOf(url);
  }
}
