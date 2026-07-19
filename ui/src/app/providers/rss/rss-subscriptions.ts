import { computed, Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';

const FEEDS_KEY_BASE = 'mockingbird_rss_feeds';
export const RSS_SUBSCRIPTION_LIMIT = 10;

/** One subscribed feed. `title` is captured when the feed is first fetched. */
export interface RssFeedSub {
  url: string;
  title: string;
  enabled: boolean;
}

function loadFeeds(key: string): RssFeedSub[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.slice(0, RSS_SUBSCRIPTION_LIMIT) : [];
  } catch {
    return [];
  }
}

/**
 * The user's RSS subscriptions, persisted in localStorage like every other
 * Mockingbird preference (client-side only; works against any instance).
 *
 * The storage key is scoped to the active account (see {@link scopedKey}) so one
 * account's feeds don't bleed into another's. The key is resolved once at
 * construction; switching accounts hard-reloads the app, which reconstructs this
 * service against the new account's key.
 */
@Injectable({ providedIn: 'root' })
export class RssSubscriptions {
  private readonly storageKey = scopedKey(FEEDS_KEY_BASE);
  readonly feeds = signal<RssFeedSub[]>(loadFeeds(this.storageKey));

  readonly enabledFeeds = computed(() => this.feeds().filter((f) => f.enabled));

  has(url: string): boolean {
    return this.feeds().some((f) => f.url === url);
  }

  add(url: string, title: string): string | null {
    if (this.has(url)) {
      return null;
    }
    if (this.feeds().length >= RSS_SUBSCRIPTION_LIMIT) {
      return `You can subscribe to up to ${RSS_SUBSCRIPTION_LIMIT} RSS feeds.`;
    }
    this.persist([...this.feeds(), { url, title, enabled: true }]);
    return null;
  }

  remove(url: string): void {
    this.persist(this.feeds().filter((f) => f.url !== url));
  }

  setEnabled(url: string, enabled: boolean): void {
    this.persist(this.feeds().map((f) => (f.url === url ? { ...f, enabled } : f)));
  }

  private persist(feeds: RssFeedSub[]): void {
    this.feeds.set(feeds);
    localStorage.setItem(this.storageKey, JSON.stringify(feeds));
  }
}
