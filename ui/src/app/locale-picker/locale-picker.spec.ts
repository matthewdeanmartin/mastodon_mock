import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_ENDONYMS, SUPPORTED_LOCALES, UiLocale } from '../i18n/locale';
import { LocalePicker } from './locale-picker';

describe('LocalePicker', () => {
  beforeEach(() => localStorage.clear());

  it('renders the picker now that more than one locale ships', () => {
    // The inversion ui-i18n-7 anticipated: the control hid itself while `en`
    // was the only dictionary, and appears now that every translated locale is
    // in production. What it still guards is the *reason* — the menu exists
    // only when there is something to choose between.
    const fixture = TestBed.createComponent(LocalePicker);
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector('select');
    expect(SUPPORTED_LOCALES.length).toBeGreaterThan(1);
    expect(select).not.toBeNull();
  });

  it('names every shipped locale in its own language', () => {
    // Never localized: someone stranded in a language they cannot read has to
    // be able to find their own, and "German" is no help to a German reader.
    for (const code of SUPPORTED_LOCALES) {
      expect(LOCALE_ENDONYMS[code]).toBeTruthy();
    }
  });

  it('lists the deployment’s available locales by their endonyms', () => {
    const choose = vi.fn();
    TestBed.overrideProvider(UiLocale, {
      useValue: {
        hasChoice: true,
        available: ['en', 'de'],
        active: signal('en'),
        isAutomatic: signal(true),
        choose,
      },
    });

    const fixture = TestBed.createComponent(LocalePicker);
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector('select')!;
    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      'Automatic (browser)',
      'English',
      'Deutsch',
    ]);

    select.value = 'de';
    select.dispatchEvent(new Event('change'));
    expect(choose).toHaveBeenCalledWith('de');
  });

  it('forcing a locale, then choosing Automatic, returns to negotiation', () => {
    // Without the Automatic option, forcing a language once would be
    // irreversible — the trap this guards against.
    const locale = TestBed.inject(UiLocale);
    locale.choose('en');
    expect(locale.isAutomatic()).toBe(false);
    locale.choose(null);
    expect(locale.isAutomatic()).toBe(true);
  });
});
