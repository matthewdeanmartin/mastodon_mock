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
 */

/** Route segment under `/settings/connections`, and the entry's identity. */
export type ConnectionId = 'github' | 'dropbox' | 'raindrop' | 'bluesky' | 'openrouter';

/**
 * Who a connection belongs to — which is a question users actually ask, and
 * which the app answers three different ways.
 *
 * `account` is the norm: the credential is stored under {@link scopedKey}, so
 * your alt has its own (or none). `browser` is the deliberate exception for a
 * credential that belongs to the *human* rather than to a persona — an LLM key
 * works the same whoever you are signed in as. `session` means it never reaches
 * localStorage at all and dies with the tab.
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
    label: 'This account',
    detail:
      'Stored against the Mastodon account you are signed in as. Your other accounts each get their own.',
  },
  browser: {
    label: 'All accounts',
    detail:
      'Shared by every account in this browser, including Anonymous — it belongs to you, not to one profile.',
  },
  session: {
    label: 'This tab only',
    detail: 'Never written to long-term storage. Closing the tab disconnects it.',
  },
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
    scope: 'account',
    enables: [
      'Bluesky posts merged into your home timeline',
      'Reply, like and repost without leaving Mawkingbird',
      'Bluesky DMs in Chat',
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
    scope: 'account',
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
];
