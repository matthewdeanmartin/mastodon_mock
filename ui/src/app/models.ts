// Mastodon API object shapes (the subset the UI consumes).

export interface Account {
  id: string;
  username: string;
  acct: string;
  display_name: string;
  note: string;
  url: string;
  avatar: string;
  avatar_static: string;
  header: string;
  followers_count: number;
  following_count: number;
  statuses_count: number;
  bot: boolean;
  locked: boolean;
}

export interface MediaAttachment {
  id: string;
  type: string;
  url: string;
  preview_url: string;
  description: string | null;
}

export interface Status {
  id: string;
  created_at: string;
  content: string;
  spoiler_text: string;
  visibility: string;
  url: string | null;
  account: Account;
  reblog: Status | null;
  in_reply_to_id: string | null;
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  favourited: boolean;
  reblogged: boolean;
  bookmarked: boolean;
  media_attachments: MediaAttachment[];
}

export interface Context {
  ancestors: Status[];
  descendants: Status[];
}

export interface Relationship {
  id: string;
  following: boolean;
  followed_by: boolean;
  requested: boolean;
  blocking: boolean;
  muting: boolean;
}

export interface MastodonNotification {
  id: string;
  type: string;
  created_at: string;
  account: Account;
  status?: Status;
}
