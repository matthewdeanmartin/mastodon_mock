import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountScopeSuffix, scopedKey } from './account-scope';

const TOKEN_KEY = 'mastodon_mock_token';

describe('account-scope', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns an empty suffix when logged out', () => {
    expect(accountScopeSuffix()).toBe('');
    expect(scopedKey('mockingbird_rss_feeds')).toBe('mockingbird_rss_feeds');
  });

  it('derives a stable, non-empty suffix from the active token', () => {
    localStorage.setItem(TOKEN_KEY, 'token-abc');
    const a = accountScopeSuffix();
    const b = accountScopeSuffix();
    expect(a).not.toBe('');
    expect(a).toBe(b); // stable for the same token
    expect(a.startsWith('_')).toBe(true);
  });

  it('never embeds the raw token in the key', () => {
    localStorage.setItem(TOKEN_KEY, 'super-secret-token-value');
    const key = scopedKey('mockingbird_bsky_session');
    expect(key).not.toContain('super-secret-token-value');
    expect(key.startsWith('mockingbird_bsky_session_')).toBe(true);
  });

  it('gives different accounts different namespaces', () => {
    localStorage.setItem(TOKEN_KEY, 'token-one');
    const one = scopedKey('base');
    localStorage.setItem(TOKEN_KEY, 'token-two');
    const two = scopedKey('base');
    expect(one).not.toBe(two);
  });
});
