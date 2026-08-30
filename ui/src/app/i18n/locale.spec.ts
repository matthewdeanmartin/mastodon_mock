import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClientPrefs } from '../client-prefs';
import { FALLBACK_LOCALE, negotiateLocale, SUPPORTED_LOCALES, UiLocale } from './locale';

/**
 * Replace `navigator.languages` for one test.
 *
 * The suite shares a jsdom realm (see `src/test-setup.ts`), so this must be
 * undone; `configurable: true` lets the next call displace it, and nothing
 * outside these tests reads the value.
 */
function setBrowserLanguages(languages: string[]): void {
  Object.defineProperty(navigator, 'languages', {
    value: languages,
    configurable: true,
  });
}

describe('negotiateLocale', () => {
  it('falls back to English when the browser wants nothing we ship', () => {
    expect(negotiateLocale(['fr-FR', 'fr'])).toBe(FALLBACK_LOCALE);
  });

  it('matches on the bare tag, so regional variants resolve', () => {
    // A build shipping only `en` must still recognise en-GB as English rather
    // than treating it as an unknown language.
    expect(negotiateLocale(['en-GB'])).toBe('en');
    expect(negotiateLocale(['en_US'])).toBe('en');
  });

  it('takes the browser’s first supported entry, not the first entry', () => {
    expect(negotiateLocale(['zz', 'en-GB'])).toBe('en');
  });

  it('falls back on an empty chain', () => {
    expect(negotiateLocale([])).toBe(FALLBACK_LOCALE);
  });
});

describe('UiLocale', () => {
  beforeEach(() => {
    localStorage.clear();
    setBrowserLanguages(['en-US']);
  });

  it('is automatic when nothing has been chosen', () => {
    const locale = TestBed.inject(UiLocale);
    expect(locale.isAutomatic()).toBe(true);
    expect(locale.active()).toBe('en');
  });

  it('reports a stored choice as not automatic', () => {
    TestBed.inject(ClientPrefs).uiLocale.set('en');
    const locale = TestBed.inject(UiLocale);
    expect(locale.isAutomatic()).toBe(false);
    expect(locale.active()).toBe('en');
  });

  it('ignores a stored locale this build does not ship', () => {
    // A locale chosen on a newer build, or hand-edited into storage, must not
    // strand the reader on a dictionary that isn't here: fall through to
    // negotiation rather than rendering nothing.
    TestBed.inject(ClientPrefs).uiLocale.set('xx');
    const locale = TestBed.inject(UiLocale);
    expect(locale.active()).toBe(FALLBACK_LOCALE);
    expect(locale.isAutomatic()).toBe(true);
  });

  it('choose(null) hands the decision back to the browser', () => {
    const prefs = TestBed.inject(ClientPrefs);
    const locale = TestBed.inject(UiLocale);
    locale.choose('en');
    expect(locale.isAutomatic()).toBe(false);
    locale.choose(null);
    expect(prefs.uiLocale()).toBeNull();
    expect(locale.isAutomatic()).toBe(true);
  });

  it('does not persist a negotiated locale', () => {
    // The load-bearing rule: persisting the browser's guess would silently turn
    // it into an explicit choice, freezing a reader who later changes their OS
    // language onto the old one with nothing in the UI to explain why.
    const prefs = TestBed.inject(ClientPrefs);
    const locale = TestBed.inject(UiLocale);
    expect(locale.active()).toBe('en');
    expect(prefs.uiLocale()).toBeNull();
  });

  it('hides the picker while only one locale ships', () => {
    // Guards the footer against a one-option language menu. This expectation
    // flips in ui-i18n-7, when SUPPORTED_LOCALES grows.
    const locale = TestBed.inject(UiLocale);
    expect(locale.hasChoice).toBe(SUPPORTED_LOCALES.length > 1);
  });
});

describe('an explicit choice survives the browser disagreeing', () => {
  it('keeps the stored locale when navigator prefers another', () => {
    localStorage.clear();
    setBrowserLanguages(['de-DE', 'de']);
    TestBed.inject(ClientPrefs).uiLocale.set('en');
    expect(TestBed.inject(UiLocale).active()).toBe('en');
  });
});
