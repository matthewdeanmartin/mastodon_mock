import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClientPrefs, RSS_CACHE_TTL_OPTIONS } from '../../../client-prefs';
import { CorsProxySettings } from '../../../providers/cors-proxy/cors-proxy-settings';
import { RssCache } from '../../../providers/rss/rss-cache';
import { RssFetch } from '../../../providers/rss/rss-fetch';
import { RssFeedSub, RssSubscriptions } from '../../../providers/rss/rss-subscriptions';

/**
 * Settings → RSS feeds.
 *
 * This used to be a section on Connections, which was never quite right: a
 * connection is *one account* somewhere else, and RSS is a list of many feeds
 * carrying no credential at all. It has its own list management, its own
 * failure mode (CORS), and its own cap — so it gets its own page.
 *
 * The CORS proxy appears here only as a summary and a per-feed switch. Choosing
 * and authenticating a proxy is a browser-wide decision and lives on
 * Connections; what belongs on this page is the one question that is actually
 * about feeds — "should *this* feed go through it?".
 */
@Component({
  selector: 'app-settings-rss',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-rss.html',
  styleUrl: './settings-rss.css',
})
export class SettingsRss implements OnInit {
  private rssFetch = inject(RssFetch);
  protected subs = inject(RssSubscriptions);
  protected proxySettings = inject(CorsProxySettings);
  protected prefs = inject(ClientPrefs);
  private cache = inject(RssCache);

  protected readonly ttlOptions = RSS_CACHE_TTL_OPTIONS;
  /** URL of the feed currently being force-refreshed, if any. */
  protected refreshing = signal<string | null>(null);
  /** How much is cached, or null before the count comes back. */
  protected cacheSummary = signal<string | null>(null);

  protected feedUrl = signal('');
  protected adding = signal(false);
  protected error = signal<string | null>(null);
  /**
   * The URL of a feed that just failed to add, when a proxy is configured and
   * might succeed where the direct fetch didn't.
   *
   * This is what keeps "no automatic fallback" from becoming a dead end: the
   * app never retries on its own, but once it knows a direct fetch failed it
   * can offer the one-click retry instead of leaving the user to guess.
   */
  protected retryable = signal<string | null>(null);

  /** The configured proxy's name, or null when there is none. */
  protected readonly proxyLabel = computed(() =>
    this.proxySettings.usable() ? (this.proxySettings.chosen()?.label ?? null) : null,
  );

  /**
   * True when a proxy is selected but not usable — a key-requiring proxy with
   * no key, or a custom one with a broken template. Worth saying out loud,
   * because the per-feed switches below are inert until it is fixed.
   */
  protected readonly proxyIncomplete = computed(
    () => this.proxySettings.currentId() !== null && !this.proxySettings.usable(),
  );

  ngOnInit(): void {
    // Not in the constructor: the lookup is asynchronous, and resolving it
    // after a spec's TestBed has been torn down triggers "cannot configure the
    // test module" in whatever test runs next.
    void this.loadCacheSummary();
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
    this.attemptAdd(url, false);
  }

  /** Retry the feed that just failed, this time through the proxy. */
  retryViaProxy(): void {
    const url = this.retryable();
    if (url) {
      this.attemptAdd(url, true);
    }
  }

  /**
   * Fetch a candidate feed and subscribe if it parses.
   *
   * Validating by actually fetching proves reachability, CORS and
   * parseability, and captures the title — and when `useProxy` is set it also
   * proves the proxy works for this feed before the subscription records that
   * it should be used.
   */
  private attemptAdd(url: string, useProxy: boolean): void {
    this.adding.set(true);
    this.error.set(null);
    this.retryable.set(null);

    this.rssFetch.fetchFeed(url, { useProxy }).subscribe({
      next: (feed) => {
        const limitError = this.subs.add(url, feed.title, useProxy, feed.items.length);
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
        // Only offer the retry when it could plausibly help: a direct attempt
        // that failed, with a working proxy standing by.
        if (!useProxy && this.proxySettings.usable()) {
          this.retryable.set(url);
        }
        this.adding.set(false);
      },
    });
  }

  remove(feed: RssFeedSub): void {
    this.subs.remove(feed.url);
    // Reclaim the cached copy too: an unsubscribed feed's megabytes have no
    // reason to keep sitting in IndexedDB.
    void this.cache.evict(feed.url).then(() => this.loadCacheSummary());
  }

  toggle(feed: RssFeedSub): void {
    this.subs.setEnabled(feed.url, !feed.enabled);
  }

  toggleProxy(feed: RssFeedSub): void {
    this.subs.setUseProxy(feed.url, feed.useProxy !== true);
  }

  /** The select hands back a string; the preference is a number of hours. */
  setTtl(hours: string | number): void {
    this.prefs.setRssCacheTtlHours(Number(hours));
  }

  /** Re-read one feed now, ignoring both the cache and any failure cooldown. */
  refresh(feed: RssFeedSub): void {
    if (this.refreshing()) {
      return;
    }
    this.refreshing.set(feed.url);
    this.error.set(null);
    this.rssFetch
      .fetchFeed(feed.url, { useProxy: feed.useProxy === true, forceRefresh: true })
      .subscribe({
        next: (parsed) => {
          this.subs.recordFetch(feed.url, parsed.title, parsed.items.length);
          this.refreshing.set(null);
          void this.loadCacheSummary();
        },
        error: (err: Error) => {
          this.error.set(err.message);
          this.refreshing.set(null);
        },
      });
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
    await this.loadCacheSummary();
  }

  /**
   * Count what's cached, for the line above the feed list.
   *
   * Deliberately a count and not a byte total: `entries()` would have to
   * deserialize every cached feed to measure it, which is exactly the work the
   * cache exists to avoid. The Observability page reports real IndexedDB usage.
   */
  private async loadCacheSummary(): Promise<void> {
    const entries = await this.cache.entries();
    const cached = entries.filter((entry) => entry.fetchedAt > 0).length;
    this.cacheSummary.set(
      cached
        ? `${cached} feed${cached === 1 ? '' : 's'} cached in this browser.`
        : 'Nothing cached yet.',
    );
  }
}
