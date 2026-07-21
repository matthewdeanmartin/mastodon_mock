/**
 * Turns a `MawkingbirdSearch` into (a) the active-filter chips shown above
 * results (§10) and (b) the structured content of the Explain panel (§9).
 *
 * The central honesty rule (spec §23): every criterion is either sent to the
 * server (`origin: 'server'`) or applied to loaded results (`origin: 'loaded'`).
 * Which one a post criterion falls into depends on whether the viewer is
 * authenticated — anonymous post search can't send full-text operators, so
 * everything degrades to a loaded-result filter. This module is the single
 * place that classification lives, so the chips and the Explain panel never
 * disagree.
 */

import { MawkingbirdSearch, PostSearchCriteria } from './mawkingbird-search';
import { serializeMastodonQuery } from './mastodon-query-serializer';

export type ChipOrigin = 'server' | 'loaded';

export interface Chip {
  /** Field this chip represents, so removal can clear the right criterion. */
  key: string;
  label: string;
  origin: ChipOrigin;
}

/** Which post criteria the serializer can push to the server (authenticated only). */
const SERVER_POST_KEYS = new Set([
  'words',
  'exactPhrase',
  'excludeWords',
  'author',
  'after',
  'before',
  'language',
  'media',
  'poll',
  'replies',
  'sensitive',
  'scope',
]);

/**
 * Build the active chips for a post search. When `authenticated`, criteria the
 * serializer emits are `origin: 'server'`; the rest (and everything when
 * anonymous) are `origin: 'loaded'`.
 */
export function postChips(post: PostSearchCriteria, authenticated: boolean): Chip[] {
  const chips: Chip[] = [];
  const push = (key: string, label: string): void => {
    const isServerKey = authenticated && SERVER_POST_KEYS.has(key);
    chips.push({ key, label, origin: isServerKey ? 'server' : 'loaded' });
  };

  for (const w of (post.words ?? '').trim().split(/\s+/u).filter(Boolean)) {
    push('words', w);
  }
  if (post.exactPhrase?.trim()) {
    push('exactPhrase', `Exact: ${post.exactPhrase.trim()}`);
  }
  for (const w of (post.excludeWords ?? '').trim().split(/\s+/u).filter(Boolean)) {
    push('excludeWords', `Exclude: ${w}`);
  }
  if (post.author?.trim()) {
    push('author', `From ${post.author.trim()}`);
  }
  if (post.dates?.after) {
    push('after', `After ${post.dates.after}`);
  }
  if (post.dates?.before) {
    push('before', `Before ${post.dates.before}`);
  }
  if (post.language) {
    push('language', post.language.toUpperCase());
  }
  if (post.contentType && post.contentType !== 'any') {
    // Only `media`/`poll` are server-side; image/video/audio/text/link are always loaded.
    const serverBacked = post.contentType === 'media' || post.contentType === 'poll';
    push(serverBacked ? post.contentType : 'contentType', contentTypeLabel(post.contentType));
  }
  if (post.replies && post.replies !== 'include') {
    push('replies', post.replies === 'only' ? 'Replies only' : 'Exclude replies');
  }
  if (post.sensitive && post.sensitive !== 'include') {
    push('sensitive', post.sensitive === 'only' ? 'Sensitive only' : 'Exclude sensitive');
  }
  if (post.scope && post.scope !== 'all') {
    push('scope', post.scope === 'public' ? 'Public' : 'My library');
  }
  return chips;
}

function contentTypeLabel(t: NonNullable<PostSearchCriteria['contentType']>): string {
  switch (t) {
    case 'media':
      return 'Has media';
    case 'image':
      return 'Images only';
    case 'video':
      return 'Video only';
    case 'audio':
      return 'Audio only';
    case 'poll':
      return 'Polls only';
    case 'link':
      return 'Links only';
    case 'text':
      return 'Text only';
    case 'any':
      return 'Any';
  }
}

export interface ExplainApiUsage {
  maximum: number;
  used: number;
  /** Statuses/tags the budget forced us to drop from an anonymous fan-out (§7). */
  tagsDropped: number;
}

export interface ExplainPanel {
  endpoint: string;
  /** The serialized Mastodon query (authenticated only); empty string otherwise. */
  mastodonQuery: string;
  serverCriteria: string[];
  loadedCriteria: string[];
  /** Non-null only in anonymous post search: the hashtags the words became. */
  anonymousTags: string[] | null;
  apiUsage: ExplainApiUsage;
}

/**
 * Build the §9 Explain content for a post search. `anonymousTags` is the tag
 * list `searchPostsByHashtags` derived (surfaced via `SearchResults.hashtags`);
 * pass it for anonymous searches so the panel can show the transformation.
 */
export function explainPostSearch(
  search: MawkingbirdSearch,
  authenticated: boolean,
  anonymousTags: string[] | null,
  apiUsage: ExplainApiUsage = { maximum: search.apiCallBudget, used: 0, tagsDropped: 0 },
): ExplainPanel {
  const post = search.post ?? {};
  const chips = postChips(post, authenticated);
  const serverCriteria = chips.filter((c) => c.origin === 'server').map((c) => c.label);
  const loadedCriteria = chips.filter((c) => c.origin === 'loaded').map((c) => c.label);

  return {
    endpoint: authenticated
      ? 'GET /api/v2/search'
      : 'GET /api/v1/timelines/tag/{hashtag} (one per hashtag)',
    mastodonQuery: authenticated ? serializeMastodonQuery(post) : '',
    serverCriteria,
    loadedCriteria,
    anonymousTags: authenticated ? null : anonymousTags,
    apiUsage,
  };
}
