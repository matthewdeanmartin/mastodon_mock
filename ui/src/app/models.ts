// Mastodon API object shapes (the subset the UI consumes).

export interface Role {
  id: string;
  name: string;
  permissions: string;
  highlighted: boolean;
}

/** A key/value profile metadata field ("Website", "Pronouns", …). */
export interface AccountField {
  name: string;
  value: string;
  verified_at?: string | null;
}

/** Editable defaults returned in `source` on verify_credentials. */
export interface AccountSource {
  privacy: string;
  sensitive: boolean;
  language: string | null;
  note: string;
  fields: AccountField[];
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
  fields: AccountField[];
  // Present on verify_credentials (CredentialAccount): the current user's role, or null.
  role?: Role | null;
  source?: AccountSource;
}

export interface MediaAttachment {
  id: string;
  type: string;
  url: string;
  preview_url: string;
  description: string | null;
}

export interface PollOption {
  title: string;
  votes_count: number;
}

export interface Poll {
  id: string;
  expires_at: string | null;
  expired: boolean;
  multiple: boolean;
  votes_count: number;
  voters_count: number;
  options: PollOption[];
  voted: boolean;
  own_votes: number[];
  // hide_totals is not serialized by the mock; totals are always returned.
}

/** A status's quote of another status (Mastodon `Quote` entity). */
export interface Quote {
  // pending | accepted | rejected | revoked | deleted | unauthorized
  state: string;
  // The quoted status, or null when it is not visible (e.g. revoked).
  quoted_status: Status | null;
}

export interface Status {
  id: string;
  created_at: string;
  edited_at: string | null;
  content: string;
  spoiler_text: string;
  visibility: string;
  url: string | null;
  account: Account;
  reblog: Status | null;
  quote: Quote | null;
  in_reply_to_id: string | null;
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
  favourited: boolean;
  reblogged: boolean;
  bookmarked: boolean;
  muted: boolean;
  pinned: boolean;
  sensitive: boolean;
  poll: Poll | null;
  quote_approval_policy: string | null;
  media_attachments: MediaAttachment[];
}

/** A single edit-history snapshot (`GET /api/v1/statuses/{id}/history`). */
export interface StatusEdit {
  content: string;
  spoiler_text: string;
  sensitive: boolean;
  created_at: string;
  account: Account;
  media_attachments: MediaAttachment[];
  poll: Poll | null;
}

export interface StatusSource {
  id: string;
  text: string;
  spoiler_text: string;
}

/** Result of `POST /api/v1/statuses/{id}/translate`. */
export interface Translation {
  content: string;
  spoiler_text: string;
  detected_source_language: string;
  provider: string;
}

/** Options accepted by the composer's status-create path. */
export interface ComposeOptions {
  inReplyToId?: string;
  /** Quote another status (Mastodon 4.5+ `quoted_status_id`). */
  quotedStatusId?: string;
  visibility?: string;
  spoilerText?: string;
  sensitive?: boolean;
  mediaIds?: string[];
  poll?: PollDraft;
}

/** A poll being composed (UI-side), serialized to `poll[...]` params. */
export interface PollDraft {
  options: string[];
  expiresIn: number;
  multiple: boolean;
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

export interface AnnouncementReaction {
  name: string;
  count: number;
  me: boolean;
  url: string | null;
  static_url: string | null;
}

export interface Announcement {
  id: string;
  content: string;
  // Present on the admin surface; undefined on the public read endpoint.
  published?: boolean;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  published_at: string | null;
  updated_at: string | null;
  read: boolean;
  reactions: AnnouncementReaction[];
}

export interface TrendingTagHistory {
  day: string;
  uses: string;
  accounts: string;
}

export interface TrendingTag {
  id: string;
  name: string;
  url: string;
  history: TrendingTagHistory[];
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

/** Per-phase row counts + timings returned by the sample-data generator. */
export interface GenerationReport {
  accounts: number;
  relationships: number;
  statuses: number;
  favourites: number;
  bookmarks: number;
  notifications: number;
  total_rows: number;
  total_seconds: number;
  rows_per_second: number;
}

export interface InstanceRule {
  id: string;
  text: string;
  hint: string;
}

export interface TermsOfService {
  effective_date: string | null;
  effective: boolean;
  content: string;
  succeeded_by: string | null;
}

/** Subset of `GET /api/v2/instance` the explore page renders. */
export interface InstanceInfo {
  domain: string;
  title: string;
  description: string;
  version: string;
  usage: { users: { active_month: number } };
  thumbnail: { url: string | null };
  contact: { email: string; account: Account | null };
  rules: InstanceRule[];
}

/** A trending preview card (`GET /api/v1/trends/links`). */
export interface TrendLink {
  url: string;
  title: string;
  description: string;
  provider_name: string;
}

export interface CustomEmoji {
  shortcode: string;
  url: string;
  static_url: string;
  visible_in_picker: boolean;
  category?: string;
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

export interface DomainAllow {
  id: string;
  domain: string;
  created_at: string;
}

export interface EmailDomainBlock {
  id: string;
  domain: string;
  created_at: string;
}

export interface CanonicalEmailBlock {
  id: string;
  canonical_email_hash: string;
}

export interface IpBlock {
  id: string;
  ip: string;
  severity: string;
  comment: string;
  created_at: string;
  expires_at: string | null;
}

/** A single zero/empty admin measure (admin/measures). */
export interface AdminMeasure {
  key: string;
  unit: string | null;
  total: string;
  human_value: string;
  previous_total: string;
  data: { date: string; value: string }[];
}

// --- Conversations (DMs) ---

export interface Conversation {
  id: string;
  unread: boolean;
  accounts: Account[];
  last_status: Status | null;
}

// --- Tags ---

/** Full Mastodon `Tag` entity (richer than the search `Hashtag`). */
export interface Tag {
  id: string;
  name: string;
  url: string;
  following: boolean;
  featuring: boolean;
  history: TrendingTagHistory[];
}

export interface FeaturedTag {
  id: string;
  name: string;
  url: string;
  statuses_count: number;
  last_status_at: string | null;
}

// --- Fault injection (mock-only control plane) ---

export interface FaultMatch {
  methods: string[] | null;
  path: string | null;
  path_regex: string | null;
}

export type FaultEffectType = 'status' | 'ratelimit' | 'latency' | 'malformed' | 'timeout';

export interface FaultEffect {
  type: FaultEffectType;
  status: number;
  body: unknown;
  headers: Record<string, string>;
  delay_ms: number;
  truncate: boolean;
}

export interface FaultRule {
  id: string;
  match: FaultMatch;
  effect: FaultEffect;
  remaining: number | null;
}

/** Shape POSTed to create a fault rule (mirrors FaultStore.add's input). */
export interface FaultRuleDraft {
  match: {
    methods?: string[];
    path?: string;
    path_regex?: string;
  };
  effect: {
    type: FaultEffectType;
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
    delay_ms?: number;
    truncate?: boolean;
  };
  count?: number;
}

// --- OAuth (full authorization-code flow) ---

export interface OAuthApp {
  id: string;
  name: string;
  website: string | null;
  redirect_uri: string;
  redirect_uris: string[];
  client_id: string;
  client_secret: string;
  vapid_key: string;
  scopes: string[];
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  created_at: number;
}
