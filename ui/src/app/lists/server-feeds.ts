import { ServerFeedKind } from './list-source';

/** What kind of content a server feed renders. */
export type ServerFeedContent = 'posts' | 'links';

/** Static metadata for the built-in server feeds surfaced as lists. */
export interface ServerFeedDef {
  feed: ServerFeedKind;
  title: string;
  blurb: string;
  content: ServerFeedContent;
  /** These require an authenticated session (mastodon.social 422s them
   *  anonymously — see the mastodon.social anonymous endpoints note). */
  authRequired: boolean;
  /**
   * Whether to probe the endpoint before offering the row. mastodon.social has
   * disabled the public/federated timelines, but other instances keep them, so
   * we ask once and hide the row if nothing comes back rather than let people
   * click into an empty feed.
   */
  probe: boolean;
}

export const SERVER_FEEDS: ServerFeedDef[] = [
  {
    feed: 'federated',
    title: 'Fediverse',
    blurb: 'Public posts from across the federated network.',
    content: 'posts',
    authRequired: true,
    probe: true,
  },
  {
    feed: 'local',
    title: 'Local timeline',
    blurb: "Public posts from this server's own members.",
    content: 'posts',
    authRequired: true,
    probe: true,
  },
  {
    feed: 'trending',
    title: 'Trending posts',
    blurb: 'Posts getting attention right now.',
    content: 'posts',
    authRequired: false,
    probe: false,
  },
  {
    feed: 'news',
    title: 'News',
    blurb: 'Links trending across the fediverse.',
    content: 'links',
    authRequired: false,
    probe: false,
  },
];

export function serverFeedDef(feed: ServerFeedKind): ServerFeedDef | undefined {
  return SERVER_FEEDS.find((f) => f.feed === feed);
}
