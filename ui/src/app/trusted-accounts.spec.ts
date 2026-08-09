import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account } from './models';
import { TrustedAccounts } from './trusted-accounts';

function account(acct: string, over: Partial<Account> = {}): Account {
  return { id: acct, acct, url: `https://example.social/@${acct}`, ...over } as Account;
}

describe('TrustedAccounts', () => {
  let trusted: TrustedAccounts;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    trusted = TestBed.inject(TrustedAccounts);
  });

  afterEach(() => localStorage.clear());

  it('starts with nobody trusted and both switches off', () => {
    expect(trusted.count()).toBe(0);
    expect(trusted.expandAllCw()).toBe(false);
    expect(trusted.showAllSensitive()).toBe(false);
    expect(trusted.isTrusted(account('alice'))).toBe(false);
  });

  it('trusts and untrusts an account', () => {
    const alice = account('alice');
    trusted.trust(alice);
    expect(trusted.isTrusted(alice)).toBe(true);
    expect(trusted.count()).toBe(1);
    trusted.untrust(alice);
    expect(trusted.isTrusted(alice)).toBe(false);
  });

  it('toggle reports the state it landed in', () => {
    const alice = account('alice');
    expect(trusted.toggle(alice)).toBe(true);
    expect(trusted.toggle(alice)).toBe(false);
  });

  /** Same person, different route: keyed on acct, so trust follows them. */
  it('keys on the handle rather than the route-specific id', () => {
    trusted.trust(account('alice', { id: 'local-1' }));
    expect(trusted.isTrusted(account('alice', { id: 'remote-99' }))).toBe(true);
  });

  it('expands a trusted author CW while leaving others collapsed', () => {
    trusted.trust(account('alice'));
    expect(trusted.cwExpanded(account('alice'))).toBe(true);
    expect(trusted.cwExpanded(account('bob'))).toBe(false);
  });

  it('shows a trusted author sensitive media while leaving others blurred', () => {
    trusted.trust(account('alice'));
    expect(trusted.sensitiveShown(account('alice'))).toBe(true);
    expect(trusted.sensitiveShown(account('bob'))).toBe(false);
  });

  it('the account-wide switches cover everyone', () => {
    trusted.setExpandAllCw(true);
    expect(trusted.cwExpanded(account('stranger'))).toBe(true);
    expect(trusted.sensitiveShown(account('stranger'))).toBe(false);

    trusted.setShowAllSensitive(true);
    expect(trusted.sensitiveShown(account('stranger'))).toBe(true);
  });

  it('treats a missing account as untrusted rather than throwing', () => {
    expect(trusted.cwExpanded(null)).toBe(false);
    expect(trusted.sensitiveShown(undefined)).toBe(false);
    // ...but a global switch still applies with no account in hand.
    trusted.setExpandAllCw(true);
    expect(trusted.cwExpanded(null)).toBe(true);
  });

  it('clearAll empties the list but leaves the switches alone', () => {
    trusted.trust(account('alice'));
    trusted.trust(account('bob'));
    trusted.setExpandAllCw(true);
    trusted.clearAll();
    expect(trusted.count()).toBe(0);
    expect(trusted.expandAllCw()).toBe(true);
  });

  it('lists the most recently trusted first', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-09T10:00:00Z'));
      trusted.trust(account('alice'));
      vi.setSystemTime(new Date('2026-08-09T11:00:00Z'));
      trusted.trust(account('bob'));
      expect(trusted.list().map((r) => r.acct)).toEqual(['bob', 'alice']);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Two clicks inside one millisecond must not produce a reshuffling list. */
  it('breaks same-instant ties alphabetically', () => {
    vi.useFakeTimers();
    try {
      // Time frozen, so all three carry an identical `since`.
      vi.setSystemTime(new Date('2026-08-09T10:00:00Z'));
      trusted.trust(account('carol'));
      trusted.trust(account('alice'));
      trusted.trust(account('bob'));
      expect(trusted.list().map((r) => r.acct)).toEqual(['alice', 'bob', 'carol']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a reload', () => {
    trusted.trust(account('alice'));
    trusted.setShowAllSensitive(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reloaded = TestBed.inject(TrustedAccounts);

    expect(reloaded.isTrusted(account('alice'))).toBe(true);
    expect(reloaded.showAllSensitive()).toBe(true);
  });

  it('ignores corrupt stored state rather than failing to construct', () => {
    localStorage.setItem('mockingbird_trusted_accounts', '{ not json');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(TrustedAccounts);
    expect(fresh.count()).toBe(0);
  });

  it('untrusting someone who was never trusted is a no-op', () => {
    trusted.trust(account('alice'));
    trusted.untrust(account('bob'));
    expect(trusted.count()).toBe(1);
  });
});
