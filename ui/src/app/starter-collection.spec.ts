import { describe, expect, it } from 'vitest';
import { STARTER_COLLECTION, STARTER_KITS } from './starter-collection';

// The starter roster evolves — accounts come and go. These tests assert the
// invariants that must always hold, not a frozen count or a specific line-up.
describe('STARTER_COLLECTION', () => {
  it('ships a non-empty set of well-formed accounts', () => {
    expect(STARTER_COLLECTION.length).toBeGreaterThan(0);
    for (const account of STARTER_COLLECTION) {
      expect(account.name.trim()).not.toBe('');
      // Handles are fully-qualified `user@domain` so a fresh account can follow.
      expect(account.handle).toMatch(/^[^@\s]+@[^@\s]+$/);
      expect(account.account.id).not.toBe('');
      expect(account.account.acct.toLowerCase()).toBe(account.handle.toLowerCase());
    }
  });

  it('has unique handles (case-insensitive)', () => {
    const handles = STARTER_COLLECTION.map((account) => account.handle.toLowerCase());
    expect(new Set(handles).size).toBe(handles.length);
  });

  it('excludes the retired botsin.space accounts', () => {
    expect(STARTER_COLLECTION.some((account) => account.handle.endsWith('@botsin.space'))).toBe(
      false,
    );
  });

  it('ships ten themed kits whose account ids came from their home instances', () => {
    expect(STARTER_KITS).toHaveLength(11);
    for (const kit of STARTER_KITS.slice(1)) {
      expect(kit.accounts.length).toBeGreaterThanOrEqual(5);
      for (const item of kit.accounts) {
        expect(item.account.id).not.toBe('');
        expect(item.account.discoverable).not.toBe(false);
        expect(item.account.indexable).not.toBe(false);
        expect(item.account.noindex).not.toBe(true);
      }
    }
  });
});
