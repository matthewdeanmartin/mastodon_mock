import { describe, expect, it } from 'vitest';
import { Account } from '../../models';
import { AccountSearchStore, AccountSearchSnapshot } from './account-search-store';

function makeSnapshot(query: string): AccountSearchSnapshot {
  return {
    query,
    items: [
      { account: { id: 'a', acct: 'a' } as Account, matchingPosts: [] },
    ],
    relationships: {},
    expanded: [],
    facets: [],
    filter: '',
    sort: 'relevance',
    bounds: { text: query },
    callsUsed: 2,
    scrollTop: 120,
  };
}

describe('AccountSearchStore', () => {
  it('returns a saved snapshot only for a matching query', () => {
    const store = new AccountSearchStore();
    store.save(makeSnapshot('economist'));

    expect(store.take('economist')?.items).toHaveLength(1);
    expect(store.take('physicist')).toBeNull();
  });

  it('take does not consume the snapshot', () => {
    const store = new AccountSearchStore();
    store.save(makeSnapshot('economist'));

    expect(store.take('economist')).not.toBeNull();
    // Still there on a second read — the caller decides when to clear.
    expect(store.take('economist')).not.toBeNull();
  });

  it('clear drops the snapshot', () => {
    const store = new AccountSearchStore();
    store.save(makeSnapshot('economist'));
    store.clear();

    expect(store.take('economist')).toBeNull();
  });

  it('a newer save replaces the previous snapshot', () => {
    const store = new AccountSearchStore();
    store.save(makeSnapshot('economist'));
    store.save(makeSnapshot('historian'));

    expect(store.take('economist')).toBeNull();
    expect(store.take('historian')).not.toBeNull();
  });
});
