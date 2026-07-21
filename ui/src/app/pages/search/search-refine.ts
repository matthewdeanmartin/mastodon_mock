/**
 * Pure client-side refinement over search results we've *already* fetched:
 * loaded-result text filter (§12), facets (§11), grouping (§13), and active
 * chips (§10). None of this makes an API call — it only ever narrows/reshapes
 * the statuses already in memory. The search page component stays thin by
 * delegating here, and these functions carry the test coverage.
 *
 * See `spec/search/better_search.md`.
 */

import { Status } from '../../models';

/** Strip HTML tags to plain text for substring matching / filtering. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The domain portion of an `acct` (`user@host` → `host`; local `user` → ''). */
export function acctDomain(acct: string): string {
  const at = acct.indexOf('@');
  return at === -1 ? '' : acct.slice(at + 1).toLowerCase();
}

/**
 * §12: filter loaded statuses by a substring typed into "Filter these results".
 * Matches rendered post text, content-warning text, and author name/handle.
 * Case-insensitive; empty filter returns everything.
 */
export function filterLoaded(statuses: Status[], text: string): Status[] {
  const needle = text.trim().toLowerCase();
  if (!needle) {
    return statuses;
  }
  return statuses.filter((s) => {
    const haystack = [
      plainText(s.content),
      s.spoiler_text ?? '',
      s.account.display_name ?? '',
      s.account.acct ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export interface FacetValue {
  /** Stable key used for selection/matching (e.g. a language code or domain). */
  value: string;
  /** Human label shown in the UI. */
  label: string;
  /** Number of currently-loaded results matching this value. */
  count: number;
}

export type FacetKind = 'language' | 'author' | 'media' | 'replies' | 'sensitive' | 'domain';

export interface Facet {
  kind: FacetKind;
  label: string;
  values: FacetValue[];
}

/** Media bucket for a status: its first attachment's type, else 'none'. */
function mediaKind(s: Status): string {
  const first = s.media_attachments?.[0];
  return first ? first.type : 'none';
}

/**
 * §11: facets derived *only* from the loaded results. Counts mean "loaded
 * results matching this value" — never total server counts. Values are sorted
 * by descending count; facets with no useful variation (a single value) are
 * omitted. Callers apply the §11.2 "show at most 5" cap in the UI.
 */
export function buildFacets(statuses: Status[]): Facet[] {
  if (!statuses.length) {
    return [];
  }

  const facets: Facet[] = [];

  const tally = (
    kind: FacetKind,
    label: string,
    pick: (s: Status) => { value: string; label: string } | null,
  ): void => {
    const counts = new Map<string, FacetValue>();
    for (const s of statuses) {
      const hit = pick(s);
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
    // Omit facets that don't discriminate (§11.2).
    if (values.length > 1) {
      facets.push({ kind, label, values });
    }
  };

  tally('language', 'Language', (s) =>
    s.language ? { value: s.language, label: s.language.toUpperCase() } : null,
  );
  tally('author', 'Author', (s) => ({
    value: s.account.acct,
    label: s.account.display_name || s.account.acct,
  }));
  tally('media', 'Media', (s) => {
    const k = mediaKind(s);
    return { value: k, label: k === 'none' ? 'Text only' : k[0].toUpperCase() + k.slice(1) };
  });
  tally('replies', 'Type', (s) =>
    s.in_reply_to_id
      ? { value: 'reply', label: 'Replies' }
      : { value: 'original', label: 'Original posts' },
  );
  tally('sensitive', 'Sensitive', (s) =>
    s.sensitive ? { value: 'yes', label: 'Sensitive' } : { value: 'no', label: 'Not sensitive' },
  );
  tally('domain', 'Author domain', (s) => {
    const d = acctDomain(s.account.acct);
    return d ? { value: d, label: d } : { value: 'local', label: 'This server' };
  });

  return facets;
}

/** Does a status match a chosen facet value? Mirrors `buildFacets`'s buckets. */
export function statusMatchesFacet(s: Status, kind: FacetKind, value: string): boolean {
  switch (kind) {
    case 'language':
      return s.language === value;
    case 'author':
      return s.account.acct === value;
    case 'media':
      return mediaKind(s) === value;
    case 'replies':
      return value === 'reply' ? !!s.in_reply_to_id : !s.in_reply_to_id;
    case 'sensitive':
      return value === 'yes' ? s.sensitive : !s.sensitive;
    case 'domain':
      return (acctDomain(s.account.acct) || 'local') === value;
  }
}

export interface StatusGroup {
  key: string;
  label: string;
  statuses: Status[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local-calendar day label for the date grouping (§13.3). */
function dateBucket(created: string, now: number): { key: string; label: string; order: number } {
  const then = new Date(created);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((startOfToday.getTime() - then.getTime()) / DAY_MS);
  if (then.getTime() >= startOfToday.getTime()) {
    return { key: 'today', label: 'Today', order: 0 };
  }
  if (diffDays < 1) {
    return { key: 'yesterday', label: 'Yesterday', order: 1 };
  }
  if (diffDays < 7) {
    const label = then.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    // Order by recency within the week; older = higher order number.
    return { key: label, label, order: 2 + diffDays };
  }
  return { key: 'earlier', label: 'Earlier', order: 1000 };
}

/**
 * §13: reshape (never re-fetch) the loaded statuses. `none` preserves the
 * server's returned order; `author` groups under account headers preserving
 * order within each; `date` buckets by local calendar day.
 */
export function groupResults(
  statuses: Status[],
  grouping: 'none' | 'author' | 'date',
  now: number = Date.now(),
): StatusGroup[] {
  if (grouping === 'none' || !statuses.length) {
    return [{ key: 'all', label: '', statuses }];
  }

  if (grouping === 'author') {
    const groups: StatusGroup[] = [];
    const index = new Map<string, StatusGroup>();
    for (const s of statuses) {
      const key = s.account.acct;
      let g = index.get(key);
      if (!g) {
        g = { key, label: s.account.display_name || s.account.acct, statuses: [] };
        index.set(key, g);
        groups.push(g); // first-seen author order
      }
      g.statuses.push(s);
    }
    return groups;
  }

  // date
  const buckets = new Map<string, StatusGroup & { order: number }>();
  for (const s of statuses) {
    const b = dateBucket(s.created_at, now);
    let g = buckets.get(b.key);
    if (!g) {
      g = { key: b.key, label: b.label, order: b.order, statuses: [] };
      buckets.set(b.key, g);
    }
    g.statuses.push(s);
  }
  return [...buckets.values()].sort((a, b) => a.order - b.order);
}
