import { Signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ProviderId, Status } from '../models';

/** What a viewer can do to a post, by provider. Everything else is Mastodon-only. */
export interface ProviderCapabilities {
  reply: boolean;
  favourite: boolean;
  reblog: boolean;
}

/**
 * Baseline capabilities per provider.
 *
 * `anonymous-mastodon` is a misleading name kept for now: it is the provider for
 * *unauthenticated reads of a Mastodon-compatible server*, and those servers fall
 * into two very different groups.
 *
 *  - A textboard like mawkingbird_server, targeted directly, where the viewer holds
 *    a durable session identity (the disposable-account/correlation-credential
 *    pattern). That identity owns its posts and can reply, like, boost, and follow —
 *    exactly like any other logged-in session. Writes work.
 *  - Some other instance (mastodon.social, fosstodon) read over `externalFetch()`
 *    with no token at all. Writes cannot work there and never could.
 *
 * The old flat `false` here assumed the second case for both, which made likes and
 * boosts unreachable against our own server: `StatusCard.toggleFavourite` returns
 * early on `!caps.favourite`, so the click produced no request and no error.
 *
 * So the baseline is now permissive and the *unauthenticated* case is narrowed per
 * status by {@link capabilitiesFor}, which is the only thing that can tell the two
 * apart — it needs the status, not just its provider id.
 */
export const PROVIDER_CAPS: Record<ProviderId, ProviderCapabilities> = {
  mastodon: { reply: true, favourite: true, reblog: true },
  'anonymous-mastodon': { reply: true, favourite: true, reblog: true },
  bluesky: { reply: true, favourite: true, reblog: true },
  rss: { reply: false, favourite: false, reblog: false },
  paste: { reply: false, favourite: false, reblog: false },
};

const NO_WRITES: ProviderCapabilities = { reply: false, favourite: false, reblog: false };

/**
 * Capabilities for one status, given whether this browser holds a token.
 *
 * Only `anonymous-mastodon` is conditional. A status of that provider is writable
 * when we are authenticated: the token belongs to the server the status came from,
 * because that is the server the session was opened against. Without a token the
 * fetch was anonymous and every write would be a 401, so the buttons come off.
 *
 * Restrictions the *server* imposes (a `no_interactions` moderation restriction, a
 * read-only identity) are deliberately not modelled here. The server is the only
 * thing that knows, discovering it costs a request per card, and the 403 it returns
 * carries a message the card already renders under the actions row.
 */
export function capabilitiesFor(
  provider: ProviderId | undefined,
  authenticated: boolean,
): ProviderCapabilities {
  const base = PROVIDER_CAPS[provider ?? 'mastodon'] ?? PROVIDER_CAPS.mastodon;
  if (provider === 'anonymous-mastodon' && !authenticated) {
    return NO_WRITES;
  }
  return base;
}

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
