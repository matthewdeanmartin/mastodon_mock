import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, ClientPrefs } from './client-prefs';

const PREFS_KEY = 'mockingbird_client_prefs';

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

  it('defaults to auto theme, blue accent, undo-send off', () => {
    const prefs = create();
    expect(prefs.themeMode()).toBe('auto');
    expect(prefs.accentId()).toBe('blue');
    expect(prefs.undoSend()).toBe(false);
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
    prefs.setUndoSend(true);
    TestBed.tick();

    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    expect(stored.themeMode).toBe('light');
    expect(stored.undoSend).toBe(true);
  });

  it('restores persisted prefs on construction', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ themeMode: 'dark', accentId: 'green', undoSend: true, readerFontSize: 21 }),
    );
    const prefs = create();

    expect(prefs.themeMode()).toBe('dark');
    expect(prefs.accentId()).toBe('green');
    expect(prefs.undoSend()).toBe(true);
    expect(prefs.readerFontSize()).toBe(21);
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
});
