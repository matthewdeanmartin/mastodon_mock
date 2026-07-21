/**
 * Pure client-side sorting over search results we've *already* fetched. Like
 * `search-refine.ts` and `account-refine.ts`, none of this makes an API call —
 * it only ever reorders the statuses/accounts already in memory. A sort of
 * loaded results, not a new search.
 *
 * Sorts are stable: ties preserve the incoming (server-returned) order, so
 * flipping back to "Relevance" and the ties within any other sort both feel
 * predictable. The default option for each result type is 'relevance', which is
 * a no-op that hands back the server's order untouched.
 */

import { Account, Status } from '../../models';
import { AccountWithMatches } from './account-refine';

export type StatusSortKey =
  | 'relevance'
  | 'newest'
  | 'oldest'
  | 'favourites'
  | 'reblogs'
  | 'replies';

export type AccountSortKey =
  | 'relevance'
  | 'followers'
  | 'following'
  | 'posts'
  | 'name'
  | 'matches';

export interface SortOption<K extends string> {
  value: K;
  label: string;
}

/** Sort choices for the posts result list (order = display order in the bar). */
export const STATUS_SORTS: SortOption<StatusSortKey>[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'favourites', label: 'Most favourited' },
  { value: 'reblogs', label: 'Most boosted' },
  { value: 'replies', label: 'Most replies' },
];

/** Sort choices for the account result list. */
export const ACCOUNT_SORTS: SortOption<AccountSortKey>[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'followers', label: 'Most followers' },
  { value: 'following', label: 'Most following' },
  { value: 'posts', label: 'Most posts' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'matches', label: 'Most matching posts' },
];

/** Stable sort by a numeric key extractor, descending (bigger first). */
function byDesc<T>(items: T[], key: (t: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => key(b.item) - key(a.item) || a.i - b.i)
    .map((x) => x.item);
}

/**
 * The `created_at` used to order a status. Reblogs float on the booster's
 * timeline, but the interesting date is when the underlying post was made — so
 * date sorts follow through the reblog when present (matching the card's clock).
 */
function statusTime(s: Status): number {
  const src = s.reblog ?? s;
  return new Date(src.created_at).getTime() || 0;
}

/** Reorder loaded statuses by the chosen key. 'relevance' returns them as-is. */
export function sortStatuses(statuses: Status[], key: StatusSortKey): Status[] {
  switch (key) {
    case 'relevance':
      return statuses;
    case 'newest':
      return byDesc(statuses, statusTime);
    case 'oldest':
      return byDesc(statuses, (s) => -statusTime(s));
    case 'favourites':
      return byDesc(statuses, (s) => (s.reblog ?? s).favourites_count);
    case 'reblogs':
      return byDesc(statuses, (s) => (s.reblog ?? s).reblogs_count);
    case 'replies':
      return byDesc(statuses, (s) => (s.reblog ?? s).replies_count);
  }
}

/** Reorder loaded accounts by the chosen key. 'relevance' returns them as-is. */
export function sortAccounts(items: AccountWithMatches[], key: AccountSortKey): AccountWithMatches[] {
  switch (key) {
    case 'relevance':
      return items;
    case 'followers':
      return byDesc(items, (i) => i.account.followers_count);
    case 'following':
      return byDesc(items, (i) => i.account.following_count);
    case 'posts':
      return byDesc(items, (i) => i.account.statuses_count);
    case 'matches':
      return byDesc(items, (i) => i.matchingPosts.length);
    case 'name': {
      const label = (a: Account) => (a.display_name?.trim() || a.acct || '').toLowerCase();
      return items
        .map((item, i) => ({ item, i }))
        .sort((a, b) => label(a.item.account).localeCompare(label(b.item.account)) || a.i - b.i)
        .map((x) => x.item);
    }
  }
}
