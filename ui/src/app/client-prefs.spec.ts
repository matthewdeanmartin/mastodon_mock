import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, ClientPrefs } from './client-prefs';

const PREFS_KEY = 'mockingbird_client_prefs';
const TOKEN_KEY = 'mastodon_mock_token';
const HIDDEN_BASE = 'mockingbird_hidden_providers';

describe('ClientPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
  });

  function create(): ClientPrefs {
    const prefs = TestBed.inject(ClientPrefs);
    TestBed.tick(); // flush the apply/persist effect
    return prefs;
  }

  it('defaults to auto theme, blue accent, posting guards off, fixed blue checks', () => {
    const prefs = create();
    expect(prefs.themeMode()).toBe('auto');
    expect(prefs.accentId()).toBe('blue');
    expect(prefs.confirmBeforePost()).toBe(false);
    expect(prefs.delayedSend()).toBe(false);
    expect(prefs.verifiedMode()).toBe('fixed');
  });

  it('applies data-theme and data-accent to the document root', () => {
    const prefs = create();
    prefs.setThemeMode('dark');
    prefs.setAccent('purple');
    TestBed.tick();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-accent')).toBe('purple');
    expect(prefs.resolvedTheme()).toBe('dark');
  });

  it('persists changes to localStorage', () => {
    const prefs = create();
    prefs.setThemeMode('light');
    prefs.setDelayedSend(true);
    prefs.setVerifiedMode('everyone');
    TestBed.tick();

    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    expect(stored.themeMode).toBe('light');
    expect(stored.delayedSend).toBe(true);
    expect(stored.confirmBeforePost).toBe(false);
    expect(stored.verifiedMode).toBe('everyone');
  });

  it('restores persisted prefs on construction', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        themeMode: 'dark',
        accentId: 'green',
        confirmBeforePost: true,
        verifiedMode: 'famous',
        readerFontSize: 21,
      }),
    );
    const prefs = create();

    expect(prefs.themeMode()).toBe('dark');
    expect(prefs.accentId()).toBe('green');
    expect(prefs.confirmBeforePost()).toBe(true);
    expect(prefs.delayedSend()).toBe(false);
    expect(prefs.verifiedMode()).toBe('famous');
    expect(prefs.readerFontSize()).toBe(21);
  });

  it('migrates the legacy combined undoSend pref onto both new halves', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ undoSend: true }));
    const prefs = create();

    expect(prefs.confirmBeforePost()).toBe(true);
    expect(prefs.delayedSend()).toBe(true);
  });

  it('ignores corrupt or unknown stored values', () => {
    localStorage.setItem(PREFS_KEY, '{not json');
    expect(create().themeMode()).toBe('auto');
  });

  it('rejects unknown accent ids and out-of-range reader font sizes', () => {
    const prefs = create();
    prefs.setAccent('hotdog-stand');
    expect(prefs.accentId()).toBe('blue');

    prefs.setReaderFontSize(99);
    expect(prefs.readerFontSize()).toBe(24);
    prefs.setReaderFontSize(1);
    expect(prefs.readerFontSize()).toBe(15);
  });

  it('ships at least the classic blue plus five alternative accents', () => {
    expect(ACCENT_PRESETS[0].id).toBe('blue');
    expect(ACCENT_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  // ---------------------------------------------------------------- feed size

  it('defaults feed size to 20 min / 500 max', () => {
    const prefs = create();
    expect(prefs.feedMin()).toBe(20);
    expect(prefs.feedMax()).toBe(500);
  });

  it('clamps feed min to the floor and never above the current max', () => {
    const prefs = create();
    prefs.setFeedMin(2); // below floor
    expect(prefs.feedMin()).toBe(5);

    prefs.setFeedMax(30);
    prefs.setFeedMin(100); // above max
    expect(prefs.feedMin()).toBe(30);
  });

  it('lowering the max below the current min pulls the min down too', () => {
    const prefs = create();
    prefs.setFeedMin(200);
    prefs.setFeedMax(50);
    expect(prefs.feedMax()).toBe(50);
    expect(prefs.feedMin()).toBe(50);
  });

  it('persists and restores feed size prefs', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ feedMin: 30, feedMax: 300 }));
    const prefs = create();
    expect(prefs.feedMin()).toBe(30);
    expect(prefs.feedMax()).toBe(300);
  });

  // ------------------------------------------------ hidden providers (scoped)

  /** Rebuild ClientPrefs from scratch, as an account switch's hard reload would. */
  function recreate(): ClientPrefs {
    TestBed.resetTestingModule();
    return create();
  }

  it('persists hidden providers to an account-scoped key, not the global blob', () => {
    localStorage.setItem(TOKEN_KEY, 'token-one');
    const prefs = create();
    prefs.toggleProvider('bluesky');
    TestBed.tick();

    // Not in the shared prefs blob anymore.
    const blob = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    expect(blob.hiddenProviders).toBeUndefined();
    // In a key scoped to this account's token.
    const scoped = Object.keys(localStorage).find(
      (k) => k.startsWith(HIDDEN_BASE + '_') && k !== HIDDEN_BASE,
    );
    expect(scoped).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(scoped!) ?? '[]')).toEqual(['bluesky']);
  });

  it("does not leak one account's hidden providers to another", () => {
    localStorage.setItem(TOKEN_KEY, 'token-one');
    const one = create();
    one.toggleProvider('bluesky');
    TestBed.tick();

    // Switch accounts (hard reload rebuilds ClientPrefs under the new token).
    localStorage.setItem(TOKEN_KEY, 'token-two');
    const two = recreate();
    expect(two.hiddenProviders()).toEqual([]);
    expect(two.isProviderVisible('bluesky')).toBe(true);

    // Switching back restores the first account's filter.
    localStorage.setItem(TOKEN_KEY, 'token-one');
    const oneAgain = recreate();
    expect(oneAgain.hiddenProviders()).toEqual(['bluesky']);
  });

  it('migrates a legacy blob hiddenProviders once, then strips it from the blob', () => {
    localStorage.setItem(TOKEN_KEY, 'token-one');
    localStorage.setItem(PREFS_KEY, JSON.stringify({ hiddenProviders: ['mastodon', 'rss'] }));
    const prefs = create();
    expect(prefs.hiddenProviders()).toEqual(['mastodon', 'rss']);

    // The legacy copy is removed from the shared blob so other accounts can't inherit it.
    const blob = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    expect(blob.hiddenProviders).toBeUndefined();

    // A different account loading afterward starts clean.
    localStorage.setItem(TOKEN_KEY, 'token-two');
    const other = recreate();
    expect(other.hiddenProviders()).toEqual([]);
  });
});
