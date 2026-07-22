import { ServerFeedKind } from './list-source';

/** Static metadata for the built-in server feeds surfaced as lists. */
export interface ServerFeedDef {
  feed: ServerFeedKind;
  title: string;
  blurb: string;
  /** These require an authenticated session (mastodon.social 422s them
   *  anonymously — see the mastodon.social anonymous endpoints note). */
  authRequired: boolean;
}

export const SERVER_FEEDS: ServerFeedDef[] = [
  {
    feed: 'federated',
    title: 'Fediverse',
    blurb: 'Public posts from across the federated network.',
    authRequired: true,
  },
  {
    feed: 'local',
    title: 'Local timeline',
    blurb: "Public posts from this server's own members.",
    authRequired: true,
  },
  {
    feed: 'news',
    title: 'News',
    blurb: 'Posts trending right now.',
    authRequired: false,
  },
];

export function serverFeedDef(feed: ServerFeedKind): ServerFeedDef | undefined {
  return SERVER_FEEDS.find((f) => f.feed === feed);
}
