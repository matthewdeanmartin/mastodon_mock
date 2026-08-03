/**
 * The catalog of one-account connectors shown on Settings → Connections.
 *
 * This is deliberately inert data. A catalog entry describes a connector well
 * enough to decide whether you want it — what the service is, what connecting
 * it turns on inside Mawkingbird — and nothing about how to set it up. Setup
 * lives on the entry's own lazily-loaded child page, which is the whole point:
 * the roadmap has a dozen more connectors coming, and they cannot all keep
 * living in one template.
 *
 * Two things are intentionally *not* here:
 *
 * - **Connected state.** A `Signal<boolean>` per entry would mean importing
 *   every session service into this module, which every connections bundle
 *   then pulls in, which defeats the lazy child routes entirely. The catalog
 *   page injects the sessions and maps `id -> connected` itself.
 * - **The route.** It is always `/settings/connections/<id>`, so storing it
 *   would just be a second place to get it wrong.
 *
 * A connection is *one account*. Anything that is a list of many things (RSS
 * feeds, paste providers) is not a connection and does not belong in this
 * catalog — it gets its own settings page.
 *
 * **Two deliberate exceptions: `cors-proxy` and `link-shortener`.** Both are
 * pickers over a catalog of services, so by the rule above they belong on their
 * own pages. They live here anyway, because what the user configures *is* one
 * thing — a single proxy, or a single active shortener — that every feature
 * routes through, and because the keys they hold are credentials that must sit
 * under the same retention policy as the tokens on this page.
 *
 * Choosing one of several vendors is not the same as maintaining a list. The
 * paste providers, where all three stay live at once and a post goes to
 * whichever you pick at the time, are the case the rule is really aimed at. The
 * shortener is the near miss that proves the distinction: it *stores* a key per
 * service, so that switching back is cheap, but only one is ever active and
 * "shorten this URL" always has exactly one answer.
 */

import { FeatureFlagId } from '../../../feature-flags';

/** Route segment under `/settings/connections`, and the entry's identity. */
export type ConnectionId =
  | 'github'
  | 'dropbox'
  | 'raindrop'
  | 'bluesky'
  | 'openrouter'
  | 'cors-proxy'
  | 'link-shortener'
  | 'twitter'
  | 'mataroa';

/**
 * Who a connection belongs to — which is a question users actually ask, and
 * which the app answers three different ways.
 *
 * `browser` is the common case, and the right default: these credentials belong
 * to the *human* sitting here, not to a persona. An LLM key or a bookmarking
 * token works the same whoever you are signed in as, and re-pasting it for every
 * alt is busywork with no privacy benefit — the alt could read the other copy
 * out of the same localStorage anyway.
 *
 * `account` is the exception, for a connection that is itself an identity. A
 * Bluesky link says "this Mastodon persona is also that Bluesky handle", which
 * is a claim about *one* persona, so it is stored under {@link scopedKey} and
 * your alt gets its own or none. That includes the browser-local Anonymous
 * account, which gets one of its own too.
 *
 * `session` is also shared by every account, but never reaches localStorage —
 * it dies with the tab. Used where the provider hands out short-lived OAuth
 * tokens and there is nothing worth keeping.
 */
export type ConnectionScope = 'account' | 'browser' | 'session';

export interface ConnectionScopeCopy {
  /** Badge text. Short enough to sit next to the connected pill. */
  label: string;
  /** One sentence, shown on the connector's own page. */
  detail: string;
}

export const CONNECTION_SCOPE_COPY: Record<ConnectionScope, ConnectionScopeCopy> = {
  account: {
    label: 'One per account',
    detail:
      'Stored against the account you are signed in as — including Anonymous. Each of your accounts links its own, or none.',
  },
  browser: {
    label: 'All accounts',
    detail:
      'Shared by every account in this browser, including Anonymous — it belongs to you, not to one profile.',
  },
  session: {
    label: 'All accounts, this tab',
    detail:
      'Shared by every account in this browser, but never written to long-term storage — closing the tab disconnects it.',
  },
};

/**
 * The rollout flag that gates each connector, one per vendor.
 *
 * Per-vendor rather than per-category because that is how these actually break:
 * a scraper service dies, or an API starts refusing browsers, and the answer is
 * to stop onboarding people onto *that one* while the rest keep working.
 *
 * A flagged-off connector is greyed, never hidden — see
 * {@link FeatureFlags.disabledReason}.
 */
export const CONNECTION_FLAGS: Record<ConnectionId, FeatureFlagId> = {
  bluesky: 'connector-bluesky',
  twitter: 'connector-twitter',
  mataroa: 'connector-mataroa',
  openrouter: 'connector-openrouter',
  raindrop: 'connector-raindrop',
  github: 'connector-github',
  dropbox: 'connector-dropbox',
  'link-shortener': 'connector-link-shortener',
  'cors-proxy': 'connector-cors-proxy',
};

export interface ConnectionCatalogEntry {
  id: ConnectionId;
  /** Display name of the service, as the service spells it. */
  label: string;
  emoji: string;
  /** One sentence: what this service *is*, for someone who has never used it. */
  pitch: string;
  /**
   * Who this connection belongs to. Must match how the connector's session
   * actually stores its credential — this is a claim about storage, not a
   * preference, so changing one without the other is a lie on the card.
   */
  scope: ConnectionScope;
  /**
   * What connecting it turns on in Mawkingbird. Short phrases, not sentences —
   * they render as a list. Two to four of them; if a connector needs more than
   * four to justify itself, the extras belong on its own page.
   */
  enables: string[];
}

/**
 * Every connector, in the order they appear. Ordering is by usefulness to a
 * new user rather than alphabetical, so the two that change your timeline
 * (Bluesky) or your bookmarks (Raindrop) are not buried under the two that are
 * closer to curiosities.
 */
export const CONNECTION_CATALOG: readonly ConnectionCatalogEntry[] = [
  {
    id: 'bluesky',
    label: 'Bluesky',
    emoji: '🦋',
    pitch: 'Your Bluesky account, read and write.',
    // The one genuinely per-persona connection: it asserts who this Mastodon
    // account also is. One Bluesky handle per Mastodon account, Anonymous
    // included — see AnonymousCapabilities.canUseBluesky.
    scope: 'account',
    enables: [
      'Bluesky posts merged into your home timeline',
      'Reply, like and repost without leaving Mawkingbird',
      'Bluesky DMs in Chat',
    ],
  },
  {
    id: 'twitter',
    label: 'Twitter',
    emoji: '🐦',
    pitch: 'Read public tweets, so the friends who never left stay in your reading.',
    // The key belongs to whoever pays for the API credits, not to a persona —
    // same reasoning as OpenRouter and the CORS proxy. See TwitterSettings. The
    // *follows* built on top of it are account-scoped; the key is not.
    scope: 'browser',
    enables: [
      'Follow public Twitter accounts and read their posts here',
      'Read-only: no Twitter login, and nothing you do is sent to Twitter',
      'Needs your own API key and a CORS proxy',
    ],
  },
  {
    id: 'mataroa',
    label: 'Blog (Mataroa)',
    emoji: '✍️',
    pitch: 'Your Mataroa blog, published from the composer.',
    scope: 'account',
    enables: [
      'Publish Markdown posts from the Blog composer target',
      'Optionally include your blog RSS posts on your Mawkingbird profile',
      'Needs your own API key and a CORS proxy',
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    emoji: '🧠',
    pitch: 'One key, hundreds of AI models, billed by usage.',
    // The only connector whose credential belongs to the human rather than to
    // a Mastodon persona — see OpenRouterSession for why it is unscoped.
    scope: 'browser',
    enables: [
      'Turn plain English into Mastodon search queries',
      'Suggest hashtags that actually have activity',
    ],
  },
  {
    id: 'raindrop',
    label: 'Raindrop.io',
    emoji: '💧',
    pitch: 'The Raindrop.io bookmarking service.',
    // Your bookmark drawer, not one persona's — see RaindropSession for why the
    // token is stored unscoped.
    scope: 'browser',
    enables: [
      'A second place to save bookmarks',
      "Save a post's first external link instead of the post itself",
    ],
  },
  {
    id: 'github',
    label: 'GitHub',
    emoji: '🐙',
    pitch: 'Your GitHub account, read-only.',
    scope: 'account',
    enables: ['Find the people you follow on GitHub over here', 'Read your unread notifications'],
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    emoji: '📦',
    pitch: 'An app-specific folder in your Dropbox.',
    scope: 'session',
    enables: ['Browse those files from Mawkingbird'],
  },
  {
    id: 'link-shortener',
    label: 'Link shortener',
    emoji: '🔗',
    pitch: 'Dub, Short.io or T.LY, for shortening the URLs you post.',
    // The subscription belongs to whoever pays for it, not to a persona — same
    // reasoning as OpenRouter and the CORS proxy. See ShortenerSettings.
    scope: 'browser',
    enables: [
      'Shorten a URL as you write a post',
      'Keep a list of every link you have made, and delete old ones',
    ],
  },
  {
    id: 'cors-proxy',
    label: 'CORS proxy',
    emoji: '🔀',
    pitch: 'A relay for sites that refuse to talk to browsers directly.',
    // The key belongs to whoever pays for the proxy, not to a persona — same
    // reasoning as OpenRouter. See CorsProxySettings.
    scope: 'browser',
    enables: [
      'Read RSS feeds whose publishers block cross-origin access',
      'Use your own proxy, or a paid one, instead of a rate-limited free service',
    ],
  },
];
