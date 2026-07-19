import { computed, inject, Injectable } from '@angular/core';
import { Auth } from '../auth';
import { BlueskyProvider } from './bluesky/bluesky-provider';
import { FeedProvider } from './provider';
import { RssProvider } from './rss/rss-provider';

/**
 * The foreign providers this build knows about. Mastodon is not listed — it is
 * the primary network, not a provider.
 */
@Injectable({ providedIn: 'root' })
export class ProviderRegistry {
  private auth = inject(Auth);
  private bluesky = inject(BlueskyProvider);
  private rss = inject(RssProvider);

  readonly all: FeedProvider[] = [this.bluesky, this.rss];

  /** Providers the user has actually connected (feeds added, account linked…). */
  readonly linked = computed(() =>
    this.all.filter((p) => p.linked() && (!this.auth.isAnonymous || p.id !== 'bluesky')),
  );
}
