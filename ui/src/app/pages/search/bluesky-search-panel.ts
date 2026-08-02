import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { PageDiagnostics } from '../../page-diagnostics';
import { BlueskySearch } from '../../providers/bluesky/bluesky-search';
import { BlueskySession } from '../../providers/bluesky/bluesky-session';
import {
  BlueskyPostSearch,
  describeBlueskyFilters,
  emptyBlueskyPostSearch,
  hasBlueskyFilters,
  parseTags,
} from '../../providers/bluesky/bluesky-post-search';
import { filterLoaded, buildFacets, statusMatchesFacet, FacetKind } from './search-refine';
import { sortStatuses, STATUS_SORTS, StatusSortKey } from './search-sort';

/**
 * Bluesky post search: its own query form, its own results.
 *
 * A separate component rather than a branch inside `Search` — the two engines
 * take genuinely different filters (see `bluesky-post-search.ts`), and threading
 * a source flag through a 1,700-line component would put a check in front of
 * every widget. What *is* shared is everything that operates on results once
 * they exist: `StatusCard`, `filterLoaded`, `buildFacets`, `sortStatuses`. Those
 * are pure functions over `Status[]` and do not care where the posts came from.
 */
@Component({
  selector: 'app-bluesky-search-panel',
  imports: [FormsModule, RouterLink, StatusCard],
  templateUrl: './bluesky-search-panel.html',
  styleUrl: './bluesky-search-panel.css',
})
export class BlueskySearchPanel {
  private search = inject(BlueskySearch);
  private diagnostics = inject(PageDiagnostics);
  protected session = inject(BlueskySession);

  protected criteria = signal<BlueskyPostSearch>(emptyBlueskyPostSearch());
  /** Tag input is free text; parsed into the AND-matched list on search. */
  protected tagInput = signal('');
  protected advancedOpen = signal(false);

  protected statuses = signal<Status[]>([]);
  protected searching = signal(false);
  protected loadingMore = signal(false);
  protected error = signal<string | null>(null);
  protected ran = signal(false);
  protected hitsTotal = signal<number | null>(null);
  private cursor: string | null = null;

  // Client-side refinement over what is already loaded. Identical in behaviour
  // to the Mastodon side because it is literally the same functions.
  protected loadedFilter = signal('');
  protected statusSort = signal<StatusSortKey>('relevance');
  protected selectedFacets = signal<{ kind: FacetKind; value: string }[]>([]);
  protected readonly statusSorts = STATUS_SORTS;

  protected exhausted = computed(() => this.ran() && !this.cursor);

  protected facets = computed(() => buildFacets(this.statuses()));

  protected activeFilters = computed(() => describeBlueskyFilters(this.criteria()));
  protected hasFilters = computed(() => hasBlueskyFilters(this.criteria()));

  /** The loaded posts after the text filter, facet selections and sort. */
  protected visible = computed(() => {
    const selected = this.selectedFacets();
    const matching = this.statuses().filter((status) =>
      selected.every(({ kind, value }) => statusMatchesFacet(status, kind, value)),
    );
    return sortStatuses(filterLoaded(matching, this.loadedFilter()), this.statusSort());
  });

  /** Patch a field of the criteria object without replacing the rest. */
  protected set<K extends keyof BlueskyPostSearch>(key: K, value: BlueskyPostSearch[K]): void {
    this.criteria.update((current) => ({ ...current, [key]: value }));
  }

  protected setText(value: string): void {
    this.set('text', value);
  }

  protected toggleFacet(kind: FacetKind, value: string): void {
    this.selectedFacets.update((current) => {
      const hit = current.find((f) => f.kind === kind && f.value === value);
      return hit
        ? current.filter((f) => f !== hit)
        : [...current.filter((f) => f.kind !== kind), { kind, value }];
    });
  }

  protected isFacetSelected(kind: FacetKind, value: string): boolean {
    return this.selectedFacets().some((f) => f.kind === kind && f.value === value);
  }

  protected clearRefinements(): void {
    this.selectedFacets.set([]);
    this.loadedFilter.set('');
  }

  reset(): void {
    this.criteria.set(emptyBlueskyPostSearch());
    this.tagInput.set('');
    this.statuses.set([]);
    this.clearRefinements();
    this.ran.set(false);
    this.error.set(null);
    this.hitsTotal.set(null);
    this.cursor = null;
  }

  run(): void {
    const text = this.criteria().text.trim();
    if (!text || this.searching()) {
      return;
    }
    // Tags are only read at search time, so typing in the box does not silently
    // change what the "active filters" line claims about the last search.
    this.set('tags', parseTags(this.tagInput()));
    this.statuses.set([]);
    this.clearRefinements();
    this.cursor = null;
    this.searching.set(true);
    this.error.set(null);
    this.fetch();
  }

  loadMore(): void {
    if (!this.cursor || this.loadingMore() || this.searching()) {
      return;
    }
    this.loadingMore.set(true);
    this.fetch();
  }

  private fetch(): void {
    const criteria = this.criteria();
    this.search.search(criteria, this.cursor).subscribe({
      next: (page) => {
        this.cursor = page.cursor;
        // Dedupe: a shifting index can repeat a post across pages.
        const seen = new Set(this.statuses().map((s) => s.id));
        this.statuses.update((list) => [...list, ...page.statuses.filter((s) => !seen.has(s.id))]);
        this.hitsTotal.set(page.hitsTotal ?? null);
        this.searching.set(false);
        this.loadingMore.set(false);
        this.ran.set(true);
        this.diagnostics.info('Search', 'load:bsky-posts', {
          results: page.statuses.length,
          more: !!page.cursor,
        });
      },
      error: (error: unknown) => {
        this.searching.set(false);
        this.loadingMore.set(false);
        this.ran.set(true);
        this.cursor = null;
        this.diagnostics.error('Search', 'load:bsky-posts-error', error);
        this.error.set(error instanceof Error ? error.message : 'Bluesky search failed.');
      },
    });
  }
}
