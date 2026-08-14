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

import { Account, Relationship, Status } from '../../models';
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

export type AccountFacetKind = 'domain' | 'bot' | 'locked' | 'followers' | 'statuses' | 'activity';

export interface AccountFacet {
  kind: AccountFacetKind;
  label: string;
  values: AccountFacetValue[];
  /**
   * How many values to show before truncating.
   *
   * The UI caps facet rows at 5 because an open-ended facet like `domain` can
   * have dozens of values and the top few are the useful ones. That reasoning
   * doesn't hold for a fixed ladder: the "Last active" bins are a bounded,
   * ordered set where the stale end is the half people are usually hunting for,
   * and truncating to 5 would silently hide "over 2 years ago". Facets that want
   * all their rows say so here.
   */
  showAll?: boolean;
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

// ---------------------------------------------------------------------------
// Last-activity bins
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * One last-activity bin: everyone whose most recent post is younger than
 * `withinDays`, and who didn't fit a finer bin above it.
 *
 * Deliberately a fixed ladder rather than a computed one. Quantile bins would
 * adapt perfectly to any corpus and produce labels nobody can act on ("3–17
 * days"), and the whole point of this facet is that "this month" and "over a
 * year ago" are the units people actually think in. Adaptivity comes from
 * dropping the empty bins instead (see {@link activityBins}), which handles the
 * "everything is from this year" case without a binning algorithm to tune.
 *
 * `withinDays: Infinity` is the catch-all tail.
 */
interface ActivityBin {
  key: string;
  label: string;
  withinDays: number;
}

/** The ladder, finest first. Boundaries are the ones humans name. */
const ACTIVITY_BINS: readonly ActivityBin[] = [
  { key: 'd1', label: 'Today', withinDays: 1 },
  { key: 'd7', label: 'This week', withinDays: 7 },
  { key: 'd30', label: 'This month', withinDays: 30 },
  { key: 'd90', label: 'Last 3 months', withinDays: 90 },
  { key: 'd180', label: 'Last 6 months', withinDays: 180 },
  { key: 'd365', label: 'Last year', withinDays: 365 },
  { key: 'd730', label: '1 – 2 years ago', withinDays: 730 },
  { key: 'older', label: 'Over 2 years ago', withinDays: Infinity },
];

/**
 * The bin for accounts whose last post date the server never supplied.
 *
 * A real bin rather than a silent exclusion: results merged in from thinner
 * providers genuinely lack `last_status_at` (the page offers a "check activity"
 * action for exactly this), and dropping them would make the facet counts
 * quietly disagree with the result count. It sorts last, after the tail.
 */
const UNKNOWN_ACTIVITY: ActivityBin = { key: 'unknown', label: 'Not known', withinDays: Infinity };

/**
 * Days since this account last posted, or null when it can't be known.
 *
 * `last_status_at` is a plain date ("2026-08-07") on some servers and a full
 * timestamp on others; `Date.parse` reads both. A null/absent value means the
 * account has never posted *or* the server didn't say — indistinguishable here,
 * so both land in {@link UNKNOWN_ACTIVITY}.
 */
function daysSinceActivity(account: Account, now: number): number | null {
  const last = account.last_status_at;
  if (!last) {
    return null;
  }
  const parsed = Date.parse(last);
  if (Number.isNaN(parsed)) {
    return null;
  }
  // Clamp: a server clock running ahead shouldn't push someone out of "Today".
  return Math.max(0, (now - parsed) / DAY_MS);
}

/** Which bin an account falls in. Exported for {@link accountMatchesFacet}. */
function activityBinFor(account: Account, now: number): ActivityBin {
  const days = daysSinceActivity(account, now);
  if (days === null) {
    return UNKNOWN_ACTIVITY;
  }
  return ACTIVITY_BINS.find((b) => days < b.withinDays) ?? ACTIVITY_BINS[ACTIVITY_BINS.length - 1];
}

/**
 * The occupied bins, in ladder order, with counts.
 *
 * Empty bins are dropped, which is what makes a fixed ladder behave well on a
 * narrow corpus: a set of results that are all from the last fortnight shows
 * "Today / This week / This month" and nothing else, rather than eight rows of
 * which five read zero. A corpus spanning years shows the whole ladder. Either
 * way the facet lands in the 3–9 row range without deciding anything at runtime.
 */
function activityBins(accounts: Account[], now: number): AccountFacetValue[] {
  const counts = new Map<string, number>();
  for (const a of accounts) {
    const bin = activityBinFor(a, now);
    counts.set(bin.key, (counts.get(bin.key) ?? 0) + 1);
  }
  return [...ACTIVITY_BINS, UNKNOWN_ACTIVITY]
    .filter((b) => counts.has(b.key))
    .map((b) => ({ value: b.key, label: b.label, count: counts.get(b.key)! }));
}

/**
 * Categorical/bucketed facets derived *only* from the loaded accounts. Counts
 * mean "loaded accounts matching this value" — never total server counts. Facets
 * with a single value don't discriminate and are omitted (like `buildFacets`).
 * The numeric min/max inputs are the precise tool; these buckets are the quick
 * clickable one.
 */
export function buildAccountFacets(accounts: Account[], now: number = Date.now()): AccountFacet[] {
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

  // Last activity keeps ladder order (recent → stale) rather than count order:
  // the rows are a timeline, and sorting them by popularity would scramble it.
  const activity = activityBins(accounts, now);
  if (activity.length > 1) {
    facets.push({ kind: 'activity', label: 'Last active', values: activity, showAll: true });
  }

  return facets;
}

/** The follow-state filter over account results: everyone, or one side of it. */
export type FollowFilter = 'all' | 'following' | 'not-following';

/**
 * Split loaded accounts by whether the viewer already follows them.
 *
 * Unlike the facets above, this reads a `Relationship` rather than the account,
 * because follow state is the viewer's, not the account's. A relationship that
 * hasn't loaded yet counts as *not* following: it matches what the card shows
 * (its follow button reads "Follow" until proven otherwise), so the filtered
 * list never contradicts the buttons in it. A pending follow request counts as
 * following — the intent is recorded, and it stops the account resurfacing in
 * "not following" as something still to do.
 */
export function filterByFollowState(
  items: AccountWithMatches[],
  relationships: Record<string, Relationship>,
  filter: FollowFilter,
): AccountWithMatches[] {
  if (filter === 'all') {
    return items;
  }
  return items.filter((item) => {
    const rel = relationships[item.account.id];
    const followed = !!rel?.following || !!rel?.requested;
    return filter === 'following' ? followed : !followed;
  });
}

/**
 * Does an account match a chosen facet value? Mirrors `buildAccountFacets`.
 *
 * `now` is passed through to the activity bins so a selection is evaluated
 * against the same clock that produced the counts. It defaults to the current
 * time; a filtering pass that straddles midnight could in principle move one
 * account between "Today" and "This week", which is correct behaviour rather
 * than a bug — the bin is relative to now by definition.
 */
export function accountMatchesFacet(
  a: Account,
  kind: AccountFacetKind,
  value: string,
  now: number = Date.now(),
): boolean {
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
    case 'activity':
      return activityBinFor(a, now).key === value;
  }
}
