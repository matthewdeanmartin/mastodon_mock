import { computed, Injectable, signal } from '@angular/core';

const FEEDS_KEY = 'mockingbird_rss_feeds';

/** One subscribed feed. `title` is captured when the feed is first fetched. */
export interface RssFeedSub {
  url: string;
  title: string;
  enabled: boolean;
}

function loadFeeds(): RssFeedSub[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FEEDS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The user's RSS subscriptions, persisted in localStorage like every other
 * Mockingbird preference (client-side only; works against any instance).
 */
@Injectable({ providedIn: 'root' })
export class RssSubscriptions {
  readonly feeds = signal<RssFeedSub[]>(loadFeeds());

  readonly enabledFeeds = computed(() => this.feeds().filter((f) => f.enabled));

  has(url: string): boolean {
    return this.feeds().some((f) => f.url === url);
  }

  add(url: string, title: string): void {
    if (this.has(url)) {
      return;
    }
    this.persist([...this.feeds(), { url, title, enabled: true }]);
  }

  remove(url: string): void {
    this.persist(this.feeds().filter((f) => f.url !== url));
  }

  setEnabled(url: string, enabled: boolean): void {
    this.persist(this.feeds().map((f) => (f.url === url ? { ...f, enabled } : f)));
  }

  private persist(feeds: RssFeedSub[]): void {
    this.feeds.set(feeds);
    localStorage.setItem(FEEDS_KEY, JSON.stringify(feeds));
  }
}
