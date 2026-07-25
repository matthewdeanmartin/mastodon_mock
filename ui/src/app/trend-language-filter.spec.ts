import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClientPrefs } from './client-prefs';
import { Status, Tag } from './models';
import {
  FeedLanguageFilter,
  KnownLanguages,
  TrendLanguageFilter,
  UI_LANGUAGE,
} from './trend-language-filter';

function tag(name: string): Tag {
  return { id: name, name, url: `https://x/tags/${name}`, following: false, featuring: false, history: [] };
}

function post(content: string, language: string | null = null, overrides: Partial<Status> = {}): Status {
  return {
    id: Math.random().toString(36).slice(2),
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: `<p>${content}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: 'a', username: 'a', acct: 'a', display_name: 'A' } as never,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    language,
    media_attachments: [],
    ...overrides,
  };
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

describe('FeedLanguageFilter', () => {
  let prefs: ClientPrefs;
  let filter: FeedLanguageFilter;

  const FRENCH = 'le chat est dans la maison et je ne sais pas pourquoi mais il est là';
  const ENGLISH = 'the quick brown fox is in the house and that is all we have here today';

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    prefs = TestBed.inject(ClientPrefs);
    filter = TestBed.inject(FeedLanguageFilter);
    prefs.setKnownLanguages(['en']); // user knows English only
  });

  it('passes everything through when the toggle is off', () => {
    prefs.setHideForeignLangPosts(false);
    expect(filter.shouldShow(post(FRENCH, 'fr'))).toBe(true);
  });

  it('hides a post that declares a language the user does not know', () => {
    prefs.setHideForeignLangPosts(true);
    expect(filter.hideReason(post('court texte', 'fr'))).toBe('foreign');
  });

  it('keeps a post declared in a known language', () => {
    prefs.setHideForeignLangPosts(true);
    expect(filter.shouldShow(post(ENGLISH, 'en'))).toBe(true);
  });

  it('hides a foreign post with no declared language but confident detection', () => {
    prefs.setHideForeignLangPosts(true);
    expect(filter.hideReason(post(FRENCH, null))).toBe('foreign');
  });

  it('flags misrepresentation: declared en, text confidently French', () => {
    prefs.setKnownLanguages(['en', 'fr']); // knows both, so not "foreign"
    prefs.setHideForeignLangPosts(true);
    expect(filter.hideReason(post(FRENCH, 'en'))).toBe('misrepresented');
  });

  it('never hides a post too short to detect and with no declared language', () => {
    prefs.setHideForeignLangPosts(true);
    expect(filter.shouldShow(post('hi', null))).toBe(true);
    expect(filter.shouldShow(post('ok merci', null))).toBe(true); // short → unsure
  });

  it('never hides on ambiguous detection (no confident winner)', () => {
    prefs.setHideForeignLangPosts(true);
    // Numbers/punctuation only — detection returns und → keep.
    expect(filter.shouldShow(post('12345 67890 !!! ??? ...', null))).toBe(true);
  });

  it('uses the boost target language for a reblog', () => {
    prefs.setHideForeignLangPosts(true);
    const inner = post(FRENCH, 'fr');
    const boost = post('', null, { reblog: inner });
    expect(filter.hideReason(boost)).toBe('foreign');
  });

  it('apply() preserves order and drops only sure-foreign posts', () => {
    prefs.setHideForeignLangPosts(true);
    const list = [post(ENGLISH, 'en'), post(FRENCH, 'fr'), post('hi', null)];
    const kept = filter.apply(list);
    expect(kept).toHaveLength(2); // English kept, French dropped, short kept
    expect(kept[0]).toBe(list[0]);
    expect(kept[1]).toBe(list[2]);
  });
});
