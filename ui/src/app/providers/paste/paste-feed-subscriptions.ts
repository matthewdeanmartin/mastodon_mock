import { computed, Injectable, signal } from '@angular/core';

const PASTE_FEEDS_KEY = 'mockingbird_paste_feeds';

export interface PasteFeedSubscription {
  providerId: string;
  url: string;
  label: string;
  enabled: boolean;
}

function load(): PasteFeedSubscription[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PASTE_FEEDS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as PasteFeedSubscription[]) : [];
  } catch {
    return [];
  }
}

/** Opt-in public paste feeds. Kept provider-aware for future service replacement. */
@Injectable({ providedIn: 'root' })
export class PasteFeedSubscriptions {
  readonly feeds = signal<PasteFeedSubscription[]>(load());
  readonly enabledFeeds = computed(() => this.feeds().filter((feed) => feed.enabled));

  has(providerId: string): boolean {
    return this.feeds().some((feed) => feed.providerId === providerId && feed.enabled);
  }

  follow(providerId: string, url: string, label: string): void {
    const existing = this.feeds().find((feed) => feed.providerId === providerId);
    const next = existing
      ? this.feeds().map((feed) =>
          feed.providerId === providerId ? { ...feed, url, label, enabled: true } : feed,
        )
      : [...this.feeds(), { providerId, url, label, enabled: true }];
    this.persist(next);
  }

  unfollow(providerId: string): void {
    this.persist(
      this.feeds().map((feed) =>
        feed.providerId === providerId ? { ...feed, enabled: false } : feed,
      ),
    );
  }

  private persist(feeds: PasteFeedSubscription[]): void {
    this.feeds.set(feeds);
    try {
      localStorage.setItem(PASTE_FEEDS_KEY, JSON.stringify(feeds));
    } catch {
      // Storage-disabled browsers keep the choice for this session only.
    }
  }
}
