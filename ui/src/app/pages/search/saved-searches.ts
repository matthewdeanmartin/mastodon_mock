import { computed, Injectable, signal } from '@angular/core';
import { scopedKey } from '../../account-scope';
import { MawkingbirdSearch } from './mawkingbird-search';

const STORAGE_KEY_BASE = 'mockingbird_saved_searches';
const STATE_VERSION = 1;
/** Cap on saved searches — localStorage is shared with other features (§15). */
export const SAVED_SEARCH_LIMIT = 20;

/** A saved search stores the structured definition only — never results, post
 *  bodies, or facet caches (§15). */
export interface SavedSearch {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  instance: string;
  authenticated: boolean;
  search: MawkingbirdSearch;
}

interface SavedSearchState {
  version: typeof STATE_VERSION;
  searches: SavedSearch[];
}

function load(): SavedSearchState {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(scopedKey(STORAGE_KEY_BASE)) ?? 'null',
    ) as Partial<SavedSearchState> | null;
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.searches)) {
      return { version: STATE_VERSION, searches: [] };
    }
    // Keep only well-formed entries, newest-first, capped.
    const searches = parsed.searches
      .filter((s): s is SavedSearch => !!s && typeof s.id === 'string' && !!s.search)
      .slice(0, SAVED_SEARCH_LIMIT);
    return { version: STATE_VERSION, searches };
  } catch {
    return { version: STATE_VERSION, searches: [] };
  }
}

/** Browser-local saved search definitions, scoped per account (see {@link scopedKey}). */
@Injectable({ providedIn: 'root' })
export class SavedSearches {
  private state = signal(load());

  readonly all = computed(() => this.state().searches);
  readonly count = computed(() => this.all().length);
  readonly atLimit = computed(() => this.count() >= SAVED_SEARCH_LIMIT);

  /** Save a new search under `name`. Returns the created entry, or an error when
   *  the per-account cap is reached. */
  save(
    name: string,
    search: MawkingbirdSearch,
    context: { instance: string; authenticated: boolean },
  ): { ok: true; saved: SavedSearch } | { ok: false; error: string } {
    if (this.atLimit()) {
      return {
        ok: false,
        error: `You can save up to ${SAVED_SEARCH_LIMIT} searches. Delete one to make room.`,
      };
    }
    const now = new Date().toISOString();
    const saved: SavedSearch = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || 'Untitled search',
      createdAt: now,
      updatedAt: now,
      instance: context.instance,
      authenticated: context.authenticated,
      // Deep-clone so later form edits can't mutate the stored definition.
      search: structuredClone(search),
    };
    // Newest first.
    this.persist([saved, ...this.all()]);
    return { ok: true, saved };
  }

  rename(id: string, name: string): void {
    this.persist(
      this.all().map((s) =>
        s.id === id
          ? { ...s, name: name.trim() || s.name, updatedAt: new Date().toISOString() }
          : s,
      ),
    );
  }

  /** Duplicate an existing search (subject to the cap). */
  duplicate(id: string): void {
    const original = this.all().find((s) => s.id === id);
    if (!original || this.atLimit()) {
      return;
    }
    this.save(`${original.name} (copy)`, original.search, {
      instance: original.instance,
      authenticated: original.authenticated,
    });
  }

  delete(id: string): void {
    this.persist(this.all().filter((s) => s.id !== id));
  }

  private persist(searches: SavedSearch[]): void {
    const capped = searches.slice(0, SAVED_SEARCH_LIMIT);
    const state: SavedSearchState = { version: STATE_VERSION, searches: capped };
    this.state.set(state);
    try {
      localStorage.setItem(scopedKey(STORAGE_KEY_BASE), JSON.stringify(state));
    } catch {
      // Storage full/unavailable — keep the in-memory copy so the UI still works.
    }
  }
}
