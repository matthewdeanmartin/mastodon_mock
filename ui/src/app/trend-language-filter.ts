import { computed, inject, Injectable, Signal } from '@angular/core';
import { ClientPrefs } from './client-prefs';
import { detectScriptLanguage } from './language-detect';
import { Tag } from './models';

/** The interface language the app currently ships in. A constant today; will
 *  become a real user setting when the UI is localized. */
export const UI_LANGUAGE = 'en';

/** Normalize a possibly-regioned tag ("en-US", "pt_BR") to a bare ISO 639-1 code. */
function bare(code: string): string {
  return code.toLowerCase().split(/[-_]/)[0];
}

/**
 * The set of languages we believe the user knows, aggregated from every signal
 * the app can see without asking. Mastodon leaks language knowledge in three
 * places, and we mirror all of them:
 *
 *   1. **Interface language** — what the UI is rendered in ({@link UI_LANGUAGE}),
 *      plus the browser's `navigator.languages` (the OS/browser locale chain).
 *   2. **Posting default language** — pushed into `knownLanguages` by the caller
 *      that reads `source.language` (kept as an explicit entry so it survives
 *      even if the account/API isn't reachable later).
 *   3. **Explicit choices** — the future "public timeline languages" checkbox
 *      list, stored in {@link ClientPrefs.knownLanguages}.
 *
 * The result is always non-empty (UI language is a floor), so the trending
 * filter can never hide *everything* by accident.
 */
@Injectable({ providedIn: 'root' })
export class KnownLanguages {
  private prefs = inject(ClientPrefs);

  /** Browser locale chain, computed once (it doesn't change within a session). */
  private readonly browserLangs: string[] = (() => {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const list = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
    return list.map(bare);
  })();

  /** ISO 639-1 codes the user is assumed to know. Reactive to the prefs list. */
  readonly codes: Signal<Set<string>> = computed(() => {
    const set = new Set<string>([UI_LANGUAGE, ...this.browserLangs]);
    for (const c of this.prefs.knownLanguages()) {
      set.add(bare(c));
    }
    return set;
  });

  knows(code: string): boolean {
    return this.codes().has(bare(code));
  }
}

/**
 * Filters trending hashtags down to languages the user can actually read.
 *
 * The rule, deliberately conservative: **hide a tag only when we are *sure* it
 * is a language the user hasn't listed.** Certainty comes from
 * {@link detectScriptLanguage}, which only commits on non-Latin scripts — so
 * "#東京" is dropped for a non-Japanese reader, while "#Eurovision" (Latin,
 * undetermined) is always kept. When the toggle is off, nothing is filtered.
 *
 * Applied centrally in `Api.trendingTags()` so every surface that shows trending
 * tags (left rail, Explore, Search) inherits it with no per-page wiring.
 */
@Injectable({ providedIn: 'root' })
export class TrendLanguageFilter {
  private prefs = inject(ClientPrefs);
  private known = inject(KnownLanguages);

  /** Whether a single tag should be shown given the current settings. */
  shouldShow(tag: Tag): boolean {
    if (!this.prefs.excludeUnknownLangTrends()) {
      return true;
    }
    // Strip a leading '#' if present; detect on the bare name.
    const lang = detectScriptLanguage(tag.name.replace(/^#/, ''));
    if (!lang || lang === 'und') {
      return true; // undetermined ⇒ keep
    }
    return this.known.knows(lang);
  }

  /** Filter a list of tags, preserving order. */
  apply(tags: Tag[]): Tag[] {
    if (!this.prefs.excludeUnknownLangTrends()) {
      return tags;
    }
    return tags.filter((t) => this.shouldShow(t));
  }
}
