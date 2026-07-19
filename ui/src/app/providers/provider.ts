import { Signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ProviderId, Status } from '../models';

/** What a viewer can do to a post, by provider. Everything else is Mastodon-only. */
export interface ProviderCapabilities {
  reply: boolean;
  favourite: boolean;
  reblog: boolean;
}

export const PROVIDER_CAPS: Record<ProviderId, ProviderCapabilities> = {
  mastodon: { reply: true, favourite: true, reblog: true },
  'anonymous-mastodon': { reply: false, favourite: false, reblog: false },
  bluesky: { reply: true, favourite: true, reblog: true },
  rss: { reply: false, favourite: false, reblog: false },
};

/**
 * A non-Mastodon content source that contributes to the home timeline.
 *
 * Providers adapt their native content into Mastodon-shaped `Status` objects
 * (tagged with `provider` and namespaced ids) so nothing outside `providers/`
 * ever learns another protocol exists. The `FeedAggregator` drives paging:
 * `reset()` then repeated `fetchPage()` until `[]` (exhausted).
 */
export interface FeedProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Short badge shown on status cards and filter chips, e.g. "📡 RSS". */
  readonly badge: string;
  /** True when the user has linked/configured this provider. */
  readonly linked: Signal<boolean>;
  /** Human-readable problems from the last fetch (bad feed, CORS, …). */
  readonly errors: Signal<string[]>;
  /** Start over from the newest content. */
  reset(): void;
  /** The next (older) page of home content; `[]` means exhausted. */
  fetchPage(): Observable<Status[]>;
}
