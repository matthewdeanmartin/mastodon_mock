/**
 * The inventory of everything this app keeps in `localStorage`, classified by
 * how dangerous it is to let it leave the browser.
 *
 * This exists because settings export is going somewhere specific: a user
 * publishing their Mawkingbird setup as a **public gist** and pointing other
 * people at it. That makes "is this safe to write to a file?" a question with
 * two different answers, not one:
 *
 *   - Would leaking it let someone *act as me*?  → {@link Sensitivity} `secret`
 *   - Would leaking it tell someone *about me*?  → `private`
 *
 * The second is the one that is easy to get wrong. A follow list or a
 * subscribed hashtag is not a credential and never will be, but "subscribed to
 * #diabetesSufferers" published on a gist is a health disclosure the user did
 * not intend to make. Tag subscriptions, muted words, saved searches, and the
 * instance you call home are all in that category.
 *
 * Two export profiles fall out of this (see {@link EXPORT_PROFILES}):
 * `shareable` publishes `setting` only, `personal` adds `private` and
 * `content`. Nothing ever exports `secret` or `cache`.
 */

/** How sensitive one storage key's contents are. */
export type Sensitivity =
  /**
   * A credential. Leaking it lets someone act as the user. Never exported,
   * under any profile, for any reason. Access tokens, JWTs, paste edit keys.
   */
  | 'secret'
  /**
   * Not a credential, but it discloses something about the person: who they
   * follow, what they mute, which tags and feeds they read, which instance
   * they are on. Fine in a personal backup, never in something published.
   */
  | 'private'
  /**
   * Text the user wrote and has not necessarily published: drafts, local
   * posts, DMs, paste bodies. Excluded from a shareable export, and worth its
   * own opt-in even in a personal one because of the bulk.
   */
  | 'content'
  /**
   * A preference with no personal content: theme, fonts, feature flags,
   * layout, retention policy. This is the stuff worth publishing — the actual
   * payload of a "here is my setup" gist.
   */
  | 'setting'
  /**
   * Refetchable data held only to avoid a request. Never exported: it is noise
   * at best, and some of it (feed corpus, instance probes) is derived from
   * `private` data anyway.
   */
  | 'cache';

export interface StorageKeySpec {
  /** The key, or its unsuffixed base when `scoped`. */
  base: string;
  /**
   * Which store it lives in. `session` keys die with the tab and are never
   * exportable regardless of sensitivity; they are inventoried so that "every
   * key is classified" is a claim about all of them, not just the durable ones.
   */
  storage: 'local' | 'session';
  /**
   * How the real key relates to `base`:
   *
   * - `none`     — the key *is* the base.
   * - `account`  — `base + accountScopeSuffix()`. An importer has to re-derive
   *   the suffix for the account it is importing into: the suffix is a hash of
   *   the access token, so it never survives a re-authentication.
   * - `instance` — `base + encodeURIComponent(host)`, one entry per instance.
   *
   * Use {@link matchesKey} rather than reimplementing this comparison; a key
   * that no rule matches is treated as unregistered, and so is never exported.
   */
  suffix: 'none' | 'account' | 'instance';
  sensitivity: Sensitivity;
  /** Why it is classified this way — the part that is not obvious from the name. */
  note: string;
}

/**
 * Every localStorage key the app writes.
 *
 * Adding a key without adding it here is a bug: `storage-registry.spec.ts`
 * scans the source for `localStorage.setItem` and fails on anything unlisted,
 * so an unclassified key can never quietly reach an export.
 */
export const STORAGE_KEYS: readonly StorageKeySpec[] = [
  // ---- secret: credentials, never exported ----
  {
    base: 'mastodon_mock_token',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'Active Mastodon bearer token.',
  },
  {
    base: 'mastodon_mock_session_tokens',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'Bearer token per saved session, keyed by session id. Split out of mastodon_mock_sessions so the account list can be exported.',
  },
  {
    base: 'mockingbird_bsky_credentials',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'secret',
    note: 'Bluesky access + refresh JWTs. Split out of mockingbird_bsky_profile.',
  },
  {
    base: 'mockingbird_github_credentials',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'secret',
    note: 'GitHub personal access token. Split out of mockingbird_github_user.',
  },
  {
    base: 'mockingbird_raindrop_token',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'Raindrop.io test token. Unscoped: one bookmark drawer per browser, shared by every account. An account-suffixed copy from before that change is adopted on first read and may linger.',
  },
  {
    base: 'mockingbird_paste_edit_keys',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'Per-paste edit codes. A bearer capability: whoever holds one can rewrite or delete that paste. Split out of mockingbird_pastes.',
  },
  {
    base: 'mockingbird_centos_paste_key',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'paste.centos.org API key. That service refuses every endpoint without one, including creating pastes. Unscoped: it authorises this browser to talk to a pastebin, not one persona — which feeds you subscribe to stays per account. Retention-governed like the other pasted tokens.',
  },
  {
    base: 'mockingbird_cors_proxy_key',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'CORS proxy API key, plus the header name a custom proxy wants it in. Billable on a paid plan, so it is retention-governed like the other pasted tokens. Unscoped: the subscription belongs to the human, not to one persona. Split out of mockingbird_cors_proxy so the proxy choice itself stays exportable.',
  },

  // ---- private: discloses something about the person ----
  {
    base: 'mastodon_mock_sessions',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Which accounts on which instances. Identity, not credentials — the tokens live in mastodon_mock_session_tokens.',
  },
  {
    base: 'mastodon_mock_server',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Home instance. Names where the user is; a niche instance can be identifying on its own.',
  },
  {
    base: 'mockingbird_bsky_profile',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'private',
    note: 'Linked Bluesky handle, DID, display name, avatar, resolved PDS.',
  },
  {
    base: 'mockingbird_github_user',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'private',
    note: 'Linked GitHub login and profile.',
  },
  {
    base: 'mockingbird_anonymous_account',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'The browser-local Anonymous profile.',
  },
  {
    base: 'mockingbird_anonymous_follows',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Who the Anonymous account follows.',
  },
  {
    base: 'mockingbird_anonymous_bookmarks',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'What the Anonymous account saved.',
  },
  {
    base: 'mockingbird_anonymous_lists',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Anonymous account lists and their members.',
  },
  {
    base: 'mockingbird_anonymous_tags',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Followed hashtags. The canonical example of privacy-sensitive-but-not-secret: a health or identity tag published in a gist is a disclosure.',
  },
  {
    base: 'mockingbird_rss_feeds',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'private',
    note: 'Subscribed feed URLs — what the user reads. Also near-secret: private feed URLs (Feedbin, Miniflux, Google Alerts) routinely embed an API key in the URL itself. Each feed also carries its opt-in flag for the CORS proxy.',
  },
  {
    base: 'mockingbird_cors_proxy',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: "Which CORS proxy is selected, and a self-hosted proxy's URL template. Not secret — the key half lives in mockingbird_cors_proxy_key — but a custom template names a host the user runs.",
  },
  {
    base: 'mockingbird_paste_feeds',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'private',
    note: 'Subscribed paste feeds — what the user reads, and whether each goes through the CORS proxy. Scoped per account: following a feed as one persona says nothing about what the others want in their timeline. An unscoped list from before that change is adopted by the first account to read it.',
  },
  {
    base: 'mockingbird_saved_searches',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'private',
    note: 'Saved search terms. Reveals interests as directly as a tag subscription does.',
  },
  {
    base: 'mockingbird_local_moderation',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Muted words, accounts and domains. Often discloses more than a follow list.',
  },
  {
    base: 'mockingbird_muted_posts',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Individually hidden posts.',
  },
  {
    base: 'mockingbird_eliza_following',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'private',
    note: 'Whether the local Eliza account is followed.',
  },
  {
    base: 'mockingbird_rail_profile',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'private',
    note: 'Which profile cards are pinned to the rail — named accounts.',
  },
  {
    base: 'mockingbird_chat_read',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Per-conversation read markers; the conversation ids identify correspondents.',
  },
  {
    base: 'mockingbird_dismissed_announcements',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    note: 'Dismissed announcement ids — server-specific, so it points at the instance.',
  },
  {
    base: 'mockingbird_house_ad_clicks',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    // Not 'setting': it is a record of what the user did, not a preference, so it
    // has no business in a "here is my setup" gist even though it is dull.
    note: 'How many times each right-rail house ad was clicked, and when. Local only — never sent anywhere.',
  },
  {
    base: 'mockingbird_route_log',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'private',
    // Route shapes only (ids are sanitized out), but "which parts of the app do
    // I use, and for how long" is still a description of the person's habits —
    // exactly the sort of dull-looking thing that has no place in a public gist.
    note: 'Per-route visit counts and time spent, for the Observability page. Paths are sanitized (no ids or queries). Local only — never sent anywhere.',
  },

  // ---- content: text the user wrote ----
  {
    base: 'mockingbird_drafts',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'content',
    note: 'Unpublished post drafts.',
  },
  {
    base: 'mockingbird_compose_autosave',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'content',
    note: 'In-progress composer text.',
  },
  {
    base: 'mockingbird_pastes',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'content',
    note: 'Paste history including bodies. Edit codes are NOT here — see mockingbird_paste_edit_keys.',
  },
  {
    base: 'mockingbird_eliza_dm',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'content',
    note: 'Local DM threads.',
  },
  {
    base: 'mockingbird_local_posts',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'content',
    note: 'Locally-composed posts.',
  },
  {
    base: 'mockingbird_eliza_notifications',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'content',
    note: 'Locally-generated notifications.',
  },

  // ---- setting: the publishable payload ----
  {
    base: 'mockingbird_client_prefs',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Theme, accent, reader typography, composer behaviour. The bulk of a shareable setup.',
  },
  {
    base: 'mockingbird_house_ads',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Whether right-rail house ads show at all, and which ones are switched off individually. Unscoped: an opinion about an ad belongs to the person, not to one persona.',
  },
  {
    base: 'mockingbird_default_visibility',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'setting',
    note: 'Default post visibility.',
  },
  {
    base: 'mockingbird_hidden_providers',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'setting',
    note: 'Which providers are hidden from the merged timeline.',
  },
  {
    base: 'mockingbird_feature_flags',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Opt-in feature toggles.',
  },
  {
    base: 'mockingbird_credential_lifetime',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'setting',
    note: 'Connector credential retention policy (30d / 90d / never).',
  },
  {
    base: 'mockingbird_anonymous_preferences',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Preferences for the Anonymous account.',
  },
  {
    base: 'mockingbird_search_server_v1',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Optional separate search instance. Names a host, but choosing one is a config tip worth sharing.',
  },
  {
    base: 'mockingbird_translation_preference',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Which translator the 🌐 button uses: your server, AI via OpenRouter, or ask each time. Absent means the default (your server).',
  },
  {
    base: 'mockingbird_search_server_rejects_v1',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Servers already checked and rejected as search servers, so a hunt does not re-probe the same duds. Clearable from Settings → Server.',
  },
  {
    base: 'mockingbird_follow_nudge_dismissed',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Whether the follow nudge was dismissed.',
  },
  {
    base: 'mastodon_mock_account_mode',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Whether the last session was a Mastodon account or Anonymous.',
  },

  // ---- cache: refetchable, never exported ----
  {
    base: 'mastodon_mock_server_index',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Curated joinmastodon instance index.',
  },
  {
    base: 'mockingbird_server_about_v1',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Cached instance /about payloads.',
  },
  {
    base: 'mockingbird_cors_proxy_usage',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Counts of proxied requests and failures, for the Observability page. Diagnostics, not settings — resetting them loses nothing. Deliberately counters only: no URLs, so it never records which feeds were read.',
  },
  {
    base: 'mockingbird_search_server_about_v1',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Cached search-instance /about payloads.',
  },
  {
    base: 'mockingbird_instance_status_pages',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Discovered instance status pages.',
  },
  {
    base: 'mockingbird_api_metrics:',
    storage: 'local',
    suffix: 'instance',
    sensitivity: 'cache',
    note: 'Local API timing metrics and grouped client-error counts, one entry per instance. The trailing colon is part of the base — keys are `…metrics:<host>`.',
  },
  {
    base: 'mockingbird_api_metrics',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Superseded unscoped metrics blob, replaced by the per-instance keys above. Only ever deleted now; classified so lingering data is still recognised.',
  },
  {
    base: 'mockingbird_anonymous_home_feed',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Cached Anonymous home timeline. Derived from private follow data.',
  },
  {
    base: 'mockingbird_anonymous_feed_corpus',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Cached posts backing the Anonymous feed. Derived from private follow data.',
  },
  {
    base: 'mockingbird_raindrop_credentials',
    storage: 'local',
    suffix: 'account',
    sensitivity: 'secret',
    note: 'Legacy key from the superseded Raindrop OAuth flow. Only ever deleted now, never written; listed so it is classified if it lingers.',
  },

  // ---- sessionStorage: dies with the tab, never exported ----
  {
    base: 'mastodon_mock_oauth_app',
    storage: 'session',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'In-flight Mastodon OAuth attempt: client secret, PKCE verifier and state.',
  },
  {
    // Unscoped on purpose, unlike every other credential here. An LLM key
    // belongs to the human, not to a Mastodon persona: it is the same key
    // whether you are signed in as your main, your alt, or Anonymous, so
    // scoping it would only mean reconnecting once per identity. The knock-on
    // is that per-account data deletion (Signed-in accounts) does not remove
    // it — which is the intended behavior, and pinned by a spec.
    base: 'mockingbird_openrouter_key',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'OpenRouter API key from the PKCE flow. Can spend the user’s OpenRouter credits. Shared by every account in this browser.',
  },
  {
    base: 'mockingbird_openrouter_model',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'Chosen OpenRouter model id for the prompt helpers.',
  },
  {
    base: 'mockingbird_openrouter_prompts',
    storage: 'local',
    suffix: 'none',
    sensitivity: 'setting',
    note: 'User-edited prompt templates for the search and tag helpers. Only present for templates edited away from the shipped default.',
  },
  {
    base: 'mockingbird_openrouter_pkce_verifier',
    storage: 'session',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'PKCE verifier for the in-flight OpenRouter authorization.',
  },
  {
    // OpenRouter's authorize step takes no `state` parameter, so ours travels
    // inside callback_url. This is the copy we check the return against.
    base: 'mockingbird_openrouter_oauth_state',
    storage: 'session',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'Anti-CSRF state for the in-flight OpenRouter authorization.',
  },
  {
    base: 'mockingbird_dropbox_token',
    storage: 'session',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'Short-lived Dropbox online access token.',
  },
  {
    base: 'mockingbird_dropbox_pkce_verifier',
    storage: 'session',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'PKCE verifier for the in-flight Dropbox authorization.',
  },
  {
    base: 'mockingbird_dropbox_oauth_state',
    storage: 'session',
    suffix: 'none',
    sensitivity: 'secret',
    note: 'Anti-CSRF state for the in-flight Dropbox authorization.',
  },
  {
    base: 'mockingbird.update-recovery',
    storage: 'session',
    suffix: 'none',
    sensitivity: 'cache',
    note: 'Reload-attempt bookkeeping for post-deployment chunk recovery.',
  },
];

/** Which sensitivities each export profile includes. */
export const EXPORT_PROFILES = {
  /**
   * Safe to publish — a gist, a dotfiles repo, a link in a post. Preferences
   * only: nothing that names the user, the people they follow, what they read,
   * or anything they wrote.
   */
  shareable: ['setting'],
  /**
   * A personal backup for the user's own machines. Adds the private and
   * authored data. Still never includes a credential: connectors must be
   * re-authorized on the new machine, by design.
   */
  personal: ['setting', 'private', 'content'],
} as const satisfies Record<string, readonly Sensitivity[]>;

export type ExportProfile = keyof typeof EXPORT_PROFILES;

/** Look up a spec by its exact base. */
export function specForKey(base: string): StorageKeySpec | null {
  return STORAGE_KEYS.find((spec) => spec.base === base) ?? null;
}

/** Whether a concrete storage key (suffix and all) is described by `spec`. */
export function matchesKey(spec: StorageKeySpec, key: string): boolean {
  switch (spec.suffix) {
    case 'none':
      return key === spec.base;
    case 'account':
      // `base` alone is the logged-out scope; `base_<hash>` is a signed-in one.
      return key === spec.base || key.startsWith(`${spec.base}_`);
    case 'instance':
      return key.startsWith(spec.base);
  }
}

/**
 * Classify a concrete key as found in `localStorage`, suffix included.
 *
 * This is what an exporter must use when walking storage — never a bare `===`
 * against `base`, which silently misses every account- and instance-scoped key.
 * The longest matching base wins so that overlapping prefixes (for example
 * `mockingbird_anonymous_account` vs a hypothetical `mockingbird_anonymous_`)
 * resolve to the most specific entry.
 */
export function classifyStorageKey(key: string): StorageKeySpec | null {
  let best: StorageKeySpec | null = null;
  for (const spec of STORAGE_KEYS) {
    if (matchesKey(spec, key) && (best === null || spec.base.length > best.base.length)) {
      best = spec;
    }
  }
  return best;
}

/**
 * Whether a concrete storage key belongs in an export of this profile.
 *
 * Unregistered keys are refused — the safe default, and the reason the registry
 * is exhaustive: a key nobody classified must never reach a file the user
 * publishes just because someone forgot to think about it.
 */
export function isKeyExportable(key: string, profile: ExportProfile): boolean {
  const spec = classifyStorageKey(key);
  return (
    spec !== null &&
    spec.storage === 'local' &&
    (EXPORT_PROFILES[profile] as readonly Sensitivity[]).includes(spec.sensitivity)
  );
}

/**
 * Whether a key base may be written to an export of the given profile.
 *
 * Unregistered keys are refused. That is the safe default and the reason the
 * registry is exhaustive: a key nobody classified must never end up in a file
 * the user publishes just because someone forgot to think about it.
 */
export function isExportable(base: string, profile: ExportProfile): boolean {
  const spec = specForKey(base);
  return (
    spec !== null && (EXPORT_PROFILES[profile] as readonly Sensitivity[]).includes(spec.sensitivity)
  );
}

/** Every key base an export of this profile should collect. */
export function exportableKeys(profile: ExportProfile): StorageKeySpec[] {
  return STORAGE_KEYS.filter((spec) =>
    (EXPORT_PROFILES[profile] as readonly Sensitivity[]).includes(spec.sensitivity),
  );
}
