/**
 * Pure client-side refinement over account results we've *already* fetched — the
 * account-search analogue of `search-refine.ts`. None of this makes an API call:
 * it narrows/reshapes a loaded `Account[]` in memory.
 *
 * Two things account refinement has that post refinement does not:
 *  - numeric gates (followers / following / statuses ranges), the "filter in/out
 *    celebrities vs dead accounts vs real people" tool;
 *  - post→author condensation, which turns a topic post search into a list of the
 *    distinct accounts that posted about it, each carrying the posts that matched.
 *
 * The search page component stays thin by delegating here, and these functions
 * carry the test coverage.
 */

import { Account, Status } from '../../models';
import { NumericRange } from './mawkingbird-search';
import { acctDomain, plainText } from './search-refine';

/** An account paired with the statuses that made it surface (topic mode). Empty
 *  `matchingPosts` for accounts found via the plain account endpoint. */
export interface AccountWithMatches {
  account: Account;
  matchingPosts: Status[];
}

/** The three numeric gates, applied together (AND). Unset ranges pass everything. */
export interface AccountNumericBounds {
  followers?: NumericRange;
  following?: NumericRange;
  statuses?: NumericRange;
}

/** Does `value` fall within [min, max]? Either bound may be undefined (open). */
export function inRange(value: number, range: NumericRange | undefined): boolean {
  if (!range) {
    return true;
  }
  if (range.min != null && value < range.min) {
    return false;
  }
  if (range.max != null && value > range.max) {
    return false;
  }
  return true;
}

/** True when every set numeric gate accepts this account. */
export function accountMatchesNumeric(account: Account, bounds: AccountNumericBounds): boolean {
  return (
    inRange(account.followers_count, bounds.followers) &&
    inRange(account.following_count, bounds.following) &&
    inRange(account.statuses_count, bounds.statuses)
  );
}

/**
 * Filter loaded accounts by a substring typed into "Filter these results".
 * Matches display name, handle, and bio (note) text. Case-insensitive; an empty
 * filter returns everything. Mirrors `filterLoaded` for statuses.
 */
export function filterAccounts(accounts: Account[], text: string): Account[] {
  const needle = text.trim().toLowerCase();
  if (!needle) {
    return accounts;
  }
  return accounts.filter((a) => {
    const haystack = [a.display_name ?? '', a.acct ?? '', plainText(a.note ?? '')]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Condense a flat list of statuses down to their distinct authors, deduped by
 * account id and preserving first-seen order. Each returned author carries every
 * matching post, in the order they appeared. This is the "posts → people" pass:
 * we don't care much *what* they said about pycharm, only that they did, which
 * makes them an account worth following.
 *
 * Boosts are attributed to the booster's timeline author (the status' own
 * `account`), matching what the search actually returned.
 */
export function condenseStatusesToAuthors(statuses: Status[]): AccountWithMatches[] {
  const order: string[] = [];
  const byId = new Map<string, AccountWithMatches>();
  for (const s of statuses) {
    const acc = s.account;
    if (!acc?.id) {
      continue;
    }
    let entry = byId.get(acc.id);
    if (!entry) {
      entry = { account: acc, matchingPosts: [] };
      byId.set(acc.id, entry);
      order.push(acc.id);
    }
    entry.matchingPosts.push(s);
  }
  return order.map((id) => byId.get(id)!);
}

/**
 * Merge two author lists (typically the account-endpoint hits and the
 * post-condensation hits) into one, deduped by account id and preserving
 * first-seen order across both inputs. When the same account appears in both,
 * the first-seen account object wins and their matching posts are concatenated.
 */
export function mergeAuthors(
  primary: AccountWithMatches[],
  secondary: AccountWithMatches[],
): AccountWithMatches[] {
  const order: string[] = [];
  const byId = new Map<string, AccountWithMatches>();
  for (const item of [...primary, ...secondary]) {
    const id = item.account.id;
    const existing = byId.get(id);
    if (existing) {
      existing.matchingPosts = [...existing.matchingPosts, ...item.matchingPosts];
    } else {
      byId.set(id, { account: item.account, matchingPosts: [...item.matchingPosts] });
      order.push(id);
    }
  }
  return order.map((id) => byId.get(id)!);
}

export interface AccountFacetValue {
  value: string;
  label: string;
  count: number;
}

export type AccountFacetKind = 'domain' | 'bot' | 'locked' | 'followers' | 'statuses';

export interface AccountFacet {
  kind: AccountFacetKind;
  label: string;
  values: AccountFacetValue[];
}

/** Count bucket for a follower/post total. Keys are stable; labels are shown. */
interface Bucket {
  key: string;
  label: string;
  test: (n: number) => boolean;
}

const COUNT_BUCKETS: Bucket[] = [
  { key: '0-99', label: '< 100', test: (n) => n < 100 },
  { key: '100-999', label: '100 – 1k', test: (n) => n >= 100 && n < 1_000 },
  { key: '1000-9999', label: '1k – 10k', test: (n) => n >= 1_000 && n < 10_000 },
  { key: '10000+', label: '10k+', test: (n) => n >= 10_000 },
];

function bucketFor(n: number): Bucket {
  return COUNT_BUCKETS.find((b) => b.test(n)) ?? COUNT_BUCKETS[COUNT_BUCKETS.length - 1];
}

/**
 * Categorical/bucketed facets derived *only* from the loaded accounts. Counts
 * mean "loaded accounts matching this value" — never total server counts. Facets
 * with a single value don't discriminate and are omitted (like `buildFacets`).
 * The numeric min/max inputs are the precise tool; these buckets are the quick
 * clickable one.
 */
export function buildAccountFacets(accounts: Account[]): AccountFacet[] {
  if (!accounts.length) {
    return [];
  }

  const facets: AccountFacet[] = [];

  const tally = (
    kind: AccountFacetKind,
    label: string,
    pick: (a: Account) => { value: string; label: string } | null,
  ): void => {
    const counts = new Map<string, AccountFacetValue>();
    for (const a of accounts) {
      const hit = pick(a);
      if (!hit || !hit.value) {
        continue;
      }
      const existing = counts.get(hit.value);
      if (existing) {
        existing.count++;
      } else {
        counts.set(hit.value, { value: hit.value, label: hit.label, count: 1 });
      }
    }
    const values = [...counts.values()].sort((a, b) => b.count - a.count);
    if (values.length > 1) {
      facets.push({ kind, label, values });
    }
  };

  // Count buckets keep their natural order (small → large), not count order.
  const bucketFacet = (
    kind: AccountFacetKind,
    label: string,
    pick: (a: Account) => number,
  ): void => {
    const counts = new Map<string, number>();
    for (const a of accounts) {
      const b = bucketFor(pick(a));
      counts.set(b.key, (counts.get(b.key) ?? 0) + 1);
    }
    const values: AccountFacetValue[] = COUNT_BUCKETS.filter((b) => counts.has(b.key)).map((b) => ({
      value: b.key,
      label: b.label,
      count: counts.get(b.key)!,
    }));
    if (values.length > 1) {
      facets.push({ kind, label, values });
    }
  };

  tally('domain', 'Author domain', (a) => {
    const d = acctDomain(a.acct);
    return d ? { value: d, label: d } : { value: 'local', label: 'This server' };
  });
  tally('bot', 'Account type', (a) =>
    a.bot ? { value: 'bot', label: 'Bots' } : { value: 'human', label: 'People' },
  );
  tally('locked', 'Follow policy', (a) =>
    a.locked ? { value: 'locked', label: 'Requires approval' } : { value: 'open', label: 'Open' },
  );
  bucketFacet('followers', 'Followers', (a) => a.followers_count);
  bucketFacet('statuses', 'Posts', (a) => a.statuses_count);

  return facets;
}

/** Does an account match a chosen facet value? Mirrors `buildAccountFacets`. */
export function accountMatchesFacet(a: Account, kind: AccountFacetKind, value: string): boolean {
  switch (kind) {
    case 'domain':
      return (acctDomain(a.acct) || 'local') === value;
    case 'bot':
      return value === 'bot' ? !!a.bot : !a.bot;
    case 'locked':
      return value === 'locked' ? !!a.locked : !a.locked;
    case 'followers':
      return bucketFor(a.followers_count).key === value;
    case 'statuses':
      return bucketFor(a.statuses_count).key === value;
  }
}
