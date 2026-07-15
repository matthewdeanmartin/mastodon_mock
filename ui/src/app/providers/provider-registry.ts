import { computed, inject, Injectable } from '@angular/core';
import { FeedProvider } from './provider';
import { RssProvider } from './rss/rss-provider';

/**
 * The foreign providers this build knows about. Mastodon is not listed — it is
 * the primary network, not a provider. Bluesky joins this list next sprint.
 */
@Injectable({ providedIn: 'root' })
export class ProviderRegistry {
  private rss = inject(RssProvider);

  readonly all: FeedProvider[] = [this.rss];

  /** Providers the user has actually connected (feeds added, account linked…). */
  readonly linked = computed(() => this.all.filter((p) => p.linked()));
}
