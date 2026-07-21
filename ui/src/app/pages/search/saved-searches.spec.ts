import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptySearch, MawkingbirdSearch } from './mawkingbird-search';
import { SAVED_SEARCH_LIMIT, SavedSearches } from './saved-searches';

function postSearch(words: string): MawkingbirdSearch {
  const s = emptySearch('posts');
  s.post = { words };
  return s;
}

const ctx = { instance: 'mastodon.social', authenticated: true };

describe('SavedSearches', () => {
  let svc: SavedSearches;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(SavedSearches);
  });

  it('saves a search newest-first and persists it', () => {
    svc.save('First', postSearch('a'), ctx);
    svc.save('Second', postSearch('b'), ctx);
    expect(svc.all().map((s) => s.name)).toEqual(['Second', 'First']);
    // A fresh instance re-reads from storage.
    const reloaded = new SavedSearches();
    expect(reloaded.all().map((s) => s.name)).toEqual(['Second', 'First']);
  });

  it('deep-clones so later edits to the passed object do not mutate the saved copy', () => {
    const original = postSearch('a');
    svc.save('X', original, ctx);
    original.post!.words = 'mutated';
    expect(svc.all()[0].search.post?.words).toBe('a');
  });

  it('enforces the per-account cap', () => {
    for (let i = 0; i < SAVED_SEARCH_LIMIT; i++) {
      expect(svc.save(`s${i}`, postSearch(`w${i}`), ctx).ok).toBe(true);
    }
    expect(svc.atLimit()).toBe(true);
    const overflow = svc.save('too many', postSearch('z'), ctx);
    expect(overflow.ok).toBe(false);
    expect(svc.count()).toBe(SAVED_SEARCH_LIMIT);
  });

  it('renames, duplicates, and deletes', () => {
    const saved = svc.save('Name', postSearch('a'), ctx);
    const id = saved.ok ? saved.saved.id : '';
    svc.rename(id, 'Renamed');
    expect(svc.all().find((s) => s.id === id)?.name).toBe('Renamed');

    svc.duplicate(id);
    expect(svc.count()).toBe(2);
    expect(svc.all().some((s) => s.name === 'Renamed (copy)')).toBe(true);

    svc.delete(id);
    expect(svc.all().some((s) => s.id === id)).toBe(false);
  });
});
