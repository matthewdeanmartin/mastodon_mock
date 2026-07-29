import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RssFetch } from '../../../providers/rss/rss-fetch';
import { RssFeedSub, RssSubscriptions } from '../../../providers/rss/rss-subscriptions';

/**
 * Settings → RSS feeds.
 *
 * This used to be a section on Connections, which was never quite right: a
 * connection is *one account* somewhere else, and RSS is a list of many feeds
 * carrying no credential at all. It has its own list management, its own
 * failure mode (CORS), and its own cap — so it gets its own page.
 */
@Component({
  selector: 'app-settings-rss',
  imports: [FormsModule],
  templateUrl: './settings-rss.html',
  styleUrl: './settings-rss.css',
})
export class SettingsRss {
  private rssFetch = inject(RssFetch);
  protected subs = inject(RssSubscriptions);

  protected feedUrl = signal('');
  protected adding = signal(false);
  protected error = signal<string | null>(null);

  addFeed(): void {
    const url = this.feedUrl().trim();
    if (!url || this.adding()) {
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.error.set('Feed URLs start with http:// or https://.');
      return;
    }
    if (this.subs.has(url)) {
      this.error.set("You're already subscribed to that feed.");
      return;
    }
    this.adding.set(true);
    this.error.set(null);
    // Validate by actually fetching: proves reachability + CORS + parseability,
    // and captures the feed's title in one go.
    this.rssFetch.fetchFeed(url).subscribe({
      next: (feed) => {
        const limitError = this.subs.add(url, feed.title);
        if (limitError) {
          this.error.set(limitError);
          this.adding.set(false);
          return;
        }
        this.feedUrl.set('');
        this.adding.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.adding.set(false);
      },
    });
  }

  remove(feed: RssFeedSub): void {
    this.subs.remove(feed.url);
  }

  toggle(feed: RssFeedSub): void {
    this.subs.setEnabled(feed.url, !feed.enabled);
  }
}
