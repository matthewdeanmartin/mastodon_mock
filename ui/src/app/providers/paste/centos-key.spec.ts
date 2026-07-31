import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CentosPasteKey } from './centos-key';

const KEY = 'mockingbird_centos_paste_key';
const TOKEN_KEY = 'mastodon_mock_token';
const LIFETIME_KEY = 'mockingbird_credential_lifetime';

function build(): CentosPasteKey {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(CentosPasteKey);
}

describe('CentosPasteKey', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts disconnected', () => {
    const store = build();
    expect(store.connected()).toBe(false);
    expect(store.key()).toBeNull();
  });

  it('stores a key and reports it connected', () => {
    const store = build();
    store.connect('  abc123  ');

    expect(store.connected()).toBe(true);
    // Trimmed: a stray newline from a copy-paste would break every request.
    expect(store.key()).toBe('abc123');
  });

  it('rejects a blank key rather than storing an unusable one', () => {
    const store = build();
    expect(() => store.connect('   ')).toThrow();
    expect(store.connected()).toBe(false);
  });

  it('survives a reload', () => {
    build().connect('abc123');
    expect(build().key()).toBe('abc123');
  });

  it('forgets the key on disconnect', () => {
    const store = build();
    store.connect('abc123');
    store.disconnect();

    expect(store.key()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is shared by every account in the browser', () => {
    // A pastebin key authorises this browser to talk to a service; it is not a
    // claim about which persona you are, so an alt must not have to re-paste it.
    localStorage.setItem(TOKEN_KEY, 'token-alice');
    build().connect('abc123');

    localStorage.setItem(TOKEN_KEY, 'token-bob');

    expect(build().key()).toBe('abc123');
  });

  it('drops a key that has outlived the retention policy', () => {
    localStorage.setItem(LIFETIME_KEY, '30d');
    const store = build();
    store.connect('abc123');
    // Backdate the stamp past the 30-day window.
    const stale = { apiKey: 'abc123', connectedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 };
    localStorage.setItem(KEY, JSON.stringify(stale));

    const reloaded = build();
    reloaded.enforceLifetime();

    expect(reloaded.key()).toBeNull();
  });

  it('keeps a key that is still within the policy', () => {
    localStorage.setItem(LIFETIME_KEY, '90d');
    const store = build();
    store.connect('abc123');
    store.enforceLifetime();

    expect(store.key()).toBe('abc123');
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(build().key()).toBeNull();
  });
});
