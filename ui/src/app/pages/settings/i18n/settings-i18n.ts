import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { ClientPrefs } from '../../../client-prefs';
import { LANG_NAMES, LangCode, POSTING_LANGUAGE_OPTIONS } from '../../../language-detect';
import { KnownLanguages, UI_LANGUAGE } from '../../../trend-language-filter';
import {
  ENGINE_LABELS,
  TRANSLATION_ENGINES,
  TranslationEngine,
  TranslationUsage,
} from '../../../translation-usage';

/** Languages offered in the "add a language" picker — the ones we can name. */
const PICKER_ORDER: LangCode[] = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'nl',
  'sv',
  'da',
  'no',
  'fi',
  'pl',
  'tr',
  'ru',
  'uk',
  'el',
  'ja',
  'ko',
  'zh',
  'ar',
  'he',
  'hi',
  'th',
  'eo',
  'is',
];

/**
 * Internationalization settings: which languages the user knows, and whether to
 * hide trending tags in languages they don't. "Known" is aggregated by
 * {@link KnownLanguages} from the interface language, the browser, the posting
 * default, and the explicit list edited here — this page surfaces where each
 * inferred language came from so the filter's behavior isn't a black box.
 */
@Component({
  selector: 'app-settings-i18n',
  imports: [FormsModule],
  templateUrl: './settings-i18n.html',
})
export class SettingsI18n implements OnInit {
  protected readonly prefs = inject(ClientPrefs);
  private readonly known = inject(KnownLanguages);
  private readonly api = inject(Api);
  protected readonly auth = inject(Auth);

  protected readonly uiLanguage = UI_LANGUAGE;
  /** The posting default language, once fetched (bare code) — an inferred signal. */
  protected readonly postingLang = signal('');
  protected readonly postingLanguageOptions = POSTING_LANGUAGE_OPTIONS;
  protected readonly savingPostingLanguage = signal(false);
  protected readonly postingLanguageSaved = signal(false);
  /** Which language the "add" picker currently has selected. */
  protected readonly toAdd = signal<string>('');

  /** Browser locale chain (deduped bare codes), for the "inferred from" list. */
  protected readonly browserLangs: string[] = (() => {
    const list = navigator.languages?.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
    return [...new Set(list.map((c) => c.toLowerCase().split(/[-_]/)[0]))];
  })();

  /** Everything the filter considers "known", for the summary chips. */
  protected readonly knownCodes = computed(() => [...this.known.codes()].sort());

  /** Picker options minus anything already explicitly listed. */
  protected readonly addable = computed(() => {
    const have = new Set(this.prefs.knownLanguages());
    return PICKER_ORDER.filter((c) => !have.has(c));
  });

  // --- languages I'm learning (i18n sprint 2) ---

  /** Which language the learning picker currently has selected. */
  protected readonly toLearn = signal<string>('');

  /**
   * Learning-picker options.
   *
   * Excludes what is already being learned, but deliberately **not** what is already
   * "known": the inferred known set contains the browser locale chain, and someone
   * whose browser reports Icelandic may still be learning it. Adding it moves it out
   * of known (see `ClientPrefs.addLearningLanguage`), which is the honest resolution
   * of that overlap rather than hiding the option.
   */
  protected readonly learnable = computed(() => {
    const already = new Set(this.prefs.learningLanguages());
    return PICKER_ORDER.filter((c) => !already.has(c));
  });

  protected addLearning(): void {
    const code = this.toLearn();
    if (code) {
      this.prefs.addLearningLanguage(code);
      this.toLearn.set('');
    }
  }

  protected removeLearning(code: string): void {
    this.prefs.removeLearningLanguage(code);
  }

  protected toggleAppend(code: string, append: boolean): void {
    this.prefs.setAppendTranslation(code, append);
  }

  ngOnInit(): void {
    // Posting default language is a server-side "you know this" signal. Fetch it
    // (skip for the anonymous browser-local account, which has no credentials)
    // and fold it into the explicit list so it survives offline too.
    if (!this.auth.isAnonymous) {
      this.api.verifyCredentials().subscribe({
        next: (acc) => {
          const lang = acc.source?.language?.toLowerCase().split(/[-_]/)[0] ?? '';
          this.postingLang.set(lang);
          if (lang) {
            this.prefs.addKnownLanguage(lang);
          }
        },
        error: () => this.postingLang.set(''),
      });
    }
  }

  // --- translation budgets (i18n sprint 1) ---

  protected readonly usage = inject(TranslationUsage);
  protected readonly engines = TRANSLATION_ENGINES;
  protected readonly engineLabels = ENGINE_LABELS;

  /**
   * Draft limit values, per engine, while someone is typing.
   *
   * Bound to the inputs rather than writing straight through to the store, because
   * `setLimits` clamps a soft limit up to the hard one — applying that on every
   * keystroke rewrites the number under the cursor as you type "100" through "1".
   */
  protected readonly draftLimits = signal<
    Record<TranslationEngine, { soft: string; hard: string }>
  >({
    mastodon: {
      soft: `${this.usage.softLimit('mastodon')}`,
      hard: `${this.usage.hardLimit('mastodon')}`,
    },
    openrouter: {
      soft: `${this.usage.softLimit('openrouter')}`,
      hard: `${this.usage.hardLimit('openrouter')}`,
    },
  });

  protected setDraft(engine: TranslationEngine, field: 'soft' | 'hard', value: string): void {
    this.draftLimits.update((all) => ({ ...all, [engine]: { ...all[engine], [field]: value } }));
  }

  protected saveLimits(engine: TranslationEngine): void {
    const draft = this.draftLimits()[engine];
    const soft = Number(draft.soft);
    const hard = Number(draft.hard);
    if (!Number.isFinite(soft) || !Number.isFinite(hard)) {
      return;
    }
    this.usage.setLimits(engine, soft, hard);
    // Reflect whatever the store actually kept, so a clamped value is visible rather
    // than leaving the box showing a number that was never saved.
    this.setDraft(engine, 'soft', `${this.usage.softLimit(engine)}`);
    this.setDraft(engine, 'hard', `${this.usage.hardLimit(engine)}`);
  }

  protected resetUsage(engine: TranslationEngine): void {
    this.usage.reset(engine);
  }

  name(code: string): string {
    return LANG_NAMES[code as LangCode] ?? code.toUpperCase();
  }

  add(): void {
    const code = this.toAdd();
    if (code) {
      this.prefs.addKnownLanguage(code);
      this.toAdd.set('');
    }
  }

  remove(code: string): void {
    this.prefs.removeKnownLanguage(code);
  }

  toggleExclude(on: boolean): void {
    this.prefs.setExcludeUnknownLangTrends(on);
  }

  savePostingLanguage(): void {
    if (this.savingPostingLanguage()) return;
    this.savingPostingLanguage.set(true);
    this.postingLanguageSaved.set(false);
    const form = new FormData();
    form.append('source[language]', this.postingLang());
    this.api.updateCredentials(form).subscribe({
      next: () => {
        this.savingPostingLanguage.set(false);
        this.postingLanguageSaved.set(true);
        if (this.postingLang()) this.prefs.addKnownLanguage(this.postingLang());
      },
      error: () => this.savingPostingLanguage.set(false),
    });
  }
}
