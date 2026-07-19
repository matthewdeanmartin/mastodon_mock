import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { BlueskySession } from '../../../providers/bluesky/bluesky-session';
import { RssFetch } from '../../../providers/rss/rss-fetch';
import { RssFeedSub, RssSubscriptions } from '../../../providers/rss/rss-subscriptions';
import { AnonymousCapabilities } from '../../../providers/anonymous/anonymous-capabilities';

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
  protected capabilities = inject(AnonymousCapabilities);
  private rssFetch = inject(RssFetch);
  protected subs = inject(RssSubscriptions);
  protected bsky = inject(BlueskySession);

  protected feedUrl = signal('');
  protected adding = signal(false);
  protected error = signal<string | null>(null);

  // Bluesky link form.
  protected bskyHandle = signal('');
  protected bskyPassword = signal('');
  protected bskyLinking = signal(false);
  protected bskyError = signal<string | null>(null);

  linkBluesky(): void {
    const handle = this.bskyHandle().trim().replace(/^@/, '');
    const password = this.bskyPassword();
    if (!handle || !password || this.bskyLinking()) {
      return;
    }
    this.bskyLinking.set(true);
    this.bskyError.set(null);
    this.bsky.login(handle, password).subscribe({
      next: () => {
        this.bskyLinking.set(false);
        this.bskyHandle.set('');
        this.bskyPassword.set('');
      },
      error: (err: unknown) => {
        this.bskyLinking.set(false);
        this.bskyError.set(describeBskyError(err));
      },
    });
  }

  unlinkBluesky(): void {
    this.bsky.unlink();
  }

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

function describeBskyError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 401) {
      return 'Bluesky rejected that handle/app password combination.';
    }
    const message = (err.error as { message?: string } | null)?.message;
    if (message) {
      return message;
    }
    if (err.status === 0) {
      return "Couldn't reach bsky.social — network problem?";
    }
  }
  return 'Linking failed — check the handle and app password.';
}
