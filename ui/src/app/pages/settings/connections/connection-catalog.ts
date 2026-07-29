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
export type ConnectionId = 'github' | 'dropbox' | 'raindrop' | 'bluesky';

export interface ConnectionCatalogEntry {
  id: ConnectionId;
  /** Display name of the service, as the service spells it. */
  label: string;
  emoji: string;
  /** One sentence: what this service *is*, for someone who has never used it. */
  pitch: string;
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
    enables: [
      'Bluesky posts merged into your home timeline',
      'Reply, like and repost without leaving Mawkingbird',
      'Bluesky DMs in Chat',
    ],
  },
  {
    id: 'raindrop',
    label: 'Raindrop.io',
    emoji: '💧',
    pitch: 'The Raindrop.io bookmarking service.',
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
    enables: ['Find the people you follow on GitHub over here', 'Read your unread notifications'],
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    emoji: '📦',
    pitch: 'An app-specific folder in your Dropbox.',
    enables: ['Browse those files from Mawkingbird'],
  },
];
