import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RssFetch } from '../../../providers/rss/rss-fetch';
import { RssFeedSub, RssSubscriptions } from '../../../providers/rss/rss-subscriptions';

/**
 * Connections: the other places your people post. Mastodon is home; everything
 * here is merged into the home timeline as a guest. Client-side only — feeds
 * are fetched straight from the browser and the list lives in localStorage.
 */
@Component({
  selector: 'app-settings-connections',
  imports: [FormsModule],
  templateUrl: './settings-connections.html',
  styleUrl: './settings-connections.css',
})
export class SettingsConnections {
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
        this.subs.add(url, feed.title);
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
