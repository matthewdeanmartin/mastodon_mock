import { Injectable } from '@angular/core';
import { Relationship } from '../../models';
import { AccountSearchCriteria } from './mawkingbird-search';
import { AccountFacetKind, AccountWithMatches } from './account-refine';

/**
 * A snapshot of a completed account search, held in memory so returning to the
 * search page (e.g. after clicking into a profile and hitting Back) restores the
 * whole result set — cards, relationships, refinements, and scroll position —
 * instead of dropping you back on an empty box. Building the set can cost many
 * queries (the posts→authors fan-out especially); losing it to a navigation is
 * exactly the frustration this avoids.
 *
 * This is deliberately in-memory only: it survives SPA navigation, not a hard
 * reload. A reload re-runs the search from the URL, which is the correct
 * behaviour for a fresh session.
 */
export interface AccountSearchSnapshot {
  /** The executed query text and type, used to confirm the restore still matches. */
  query: string;
  /** The raw merged result set (bio hits + post authors). */
  items: AccountWithMatches[];
  /** Relationship per account id at snapshot time. */
  relationships: Record<string, Relationship>;
  /** Expanded card ids. */
  expanded: string[];
  /** Selected facet values. */
  facets: { kind: AccountFacetKind; value: string }[];
  /** The loaded-result text filter. */
  filter: string;
  /** The numeric bounds the results were gated by. */
  bounds: AccountSearchCriteria;
  /** API calls the search spent (for the honesty line). */
  callsUsed: number;
  /** Vertical scroll offset of the results container. */
  scrollTop: number;
}

@Injectable({ providedIn: 'root' })
export class AccountSearchStore {
  private snapshot: AccountSearchSnapshot | null = null;

  save(snapshot: AccountSearchSnapshot): void {
    this.snapshot = snapshot;
  }

  /** The stored snapshot if it matches `query`, else null. Non-consuming — the
   *  caller decides whether to clear after restoring. */
  take(query: string): AccountSearchSnapshot | null {
    if (this.snapshot && this.snapshot.query === query) {
      return this.snapshot;
    }
    return null;
  }

  clear(): void {
    this.snapshot = null;
  }
}
