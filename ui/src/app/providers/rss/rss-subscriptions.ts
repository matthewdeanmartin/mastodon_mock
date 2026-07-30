import { computed, Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';

const FEEDS_KEY_BASE = 'mockingbird_rss_feeds';
export const RSS_SUBSCRIPTION_LIMIT = 10;

/** One subscribed feed. `title` is captured when the feed is first fetched. */
export interface RssFeedSub {
  url: string;
  title: string;
  enabled: boolean;
  /**
   * Fetch this feed through the configured CORS proxy instead of directly.
   *
   * Opt-in per feed and absent by default, which is what makes the upgrade
   * safe: a subscription stored before this field existed reads as `undefined`
   * and keeps fetching directly. Turning it on is always a deliberate act on
   * one feed the user has watched fail — the app never enables it on their
   * behalf, because doing so would silently route a request through a third
   * party they did not choose.
   */
  useProxy?: boolean;
  /**
   * How many items the feed held when it was last read.
   *
   * Recorded opportunistically — whenever a fetch happens for some
   * other reason — rather than fetched on demand. The Feeds page wants to show
   * "· 12 items" next to every subscription, and fetching ten feeds to render
   * one hub page would be a lot of network for a decoration. Absent until the
   * feed has been read once, and the UI simply omits the count until then.
   */
  itemCount?: number;
}

/** A URL's hostname, or null when it isn't a parseable absolute URL. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
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

  /**
   * Subscribe to a feed.
   *
   * `useProxy` is recorded only when the caller has just *proved* the proxy
   * fetches this feed, so a subscription never claims a route that has not
   * worked at least once.
   */
  add(url: string, title: string, useProxy = false, itemCount?: number): string | null {
    if (this.has(url)) {
      return null;
    }
    if (this.feeds().length >= RSS_SUBSCRIPTION_LIMIT) {
      return `You can subscribe to up to ${RSS_SUBSCRIPTION_LIMIT} RSS feeds.`;
    }
    this.persist([
      ...this.feeds(),
      {
        url,
        title,
        enabled: true,
        ...(useProxy ? { useProxy } : {}),
        ...(typeof itemCount === 'number' ? { itemCount } : {}),
      },
    ]);
    return null;
  }

  remove(url: string): void {
    this.persist(this.feeds().filter((f) => f.url !== url));
  }

  setEnabled(url: string, enabled: boolean): void {
    this.persist(this.feeds().map((f) => (f.url === url ? { ...f, enabled } : f)));
  }

  /**
   * Record what a fetch just learned about a feed: its current title and how
   * many items it holds.
   *
   * Called from the read paths rather than by the Feeds page, so the hub gets
   * counts for free from browsing you were doing anyway. A feed the user has
   * never opened simply has no count, and the row omits it.
   *
   * Writes only when something actually changed — this runs on every feed load,
   * and re-serializing the whole subscription list each time would be a
   * pointless localStorage write on every timeline refresh.
   */
  recordFetch(url: string, title: string, itemCount: number): void {
    const feeds = this.feeds();
    const existing = feeds.find((f) => f.url === url);
    if (!existing) {
      return;
    }
    const nextTitle = title.trim() || existing.title;
    if (existing.itemCount === itemCount && existing.title === nextTitle) {
      return;
    }
    this.persist(feeds.map((f) => (f.url === url ? { ...f, title: nextTitle, itemCount } : f)));
  }

  /** Route this feed through the configured CORS proxy, or stop doing so. */
  setUseProxy(url: string, useProxy: boolean): void {
    this.persist(this.feeds().map((f) => (f.url === url ? { ...f, useProxy } : f)));
  }

  /** How many feeds currently go through a proxy — for the settings summary. */
  proxiedCount(): number {
    return this.feeds().filter((f) => f.useProxy).length;
  }

  /**
   * Whether a URL should be fetched through the proxy, by subscription.
   *
   * Several read paths (a feed-as-profile page, a single item, a comment feed)
   * receive only a URL, with no subscription in hand. Resolving the flag from
   * the URL keeps one feed's setting consistent however it is reached, instead
   * of the timeline honouring it and a click-through silently not.
   *
   * A comment feed usually lives on the same host as the feed that linked it,
   * so it inherits that feed's setting via `hostFallback` — the alternative is
   * comments that fail on exactly the feeds the user fixed.
   */
  usesProxy(url: string, hostFallback = true): boolean {
    const exact = this.feeds().find((f) => f.url === url);
    if (exact) {
      return exact.useProxy === true;
    }
    if (!hostFallback) {
      return false;
    }
    const host = hostOf(url);
    return host !== null && this.feeds().some((f) => f.useProxy && hostOf(f.url) === host);
  }

  private persist(feeds: RssFeedSub[]): void {
    this.feeds.set(feeds);
    localStorage.setItem(this.storageKey, JSON.stringify(feeds));
  }
}
