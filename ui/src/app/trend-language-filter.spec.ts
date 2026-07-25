import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClientPrefs } from './client-prefs';
import { Tag } from './models';
import { KnownLanguages, TrendLanguageFilter, UI_LANGUAGE } from './trend-language-filter';

function tag(name: string): Tag {
  return { id: name, name, url: `https://x/tags/${name}`, following: false, featuring: false, history: [] };
}

describe('TrendLanguageFilter', () => {
  let prefs: ClientPrefs;
  let filter: TrendLanguageFilter;
  let known: KnownLanguages;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    prefs = TestBed.inject(ClientPrefs);
    filter = TestBed.inject(TrendLanguageFilter);
    known = TestBed.inject(KnownLanguages);
  });

  it('passes everything through when the toggle is off', () => {
    prefs.setExcludeUnknownLangTrends(false);
    const tags = [tag('東京'), tag('Eurovision'), tag('مصر')];
    expect(filter.apply(tags)).toEqual(tags);
  });

  it('always knows the UI language', () => {
    expect(known.knows(UI_LANGUAGE)).toBe(true);
  });

  it('hides a confidently-foreign-script tag when the language is unknown', () => {
    prefs.setKnownLanguages(['en']);
    prefs.setExcludeUnknownLangTrends(true);
    // 안녕 (Korean) and مصر (Arabic) are not known; Eurovision (Latin) is kept.
    const kept = filter.apply([tag('안녕'), tag('Eurovision'), tag('مصر')]);
    expect(kept.map((t) => t.name)).toEqual(['Eurovision']);
  });

  it('keeps a foreign-script tag when its language IS known', () => {
    prefs.setKnownLanguages(['en', 'ko']);
    prefs.setExcludeUnknownLangTrends(true);
    const kept = filter.apply([tag('안녕'), tag('Berlin')]);
    expect(kept.map((t) => t.name)).toEqual(['안녕', 'Berlin']);
  });

  it('keeps ambiguous bare-Han tags regardless (東京 could be ja or zh)', () => {
    prefs.setKnownLanguages(['en']); // knows neither ja nor zh
    prefs.setExcludeUnknownLangTrends(true);
    expect(filter.shouldShow(tag('東京'))).toBe(true);
  });

  it('hides a Latin tag with an exclusive letter in an unknown language', () => {
    prefs.setKnownLanguages(['en']); // no German
    prefs.setExcludeUnknownLangTrends(true);
    // #Straße carries ß, which is German-exclusive.
    const kept = filter.apply([tag('Straße'), tag('Eurovision'), tag('Wrocław')]);
    // Straße → de (hidden), Wrocław → pl (hidden), Eurovision → undetermined (kept).
    expect(kept.map((t) => t.name)).toEqual(['Eurovision']);
  });

  it('keeps an exclusive-letter tag when that language is known', () => {
    prefs.setKnownLanguages(['en', 'de']);
    prefs.setExcludeUnknownLangTrends(true);
    expect(filter.shouldShow(tag('Straße'))).toBe(true);
  });

  it('still keeps shared-diacritic Latin tags (München, café)', () => {
    prefs.setKnownLanguages(['en']);
    prefs.setExcludeUnknownLangTrends(true);
    // ü and é are shared across many languages — not proof — so these are kept.
    const kept = filter.apply([tag('München'), tag('café')]);
    expect(kept.map((t) => t.name)).toEqual(['München', 'café']);
  });

  it('always keeps Latin-alphabet tags (undetermined script)', () => {
    prefs.setKnownLanguages(['ja']); // user does NOT list English
    prefs.setExcludeUnknownLangTrends(true);
    // Even though 'en' isn't explicitly listed, Latin script is undetermined → kept.
    const kept = filter.apply([tag('München'), tag('Eurovision')]);
    expect(kept.map((t) => t.name)).toEqual(['München', 'Eurovision']);
  });

  it('strips a leading # before detecting', () => {
    prefs.setKnownLanguages(['en']);
    prefs.setExcludeUnknownLangTrends(true);
    expect(filter.shouldShow(tag('#안녕'))).toBe(false);
    expect(filter.shouldShow(tag('#Eurovision'))).toBe(true);
  });

  it('reacts to explicitly added/removed known languages', () => {
    prefs.setKnownLanguages([]);
    prefs.setExcludeUnknownLangTrends(true);
    expect(filter.shouldShow(tag('안녕'))).toBe(false); // Korean, unknown
    prefs.addKnownLanguage('ko');
    expect(filter.shouldShow(tag('안녕'))).toBe(true);
    prefs.removeKnownLanguage('ko');
    expect(filter.shouldShow(tag('안녕'))).toBe(false);
  });
});

describe('KnownLanguages', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('includes the UI language as a floor even with no prefs', () => {
    const known = TestBed.inject(KnownLanguages);
    expect(known.codes().has(UI_LANGUAGE)).toBe(true);
  });

  it('normalizes regioned codes from the explicit list', () => {
    const prefs = TestBed.inject(ClientPrefs);
    const known = TestBed.inject(KnownLanguages);
    prefs.setKnownLanguages(['pt-BR', 'DE']);
    expect(known.knows('pt')).toBe(true);
    expect(known.knows('de')).toBe(true);
  });
});
