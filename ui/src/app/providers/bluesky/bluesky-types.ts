// Minimal AT Protocol / app.bsky view shapes — only what the adapter consumes.

export interface BskyAuthor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/**
 * The viewer's relationship to an actor — `app.bsky.actor.defs#viewerState`.
 *
 * `following` and `followedBy` are not booleans: they are the at-uris of the
 * follow *records*, which is exactly what unfollowing needs (deleteRecord takes
 * the record's uri). Absent means "no such record", so presence is the boolean.
 */
export interface BskyViewerState {
  following?: string;
  followedBy?: string;
  blocking?: string;
  blockedBy?: boolean;
  muted?: boolean;
}

/** `app.bsky.actor.defs#profileViewDetailed` — the fields the rail card shows. */
export interface BskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  viewer?: BskyViewerState;
}

export interface BskyFacet {
  index: { byteStart: number; byteEnd: number };
  features: {
    $type: string;
    did?: string; // mention
    uri?: string; // link
    tag?: string; // hashtag
  }[];
}

export interface BskyPostRecord {
  $type: string;
  text: string;
  createdAt: string;
  facets?: BskyFacet[];
  reply?: {
    root: { uri: string; cid: string };
    parent: { uri: string; cid: string };
  };
}

export interface BskyImage {
  thumb: string;
  fullsize: string;
  alt: string;
}

/** A post embed view; `$type` discriminates (images / external / record / recordWithMedia). */
export interface BskyEmbedView {
  $type: string;
  images?: BskyImage[];
  external?: { uri: string; title: string; description: string; thumb?: string };
  record?: BskyEmbeddedRecord | { record: BskyEmbeddedRecord };
  media?: BskyEmbedView;
}

/** app.bsky.embed.record#viewRecord (or viewNotFound / viewBlocked). */
export interface BskyEmbeddedRecord {
  $type?: string;
  uri?: string;
  cid?: string;
  author?: BskyAuthor;
  value?: BskyPostRecord;
}

export interface BskyPostView {
  uri: string;
  cid: string;
  author: BskyAuthor;
  record: BskyPostRecord;
  embed?: BskyEmbedView;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  indexedAt: string;
  viewer?: { like?: string; repost?: string };
}

export interface BskyFeedItem {
  post: BskyPostView;
  reason?: { $type: string; by?: BskyAuthor; indexedAt?: string };
}

export interface BskyTimeline {
  feed: BskyFeedItem[];
  cursor?: string;
}

/**
 * How `app.bsky.feed.getAuthorFeed` is filtered.
 *
 * Mastodon's profile has three toggles (boosts, replies, media); Bluesky
 * expresses the same choices as one server-side filter, so the profile page maps
 * its toggles onto these rather than filtering client-side and paging holes.
 */
export type BskyAuthorFeedFilter =
  | 'posts_with_replies'
  | 'posts_no_replies'
  | 'posts_with_media'
  | 'posts_and_author_threads';

/** `app.bsky.feed.getPostThread` node; `post` is absent on notFound/blocked variants. */
export interface BskyThreadNode {
  $type?: string;
  post?: BskyPostView;
  parent?: BskyThreadNode;
  replies?: BskyThreadNode[];
}

// -------------------------------------------------------------- notifications

/**
 * One row of `app.bsky.notification.listNotifications`.
 *
 * `record` is the *notifying* record and varies with `reason`: a like record for
 * `like`, the reply post itself for `reply`, a follow record for `follow`. For
 * the reasons whose record is not the interesting post, `reasonSubject` names
 * the post that is — see {@link BskyNotification.reasonSubject}.
 */
export interface BskyNotification {
  uri: string;
  cid: string;
  author: BskyAuthor;
  /**
   * Why this arrived. `knownValues` in the lexicon, which in AT Protocol means
   * "these are known, others are legal" — so this stays a plain string and the
   * adapter has a default arm. A `repost-via-repost` turned up in the first 20
   * notifications of a test account, so the long tail is not theoretical.
   */
  reason: string;
  /**
   * The post that was liked/reposted/replied to, when the reason implies one.
   * Absent for `follow`. **Not always a post**: a `repost-via-repost` names a
   * repost record, which `getPosts` will not return.
   */
  reasonSubject?: string;
  record?: { $type?: string } & Partial<BskyPostRecord>;
  isRead: boolean;
  indexedAt: string;
}

export interface BskyNotificationPage {
  notifications: BskyNotification[];
  cursor?: string;
  seenAt?: string;
  priority?: boolean;
}

// ---------------------------------------------------------------- chat (DMs)

export interface BskyChatMember {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/** chat.bsky.convo.defs#messageView (deleted messages arrive with no text). */
export interface BskyMessageView {
  $type?: string;
  id: string;
  rev: string;
  text?: string;
  facets?: BskyFacet[];
  sender: { did: string };
  sentAt: string;
}

export interface BskyConvoView {
  id: string;
  rev: string;
  members: BskyChatMember[];
  lastMessage?: BskyMessageView;
  muted?: boolean;
  unreadCount: number;
}

export interface BskyConvoList {
  convos: BskyConvoView[];
  cursor?: string;
}

/** chat.bsky.convo.getLog entry; `$type` ends in #logCreateMessage etc. */
export interface BskyChatLogEntry {
  $type: string;
  rev: string;
  convoId: string;
  message?: BskyMessageView;
}

/** What the provider stashes in `Status.providerRef` for later interactions. */
export interface BskyRef {
  uri: string;
  cid: string;
  /** at-uri of the viewer's like/repost record, when they exist (needed to undo). */
  likeUri: string | null;
  repostUri: string | null;
  /** The thread root to use when replying to this post. */
  replyRoot: { uri: string; cid: string };
}
