import { computed, inject, Injectable, Signal } from '@angular/core';
import { ClientPrefs } from './client-prefs';
import { detectLanguage, detectScriptCandidates } from './language-detect';
import { Status, Tag } from './models';
import { stripHtml } from './sentiment';

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
    const candidates = detectScriptCandidates(tag.name.replace(/^#/, ''));
    if (!candidates.length) {
      return true; // undetermined ⇒ keep
    }
    // Keep if the user knows ANY candidate language. For bare Han the candidates
    // are [zh, ja], so it's hidden only from someone who knows neither — which
    // is exactly the case a monolingual-English reader hits with kanji trends.
    return candidates.some((lang) => this.known.knows(lang));
  }

  /** Filter a list of tags, preserving order. */
  apply(tags: Tag[]): Tag[] {
    if (!this.prefs.excludeUnknownLangTrends()) {
      return tags;
    }
    return tags.filter((t) => this.shouldShow(t));
  }
}

/**
 * Minimum characters of stripped text before we trust content-based detection
 * of a post's language. Below this, a post is "too short to tell" and we defer
 * entirely to its declared language.
 */
const MIN_TEXT_FOR_DETECTION = 20;
/**
 * Minimum share the top detected language must hold for detection to count as
 * *confident*. Mixed or ambiguous text stays undetermined and is never hidden.
 */
const CONFIDENT_SHARE = 0.6;

/** Why a post was hidden (for diagnostics / tests). */
export type HideReason = 'foreign' | 'misrepresented';

/**
 * Removes feed posts by language, for Home and Algo. The product rule, stated
 * precisely and matching the "language toggle" the user asked for:
 *
 *   Anything goes, EXCEPT posts we can identify *for sure* as either
 *     (a) **foreign** — a language the user has said they don't know, or
 *     (b) **misrepresented** — the post declares one language but its text is
 *         confidently a different one (the classic "tagged en, actually es").
 *
 * The overriding constraint: **never hide a post we're unsure about.** Language
 * ID is hard; when it's hard, we don't guess on the user's behalf. Concretely:
 *   - No declared language and text too short/ambiguous to detect → keep.
 *   - Declared language the user knows → keep (we don't police honesty upward).
 *   - Confident detection only counts when the text is long enough and one
 *     language clearly dominates ({@link CONFIDENT_SHARE}).
 */
@Injectable({ providedIn: 'root' })
export class FeedLanguageFilter {
  private prefs = inject(ClientPrefs);
  private known = inject(KnownLanguages);

  /**
   * The languages a post is allowed to be in: the explicit narrowed set when
   * one is chosen, otherwise everything the user knows.
   *
   * Narrowing is the "I follow 400 people and want only Esperanto today" case.
   * It never *widens* — a language outside the known set can still be selected
   * (you might be learning it), which is why this reads the pref directly
   * rather than intersecting with {@link KnownLanguages}.
   */
  private allowed(): Set<string> {
    const chosen = this.prefs.feedLanguages();
    return chosen.length ? new Set(chosen.map(bare)) : this.known.codes();
  }

  /**
   * A *confident* single language for a post's text, or null when the text is
   * too short or too mixed to be sure. Uses the full lexical detector (posts,
   * unlike tags, carry enough words for the stop-word tier).
   */
  private confidentTextLanguage(text: string): string | null {
    if (text.length < MIN_TEXT_FOR_DETECTION) {
      return null;
    }
    const [top] = detectLanguage(text);
    if (!top || top.lang === 'und' || top.share < CONFIDENT_SHARE) {
      return null;
    }
    return top.lang;
  }

  /**
   * Why this post should be hidden, or null to keep it. Exposed (rather than a
   * bare boolean) so callers can log the reason and tests can assert it.
   */
  hideReason(status: Status): HideReason | null {
    if (!this.prefs.hideForeignLangPosts()) {
      return null;
    }
    const target = status.reblog ?? status;
    const declared = target.language?.toLowerCase().split(/[-_]/)[0] || null;
    const detected = this.confidentTextLanguage(stripHtml(target.content));

    // A language you are *learning* is never hidden, whatever the toggle says.
    //
    // This is the one place the learner rule has to live, because hiding happens before
    // anything else gets a chance to look at the post: filtering away the Icelandic
    // posts from someone learning Icelandic removes exactly the material they follow
    // those accounts for. It applies even with no translation feature switched on —
    // "show me this language" is useful by itself.
    //
    // Checked against both the declared and the detected language, and deliberately
    // *before* the misrepresentation branch: a post mislabelled `en` whose text is
    // confidently Esperanto is still Esperanto practice, and the mislabelling is the
    // poster's mistake rather than a reason to withhold it from a learner.
    if (
      (declared && this.prefs.isLearning(declared)) ||
      (detected && this.prefs.isLearning(detected))
    ) {
      return null;
    }

    // (b) Misrepresentation: declares one language, text is confidently another.
    if (declared && detected && declared !== detected) {
      return 'misrepresented';
    }

    // (a) Foreign: the post's effective language is one the user doesn't know.
    // A declared language is trusted as-is; otherwise fall back to confident
    // detection. If we have neither, we don't know — so we keep it.
    const effective = declared ?? detected;
    if (effective && !this.allowed().has(bare(effective))) {
      return 'foreign';
    }
    return null;
  }

  shouldShow(status: Status): boolean {
    return this.hideReason(status) === null;
  }

  /** Filter a list of statuses, preserving order. */
  apply(statuses: Status[]): Status[] {
    if (!this.prefs.hideForeignLangPosts()) {
      return statuses;
    }
    return statuses.filter((s) => this.shouldShow(s));
  }

  /**
   * The language a post is effectively in, or null when we aren't sure.
   *
   * Same derivation {@link hideReason} uses — declared language first, confident
   * detection second, null when neither commits. Shared so that "which posts get
   * hidden" and "which posts get translated" can never drift apart in their idea of
   * what language a post is in.
   */
  effectiveLanguage(status: Status): string | null {
    const target = status.reblog ?? status;
    const declared = target.language?.toLowerCase().split(/[-_]/)[0] || null;
    return declared ?? this.confidentTextLanguage(stripHtml(target.content));
  }
}

/** Why a post is not eligible for automatic translation, for diagnostics and tests. */
export type SkipReason =
  /** Automatic translation is switched off entirely. */
  | 'mode-off'
  /** We can't tell what language it's in — so it's probably English. */
  | 'undetermined'
  /** The reader already reads this language. */
  | 'known'
  /** Not a language being learned, and translate-all is off. */
  | 'not-learning';

/**
 * Decides which posts automatic translation should spend a call on.
 *
 * Separate from {@link FeedLanguageFilter} because the questions are different — that
 * one decides what you see, this one decides what gets paid for — but built on its
 * language derivation so the two always agree about what language a post is in.
 *
 * The rules, in the order they are checked:
 *
 *   1. **Mode off** ⇒ never. The default, and the only state that costs nothing.
 *   2. **Undetermined** ⇒ never. `FeedLanguageFilter` already refuses to guess below
 *      its confidence threshold, and this inherits that refusal. An undetermined post
 *      is overwhelmingly likely to be English, and translating English into English is
 *      a call spent to change nothing.
 *   3. **Known** ⇒ never. You already read it.
 *   4. **Learning** ⇒ yes. The point of the feature.
 *   5. Anything else ⇒ only when the `$$$` translate-all switch is on.
 */
@Injectable({ providedIn: 'root' })
export class AutoTranslateEligibility {
  private prefs = inject(ClientPrefs);
  private known = inject(KnownLanguages);
  private filter = inject(FeedLanguageFilter);

  /** Why this post should not be auto-translated, or null when it should be. */
  skipReason(status: Status): SkipReason | null {
    if (this.prefs.autoTranslateMode() === 'off') {
      return 'mode-off';
    }
    const language = this.filter.effectiveLanguage(status);
    if (!language) {
      return 'undetermined';
    }
    // Learning is checked before known so that a language somehow in both lists still
    // gets translated. `addLearningLanguage` prevents that overlap, but a hand-edited
    // prefs blob can produce it, and silently translating nothing would be the more
    // confusing failure.
    if (this.prefs.isLearning(language)) {
      return null;
    }
    if (this.known.knows(language)) {
      return 'known';
    }
    return this.prefs.translateAllForeign() ? null : 'not-learning';
  }

  shouldTranslate(status: Status): boolean {
    return this.skipReason(status) === null;
  }

  /**
   * Whether this post's translation appends below the original rather than replacing
   * it. Only learning languages append — a `$$$` translate-all post is one the reader
   * has no interest in learning, so the original is noise to them.
   */
  appends(status: Status): boolean {
    const language = this.filter.effectiveLanguage(status);
    return !!language && this.prefs.isLearning(language) && this.prefs.appendsTranslation(language);
  }
}
