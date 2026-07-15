// Minimal AT Protocol / app.bsky view shapes — only what the adapter consumes.

export interface BskyAuthor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
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

/** `app.bsky.feed.getPostThread` node; `post` is absent on notFound/blocked variants. */
export interface BskyThreadNode {
  $type?: string;
  post?: BskyPostView;
  parent?: BskyThreadNode;
  replies?: BskyThreadNode[];
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
