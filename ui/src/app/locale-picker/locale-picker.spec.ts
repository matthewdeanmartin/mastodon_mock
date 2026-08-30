import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_ENDONYMS, SUPPORTED_LOCALES, UiLocale } from '../i18n/locale';
import { LocalePicker } from './locale-picker';

describe('LocalePicker', () => {
  beforeEach(() => localStorage.clear());

  it('renders nothing while only one locale ships', () => {
    // A one-option language menu is noise on an already-crowded footer. This
    // expectation inverts in ui-i18n-7 when SUPPORTED_LOCALES grows; until
    // then it guards against the control shipping visible-but-useless.
    const fixture = TestBed.createComponent(LocalePicker);
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector('select');
    expect(SUPPORTED_LOCALES.length).toBe(1);
    expect(select).toBeNull();
  });

  it('names every shipped locale in its own language', () => {
    // Never localized: someone stranded in a language they cannot read has to
    // be able to find their own, and "German" is no help to a German reader.
    for (const code of SUPPORTED_LOCALES) {
      expect(LOCALE_ENDONYMS[code]).toBeTruthy();
    }
  });

  it('shows in-progress locales when the deployment makes them available', () => {
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
      'Deutsch (in Arbeit)',
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
