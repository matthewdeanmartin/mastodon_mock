import { describe, expect, it } from 'vitest';
import { STARTER_COLLECTION } from './starter-collection';

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
});
