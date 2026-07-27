import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { ClientPrefs } from '../../../client-prefs';
import { LANG_NAMES, LangCode } from '../../../language-detect';
import { KnownLanguages, UI_LANGUAGE } from '../../../trend-language-filter';

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
  private readonly auth = inject(Auth);

  protected readonly uiLanguage = UI_LANGUAGE;
  /** The posting default language, once fetched (bare code) — an inferred signal. */
  protected readonly postingLang = signal<string | null>(null);
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

  ngOnInit(): void {
    // Posting default language is a server-side "you know this" signal. Fetch it
    // (skip for the anonymous browser-local account, which has no credentials)
    // and fold it into the explicit list so it survives offline too.
    if (!this.auth.isAnonymous) {
      this.api.verifyCredentials().subscribe({
        next: (acc) => {
          const lang = acc.source?.language?.toLowerCase().split(/[-_]/)[0] ?? null;
          this.postingLang.set(lang);
          if (lang) {
            this.prefs.addKnownLanguage(lang);
          }
        },
        error: () => this.postingLang.set(null),
      });
    }
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
}
