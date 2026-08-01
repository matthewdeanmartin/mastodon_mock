import { computed, inject, Injectable } from '@angular/core';
import { BlueskyProvider } from './bluesky/bluesky-provider';
import { FeedProvider } from './provider';
import { RssProvider } from './rss/rss-provider';
import { AnonymousMastodonProvider } from './anonymous/anonymous-mastodon-provider';
import { PasteFeedProvider } from './paste/paste-feed-provider';
import { TwitterProvider } from './twitter/twitter-provider';
import { FeatureFlags } from '../feature-flags';

/**
 * The foreign providers this build knows about. Mastodon is not listed — it is
 * the primary network, not a provider.
 */
@Injectable({ providedIn: 'root' })
export class ProviderRegistry {
  private bluesky = inject(BlueskyProvider);
  private rss = inject(RssProvider);
  private anonymousMastodon = inject(AnonymousMastodonProvider);
  private paste = inject(PasteFeedProvider);
  private twitter = inject(TwitterProvider);
  private featureFlags = inject(FeatureFlags);

  readonly all: FeedProvider[] = [
    this.anonymousMastodon,
    this.bluesky,
    this.rss,
    this.twitter,
    this.paste,
  ];

  /**
   * Providers the user has actually connected (feeds added, account linked…).
   *
   * Bluesky used to be filtered out for the Anonymous account. It isn't any
   * more: the link carries its own credential and needs no Mastodon token, and
   * an anonymous session merging in a real Bluesky timeline is the whole pitch
   * the Invites page makes to Bluesky users. See
   * AnonymousCapabilities.canUseBluesky.
   */
  readonly linked = computed(() =>
    this.all.filter(
      (p) => p.linked() && (p.id !== 'paste' || this.featureFlags.enabled('pastebin')),
    ),
  );
}
