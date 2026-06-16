// Mastodon API object shapes (the subset the UI consumes).

export interface Role {
  id: string;
  name: string;
  permissions: string;
  highlighted: boolean;
}

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
  // Present on verify_credentials (CredentialAccount): the current user's role, or null.
  role?: Role | null;
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

export interface Hashtag {
  name: string;
  url: string;
}

export interface SearchResults {
  accounts: Account[];
  statuses: Status[];
  hashtags: Hashtag[];
}

export interface UserList {
  id: string;
  title: string;
}

/** Mock-only dev account record used by the login screen. */
export interface DevUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
  access_token: string;
}

// --- Admin / moderation entities ---

export interface AdminAccount {
  id: string;
  username: string;
  domain: string | null;
  email: string;
  created_at: string;
  role: Role;
  confirmed: boolean;
  approved: boolean;
  disabled: boolean;
  silenced: boolean;
  suspended: boolean;
  account: Account;
}

export interface AdminReport {
  id: string;
  action_taken: boolean;
  category: string;
  comment: string;
  created_at: string;
  account: AdminAccount | null;
  target_account: AdminAccount | null;
  assigned_account: AdminAccount | null;
  statuses: Status[];
}

export interface DomainBlock {
  id: string;
  domain: string;
  severity: string;
  reject_media: boolean;
  reject_reports: boolean;
  public_comment: string | null;
  created_at: string;
}
