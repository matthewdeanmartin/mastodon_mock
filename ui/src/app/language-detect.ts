/**
 * A deliberately cheap, synchronous, dependency-free language detector.
 *
 * Real language ID (CLD3, fastText, franc's full model) means shipping a model
 * and running n-gram scoring. This does not: it decides by *script* first
 * (Unicode ranges are free and settle most of the world's languages outright),
 * then by *diacritic fingerprint* for Latin text, then by a compact *stop-word*
 * table for plain Latin scripts that share the same alphabet. It is meant to be
 * called pervasively — over every post in a sample, inline in a list — so the
 * budget is "a few string scans", not "load a classifier".
 *
 * It will be wrong sometimes; that's the accepted trade, in the same spirit as
 * the rage lexicon in `sentiment.ts`. Output is always a *distribution* so a
 * caller can say "70% English, 30% German, 1% unknown" honestly, rather than
 * pretending to a single confident verdict.
 *
 * The first consumer is the analytics page. Because it is a pure function over
 * text, it can later back search filters, per-post language badges, translation
 * prompts, etc. — keep the contract stable.
 */

/** ISO 639-1 codes this module can name. `und` = undetermined. */
export type LangCode =
  | 'en'
  | 'de'
  | 'fr'
  | 'es'
  | 'pt'
  | 'it'
  | 'nl'
  | 'sv'
  | 'da'
  | 'no'
  | 'fi'
  | 'pl'
  | 'tr'
  | 'ru'
  | 'uk'
  | 'el'
  | 'ja'
  | 'ko'
  | 'zh'
  | 'ar'
  | 'he'
  | 'hi'
  | 'th'
  | 'eo'
  // Nameable and selectable, but with no lexical rules below: the detector has never
  // claimed to identify it, and adding the name does not change that. An Icelandic post
  // therefore stays "undetermined" unless it declares `is` — which is the safe way
  // round, since undetermined is never hidden.
  | 'is'
  | 'und';

/** One language's share of a text, 0–1. */
export interface LangShare {
  lang: LangCode;
  /** Fraction of the analyzed text attributed to this language (0–1). */
  share: number;
}

/** Human-facing names for the codes we emit, for UI labels. */
export const LANG_NAMES: Record<LangCode, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  nl: 'Dutch',
  sv: 'Swedish',
  da: 'Danish',
  no: 'Norwegian',
  fi: 'Finnish',
  pl: 'Polish',
  tr: 'Turkish',
  ru: 'Russian',
  uk: 'Ukrainian',
  el: 'Greek',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  he: 'Hebrew',
  hi: 'Hindi',
  th: 'Thai',
  eo: 'Esperanto',
  is: 'Icelandic',
  und: 'Unknown',
};

/** Named languages that can be selected as a posting default. */
export const POSTING_LANGUAGE_OPTIONS = (Object.entries(LANG_NAMES) as [LangCode, string][])
  .filter(([code]) => code !== 'und')
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------
// Tier 1: script detection (Unicode ranges)
// ---------------------------------------------------------------------------

/**
 * Non-Latin scripts that map cleanly (or near enough) to one language for our
 * purposes. Han is special-cased below because Japanese mixes kanji with kana.
 */
const SCRIPT_RANGES: { lang: LangCode; re: RegExp }[] = [
  { lang: 'ja', re: /[぀-ゟ゠-ヿ]/ }, // Hiragana + Katakana ⇒ Japanese
  { lang: 'ko', re: /[가-힯ᄀ-ᇿ]/ }, // Hangul
  { lang: 'el', re: /[Ͱ-Ͽ]/ }, // Greek
  { lang: 'ru', re: /[Ѐ-ӿ]/ }, // Cyrillic (defaults to Russian; uk refined below)
  { lang: 'ar', re: /[؀-ۿ]/ }, // Arabic
  { lang: 'he', re: /[֐-׿]/ }, // Hebrew
  { lang: 'hi', re: /[ऀ-ॿ]/ }, // Devanagari ⇒ Hindi
  { lang: 'th', re: /[฀-๿]/ }, // Thai
];

const HAN_RE = /[一-鿿]/; // CJK Unified Ideographs
const KANA_RE = /[぀-ゟ゠-ヿ]/;
/** Cyrillic letters unique to Ukrainian (ї, і, є, ґ) disambiguate ru vs uk. */
const UKRAINIAN_RE = /[іїєґ]/i;

/**
 * Classify a single non-Latin character run's script. Returns null if the
 * character is Latin/ASCII/punctuation (handled by the Latin path instead).
 */
function scriptFor(ch: string): LangCode | null {
  if (KANA_RE.test(ch)) {
    return 'ja';
  }
  if (HAN_RE.test(ch)) {
    // Han without kana is ambiguous; treat as Chinese. (A doc that also has
    // kana is caught by the kana rule and attributed to Japanese overall.)
    return 'zh';
  }
  for (const { lang, re } of SCRIPT_RANGES) {
    if (re.test(ch)) {
      return lang;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 2: diacritic fingerprints (Latin scripts)
// ---------------------------------------------------------------------------

/**
 * Characters that strongly bias a Latin-script guess toward one language.
 * These are hints layered on top of the stop-word vote, not verdicts — plenty
 * of languages share `é`/`ü`, so only distinctive marks carry weight.
 */
const DIACRITIC_HINTS: { lang: LangCode; re: RegExp; weight: number }[] = [
  { lang: 'de', re: /[äöüß]/i, weight: 2 }, // ß is nearly unique to German
  { lang: 'sv', re: /[åä]/i, weight: 1 },
  { lang: 'da', re: /[æø]/i, weight: 2 },
  { lang: 'no', re: /[æø]/i, weight: 1 },
  { lang: 'fi', re: /[äö]/i, weight: 1 },
  { lang: 'es', re: /[ñ¿¡]/i, weight: 2 },
  { lang: 'pt', re: /[ãõ]/i, weight: 2 },
  { lang: 'fr', re: /[àâçèêëîïôùûœ]/i, weight: 1 },
  { lang: 'pl', re: /[ąćęłńóśźż]/i, weight: 2 },
  { lang: 'tr', re: /[ğışİ]/i, weight: 2 },
  { lang: 'it', re: /[àèìòù]/i, weight: 1 },
  // The six supersigned letters are Esperanto's alone among living languages.
  // Weighted heavily: unlike é or ü, seeing one is close to proof, and without
  // this an Esperanto post loses the stop-word vote to French (both use "la",
  // "de", "en") despite carrying letters French does not have.
  { lang: 'eo', re: /[ĉĝĥĵŝŭ]/i, weight: 4 },
];

// ---------------------------------------------------------------------------
// Tier 3: stop-word tables (top function words per Latin-script language)
// ---------------------------------------------------------------------------

/**
 * The highest-frequency function words per language. Seeing many of these is
 * the classic cheap signal ("lots of the/of/and ⇒ English"). Kept compact —
 * ~20–30 words each — because this runs per post.
 *
 * **A word that appears in more than one table does not vote.** See
 * {@link DISCRIMINATING_WORDS}. These tables may therefore contain collisions
 * freely: "in" can stay under both `en` and `de`, and simply stops counting. That
 * keeps each table a readable list of a language's common words rather than a
 * hand-pruned set that must be re-audited whenever a language is added.
 */
const STOP_WORDS: Partial<Record<LangCode, string[]>> = {
  en: [
    'the',
    'of',
    'and',
    'to',
    'in',
    'is',
    'you',
    'that',
    'it',
    'for',
    'was',
    'on',
    'are',
    'with',
    'as',
    'this',
    'have',
    'from',
    'they',
    'be',
    'at',
    'not',
    'but',
    'what',
    'all',
    'were',
    'we',
    'when',
    'your',
    'can',
  ],
  de: [
    'der',
    'die',
    'und',
    'in',
    'den',
    'von',
    'zu',
    'das',
    'mit',
    'sich',
    'des',
    'auf',
    'für',
    'ist',
    'im',
    'dem',
    'nicht',
    'ein',
    'eine',
    'als',
    'auch',
    'es',
    'an',
    'werden',
    'aus',
    'er',
    'hat',
    'dass',
    'sie',
    'nach',
  ],
  fr: [
    'le',
    'la',
    'les',
    'de',
    'des',
    'un',
    'une',
    'et',
    'est',
    'que',
    'qui',
    'dans',
    'pour',
    'pas',
    'sur',
    'au',
    'avec',
    'ne',
    'se',
    'ce',
    'il',
    'elle',
    'nous',
    'vous',
    'plus',
    'par',
    'je',
    'mais',
    'ou',
    'son',
  ],
  es: [
    'el',
    'la',
    'los',
    'las',
    'de',
    'que',
    'y',
    'en',
    'un',
    'una',
    'por',
    'con',
    'no',
    'una',
    'su',
    'para',
    'es',
    'se',
    'del',
    'al',
    'lo',
    'como',
    'más',
    'pero',
    'sus',
    'le',
    'ya',
    'este',
    'sí',
    'porque',
  ],
  pt: [
    'de',
    'que',
    'não',
    'os',
    'as',
    'um',
    'uma',
    'para',
    'com',
    'por',
    'se',
    'na',
    'no',
    'dos',
    'das',
    'mais',
    'como',
    'mas',
    'ao',
    'ele',
    'das',
    'seu',
    'sua',
    'ou',
    'quando',
    'muito',
    'já',
    'está',
    'também',
    'pelo',
  ],
  it: [
    'il',
    'di',
    'che',
    'la',
    'le',
    'un',
    'una',
    'in',
    'per',
    'con',
    'non',
    'sono',
    'gli',
    'del',
    'della',
    'da',
    'si',
    'come',
    'più',
    'ma',
    'anche',
    'lo',
    'se',
    'ci',
    'ha',
    'al',
    'nel',
    'sono',
    'questo',
    'io',
  ],
  nl: [
    'de',
    'het',
    'een',
    'van',
    'en',
    'in',
    'te',
    'dat',
    'op',
    'voor',
    'met',
    'zijn',
    'niet',
    'aan',
    'er',
    'maar',
    'om',
    'ook',
    'als',
    'dan',
    'ze',
    'zo',
    'door',
    'over',
    'ze',
    'nog',
    'wordt',
    'naar',
    'is',
    'ik',
  ],
  sv: [
    'och',
    'att',
    'det',
    'som',
    'en',
    'på',
    'är',
    'av',
    'för',
    'med',
    'till',
    'den',
    'har',
    'de',
    'inte',
    'om',
    'ett',
    'men',
    'var',
    'jag',
    'sig',
    'så',
    'kan',
    'man',
    'när',
    'vi',
    'nu',
    'han',
    'från',
    'eller',
  ],
  pl: [
    'nie',
    'to',
    'się',
    'na',
    'że',
    'jest',
    'do',
    'co',
    'jak',
    'ale',
    'tak',
    'za',
    'od',
    'być',
    'czy',
    'już',
    'tylko',
    'przez',
    'dla',
    'ten',
    'oraz',
    'jego',
    'jej',
    'tego',
    'ich',
    'przy',
    'bardzo',
    'gdy',
    'więc',
    'lub',
  ],
  // Esperanto. Chosen for *discrimination*, not raw frequency: "la", "de",
  // "en", "por", "kun", "al" are all shared with Spanish, French or Italian and
  // would hand those languages free votes. The high-value entries are the ones
  // no Romance language has — the -as/-is/-os verb endings of esti, the
  // ki-/ti-/ĉi- correlatives, and the accusative pronouns in -n.
  eo: [
    'kaj',
    'estas',
    'estis',
    'estos',
    'oni',
    'ĉi',
    'tio',
    'tiu',
    'kiu',
    'kio',
    'kiel',
    'kiam',
    'kie',
    'ĉiu',
    'ĉio',
    'ankaŭ',
    'nur',
    'sed',
    'aŭ',
    'ne',
    'jes',
    'mi',
    'vi',
    'li',
    'ŝi',
    'ĝi',
    'ni',
    'ili',
    'min',
    'lin',
    'ĝin',
    'ilin',
    'sia',
    'siaj',
    'esti',
    'havas',
    'povas',
    'devas',
    'iĝas',
    'pri',
    'per',
    'sen',
    'tre',
    'jam',
    'nun',
    'tamen',
    'ĉar',
    'ke',
    'ol',
  ],
};

/**
 * Words that belong to exactly one language's table, mapped to that language.
 *
 * ## Why ambiguous words are dropped rather than shared
 *
 * The previous scheme gave a full vote to *every* language containing a word, on the
 * theory that the right answer would still collect the most hits. It does win — but the
 * losers keep their votes, and shares are computed from the total, so a correct answer
 * arrives diluted and surrounded by languages that were never plausible.
 *
 * Measured on this app's own tables, that was not a rounding error. Of 269 stop words,
 * 36 collide, and they are concentrated in the highest-frequency slots: "de" is in five
 * tables, "in" in four, "la"/"le"/"un"/"que"/"se" across the Romance block. The effect
 * on real text:
 *
 *   "this is a good example of what we can do with it"  →  en:80 **nl:10 pl:10**
 *   "el gato esta en la casa y no se por que..."        →  es:44 **pt:19 fr:15 it:11**
 *
 * A fifth of a plainly-English sentence attributed to Dutch and Polish is not a
 * cosmetic problem: `FeedLanguageFilter` gates on a 0.6 share, so dilution turns
 * confident text into "uncertain" and the analytics page reports languages the user has
 * never written a word of.
 *
 * A word in two tables cannot discriminate between them — that is what ambiguity means —
 * so counting it adds noise to both and information to neither. Dropping it costs only
 * the words that were never evidence. What remains is each language's *exclusive*
 * vocabulary, which is what a vote should be counted on.
 *
 * The cost is real and accepted: a language whose common words are mostly shared (the
 * Romance block) has fewer signals left, so short Romance texts more often come back
 * undetermined. That is the trade the user asked for and the right one for this app —
 * "we don't know" is a safe answer everywhere it is consumed (undetermined text is never
 * hidden and never auto-translated), while "this English is Dutch" is not.
 */
/**
 * Words that are common in a language whose table does not happen to list them.
 *
 * Comparing tables catches a word claimed by two languages, but not a word claimed by
 * one and merely *frequent* in another. Those are the more damaging case, because the
 * table comparison certifies them as exclusive evidence:
 *
 *   "do"   is a Polish preposition, and one of the commonest verbs in English
 *   "an"   is a German article, and the English indefinite article
 *   "over" is Dutch, and an everyday English word
 *   "come" is Italian, and an everyday English word
 *   "man"  is Swedish, and an everyday English word
 *
 * Each was voting for a language the text was not in — "do" alone put ~10% Polish on
 * every English sentence containing it, because English's own table omits it.
 *
 * Listing them here rather than adding them to the English table is deliberate: they
 * should count for *nobody*. Adding "do" to `en` would make it ambiguous and drop it,
 * which is the same outcome by a longer route — but it would also imply "do" is useful
 * English evidence, and the next person to prune the English table might re-remove it
 * and silently restore this bug.
 *
 * This list is necessarily incomplete; it holds the cases measured against real text.
 * The rule for adding one: a word that a language's table claims exclusively, but that
 * a reader of another language would use without noticing.
 */
const HOMOGRAPHS = new Set([
  // Claimed by another table, common in English.
  'do',
  'an',
  'over',
  'come',
  'man',
  // Polish "ich" (their) is also the German word for "I" — one of the most frequent
  // words in German, and absent from its table, so it was scoring German text as
  // partly Polish.
  'ich',
]);

const DISCRIMINATING_WORDS = (() => {
  const owners = new Map<string, Set<LangCode>>();
  for (const [lang, words] of Object.entries(STOP_WORDS) as [LangCode, string[]][]) {
    for (const w of words) {
      const set = owners.get(w);
      if (set) {
        set.add(lang);
      } else {
        owners.set(w, new Set([lang]));
      }
    }
  }
  const map = new Map<string, LangCode>();
  for (const [word, langs] of owners) {
    if (langs.size === 1 && !HOMOGRAPHS.has(word)) {
      map.set(word, [...langs][0]);
    }
  }
  return map;
})();

// ---------------------------------------------------------------------------
// Tier 2b: language-exclusive letters (for short strings like hashtags)
// ---------------------------------------------------------------------------

/**
 * Letters used by **exactly one** language among the ones this module names, so
 * a single occurrence pins the language down without any lexical context. This
 * is intentionally far more conservative than {@link DIACRITIC_HINTS}: those are
 * *biases* that vote alongside stop-words (é, ü, à are shared by many
 * languages), whereas these are near-*proofs* usable on a lone word.
 *
 * The bar for inclusion: no other language in {@link LangCode} uses the letter
 * in normal orthography. That rules out the whole Scandinavian set (å/ä/ö/ø/æ
 * are shared across sv/da/no/fi) and most French/Italian accents (shared with
 * Portuguese/Spanish/…), so those languages get no exclusive-letter signal —
 * which is the correct, cautious outcome, not an omission.
 *
 * Kept letters and why they're safe:
 *  - de `ß`         — the eszett exists in no other language here.
 *  - es `ñ ¿ ¡`     — inverted marks are Spanish; ñ isn't used by any other
 *                     listed language (pt uses nh, not ñ).
 *  - pt `ã õ`       — nasal a/o tildes; Spanish uses ñ, not ã/õ.
 *  - pl `ł ż ź ą ę` — Polish-specific hooks/strokes; not in cz/sk (absent here).
 *  - tr `ı İ ğ`     — dotless i, dotted capital I, and soft g are Turkish.
 *
 * Ordering matters only if a string somehow carried two exclusive letters from
 * different languages (e.g. a joke tag "#ßółç"): first match wins, which is
 * acceptable for such pathological input.
 */
const EXCLUSIVE_LETTERS: { lang: LangCode; re: RegExp }[] = [
  { lang: 'de', re: /ß/ },
  { lang: 'es', re: /[ñ¿¡]/i },
  { lang: 'pt', re: /[ãõ]/i },
  { lang: 'pl', re: /[łżźąę]/i },
  { lang: 'tr', re: /[ıİğĞ]/ }, // dotless ı, dotted İ, soft ğ/Ğ — all Turkish
  // Esperanto's circumflexed consonants and the breve ŭ. No other language
  // here uses them; ĝ is distinct from Turkish ğ (circumflex vs breve), and ĥ
  // has no counterpart at all. A single one settles a lone hashtag.
  { lang: 'eo', re: /[ĉĝĥĵŝŭ]/i },
];

/**
 * A confident language from a single exclusive letter, or null if the text
 * contains none. Latin text without any exclusive letter stays undetermined.
 */
function exclusiveLetterLanguage(text: string): LangCode | null {
  for (const { lang, re } of EXCLUSIVE_LETTERS) {
    if (re.test(text)) {
      return lang;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 2c: ASCII-transliterated Esperanto (x-system / h-system)
// ---------------------------------------------------------------------------

/**
 * Esperanto is routinely written without its diacritics, because keyboards
 * rarely have them. Two conventions dominate:
 *
 *  - **x-system**: `cx gx hx jx sx ux` for `ĉ ĝ ĥ ĵ ŝ ŭ`. Unambiguous in
 *    practice — `x` is not in the Esperanto alphabet at all, so these digraphs
 *    cannot occur by accident in a genuine Esperanto word.
 *  - **h-system**: `ch gh hh jh sh u` (Zamenhof's original). Far riskier to
 *    match: `ch` and `sh` are ordinary in English, German and French, so this
 *    is only counted when *other* Esperanto evidence is already present.
 *
 * Without this tier, "Mi sxatas gxin" is invisible to a detector that only
 * knows the accented forms, and posts written on a plain keyboard — the common
 * case — never register as Esperanto at all.
 */
const X_SYSTEM_RE = /\b\w*(?:cx|gx|hx|jx|sx|ux)\w*\b/gi;

/**
 * Endings that are Esperanto-*specific*, which is a much smaller set than
 * "Esperanto's endings".
 *
 * The tempting rule — nouns end -o, adjectives -a — is useless here: those are
 * precisely the Spanish, Italian and Portuguese endings too, and matching them
 * classified ordinary Spanish ("Mucho trabajo bueno pero poco dinero") as
 * Esperanto with 82% confidence. Only two families survive contact with
 * Romance:
 *
 *  - **verb tenses `-as -is -os -us`** on a stem of 3+ letters. Romance verbs
 *    do end in -as/-is (Spanish "hablas", "escribis"), so this is suggestive
 *    rather than decisive — it earns a small weight, never a verdict.
 *  - **the accusative/plural `-jn -ojn -ajn -on -an`**. The letter `j` as a
 *    plural marker, and `-n` as a case ending, exist in no Romance language.
 *    `-ojn`/`-ajn` in particular are unmistakable.
 *
 * Kept deliberately narrow. A detector that says "Esperanto" for Spanish is
 * worse than one that stays quiet: the accented and x-system tiers already
 * catch the overwhelming majority of real Esperanto posts, and this tier only
 * has to cover the diacritic-free remainder.
 */
const EO_STRONG_ENDING_RE = /^[a-z]{2,}(?:ojn|ajn|oj|aj)$/;
const EO_WEAK_ENDING_RE = /^[a-z]{3,}(?:as|is|os|us|on|an)$/;

/**
 * Count the Esperanto morphology signal in already-tokenized words: the share
 * of tokens carrying a characteristic ending, plus x-system digraphs.
 *
 * Returns a vote weight, not a verdict. A stray "las" or "vitrolas" in another
 * language would match one ending; the threshold is a *proportion* of the text
 * so isolated coincidences never carry it.
 */
function esperantoMorphologyVotes(text: string, tokens: string[]): number {
  let votes = 0;

  // x-system digraphs are near-proof on their own — x is not an Esperanto
  // letter, so "sxatas"/"gxi" is someone typing Esperanto on an ASCII keyboard.
  const xMatches = text.match(X_SYSTEM_RE);
  if (xMatches) {
    votes += 3 * xMatches.length;
  }

  if (tokens.length >= 4) {
    const strong = tokens.filter((t) => EO_STRONG_ENDING_RE.test(t)).length;
    const weak = tokens.filter((t) => EO_WEAK_ENDING_RE.test(t)).length;

    // -oj/-ajn have no Romance counterpart: even one is meaningful, and they
    // scale directly.
    votes += strong * 3;

    // Verb tenses only count as a *pattern*. Spanish will land one or two
    // ("hablas", "escribis"); a third of the text ending this way is Esperanto
    // grammar, not coincidence. Requiring both the share and an absolute floor
    // keeps a four-word fragment from tripping it.
    if (weak >= 2 && weak / tokens.length >= 0.3) {
      votes += weak;
    }
  }
  return votes;
}

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------

/** Weight of a single Mastodon-declared language code as a prior. */
const METADATA_PRIOR_WEIGHT = 3;

/** Normalize a possibly-regioned ISO code ("en-US", "pt_BR") to a bare code. */
function normalizeIso(code: string | null | undefined): LangCode | null {
  if (!code) {
    return null;
  }
  const base = code.toLowerCase().split(/[-_]/)[0];
  return base in LANG_NAMES ? (base as LangCode) : null;
}

/**
 * Detect the language distribution of a single plain-text snippet.
 *
 * `metaHint` is an authoritative-when-present prior (a Mastodon `status.language`
 * or `account.source.language`). It seeds the vote but does not veto the text:
 * a post declared `en` that is visibly all Cyrillic should still read as Russian.
 */
export function detectLanguage(text: string, metaHint?: string | null): LangShare[] {
  const votes = new Map<LangCode, number>();
  const add = (lang: LangCode, n: number) => votes.set(lang, (votes.get(lang) ?? 0) + n);

  // Tier 1: script. Count characters by script; non-Latin scripts vote per char
  // (weighted down so a stop-word-rich Latin doc isn't drowned by a few kanji).
  let latinLetters = 0;
  let ukrainianSeen = false;
  /** Set when the text carries spelling only Esperanto uses. */
  let eoProven = false;
  for (const ch of text) {
    if (UKRAINIAN_RE.test(ch)) {
      ukrainianSeen = true;
    }
    const script = scriptFor(ch);
    if (script) {
      add(script, 1);
    } else if (/[a-zA-Z]/.test(ch)) {
      latinLetters += 1;
    }
  }
  // Refine Cyrillic to Ukrainian when its unique letters appear.
  if (ukrainianSeen && votes.has('ru')) {
    add('uk', (votes.get('ru') ?? 0) + 2);
  }

  const lower = text.toLowerCase();

  // Tier 2: diacritic fingerprints (only meaningful for Latin text).
  if (latinLetters > 0) {
    for (const { lang, re, weight } of DIACRITIC_HINTS) {
      if (re.test(lower)) {
        add(lang, weight);
      }
    }

    // Tier 3: stop-word vote.
    // The character class is the *word* alphabet: anything missing here is
    // treated as a word boundary, so an omitted letter silently splits words in
    // that language and destroys its stop-word vote. Esperanto's ĉĝĥĵŝŭ were
    // missing, which turned "ĝi estas ĝusta" into fragments and handed the vote
    // to whoever else matched ("la", "de", "en" → French).
    const tokens = lower.split(/[^a-zàâäçèéêëîïôöùûüßñãõœąćęłńóśźżğışĉĝĥĵŝŭ]+/i).filter(Boolean);
    // Only words belonging to exactly one language vote; see DISCRIMINATING_WORDS.
    for (const tok of tokens) {
      const lang = DISCRIMINATING_WORDS.get(tok);
      if (lang) {
        add(lang, 1);
      }
    }

    // Tier 3b: Esperanto morphology and ASCII transliteration. Runs after the
    // stop-word vote because it is designed to *outweigh* the Romance
    // false-positives that vote on shared function words ("la", "de", "en").
    const eoVotes = esperantoMorphologyVotes(lower, tokens);
    if (eoVotes) {
      add('eo', eoVotes);
    }
    // Either kind of Esperanto-exclusive spelling counts as proof: the accented
    // letters, or the x-system digraphs that stand in for them.
    eoProven = /[ĉĝĥĵŝŭ]/i.test(lower) || X_SYSTEM_RE.test(lower);
    X_SYSTEM_RE.lastIndex = 0; // /g regex: .test() advances state, so reset it.

    // If Latin text produced no lexical signal at all, record it as latin-unknown
    // so the share math still accounts for the words (avoids false "100% en").
    const gotLatinVote = [...votes].some(([l]) => l !== 'ja' && l !== 'zh');
    if (!gotLatinVote) {
      add('und', Math.max(1, Math.round(latinLetters / 5)));
    }
  }

  // Esperanto-exclusive spelling is proof, and it changes what the *other*
  // votes mean. Esperanto shares "la", "de", "en",
  // "mi", "por" with the Romance languages, so every Esperanto sentence hands
  // free votes to French, Spanish and Italian — enough to drag eo's share under
  // a confidence bar even while it wins the vote. Once a letter no Romance
  // language possesses is on the page, those votes are known to be spurious and
  // are discounted rather than left to dilute the answer.
  //
  // Only the Romance block is touched: a genuinely mixed post (Esperanto quoted
  // inside German, say) should still report both, and German never voted on
  // "la" to begin with.
  if (eoProven && votes.has('eo')) {
    for (const romance of ['fr', 'es', 'it', 'pt'] as const) {
      const n = votes.get(romance);
      if (n) {
        votes.set(romance, n / 4);
      }
    }
  }

  // Tier 4: metadata prior — a nudge, applied last, never a veto.
  const meta = normalizeIso(metaHint);
  if (meta) {
    add(meta, METADATA_PRIOR_WEIGHT);
  }

  if (!votes.size) {
    return [{ lang: 'und', share: 1 }];
  }

  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  return [...votes.entries()]
    .map(([lang, n]) => ({ lang, share: n / total }))
    .sort((a, b) => b.share - a.share);
}

/**
 * Aggregate a language distribution across many texts (e.g. a post sample),
 * each optionally carrying its own metadata hint. Returns shares that sum to ~1,
 * sorted most-used first, with tiny slivers below `minShare` folded into `und`.
 */
export function detectLanguageMix(
  items: { text: string; meta?: string | null }[],
  minShare = 0.01,
): LangShare[] {
  const totals = new Map<LangCode, number>();
  let counted = 0;
  for (const { text, meta } of items) {
    if (!text.trim()) {
      continue;
    }
    counted += 1;
    // Weight each item equally: take its top language's full vote, spread the
    // rest — but simplest and stable is to add each item's normalized shares.
    for (const { lang, share } of detectLanguage(text, meta)) {
      totals.set(lang, (totals.get(lang) ?? 0) + share);
    }
  }
  if (!counted) {
    return [{ lang: 'und', share: 1 }];
  }

  const grand = [...totals.values()].reduce((a, b) => a + b, 0) || 1;
  let undShare = 0;
  const kept: LangShare[] = [];
  for (const [lang, sum] of totals) {
    const share = sum / grand;
    if (lang === 'und' || share < minShare) {
      undShare += share;
    } else {
      kept.push({ lang, share });
    }
  }
  if (undShare > 0) {
    kept.push({ lang: 'und', share: undShare });
  }
  return kept.sort((a, b) => b.share - a.share);
}

/** Format a share (0–1) as a whole percent, never showing 0% for a present language. */
export function sharePct(share: number): number {
  return Math.max(1, Math.round(share * 100));
}

/**
 * A *confident* single-language guess for a very short string (a hashtag, a
 * display name), based on **script and exclusive letters only** — no stop-word
 * voting, because one word is far too thin for the lexical tier and would
 * misfire wildly.
 *
 * Two tiers, both designed to commit only when practically certain:
 *  1. **Script** — kana → ja, hangul → ko, Cyrillic → ru/uk,
 *     Greek/Arabic/Hebrew/Thai/Devanagari.
 *  2. **Exclusive letters** ({@link EXCLUSIVE_LETTERS}) — a Latin string carrying
 *     a letter used by exactly one language commits to it: "#Straße" → de,
 *     "#mañana" → es, "#São" → pt, "#Łódź" → pl, "#Diyarbakır" → tr.
 *
 * Anything else Latin returns `null` ("undetermined"): "#Berlin" could be
 * German, English or anything using the plain Latin alphabet, and no single
 * exclusive letter is present, so we never claim to know.
 *
 * **Bare Han (kanji/hanzi with no kana) is deliberately treated as undetermined
 * too.** "東京" is a Japanese place name written in the same characters Chinese
 * uses — committing to `zh` would wrongly hide it from a Japanese reader. Under
 * the filter's "only hide what we're sure about" rule, ambiguous Han is kept.
 * Kana anywhere still resolves the whole string to Japanese.
 *
 * This is the basis for the trending-tag language filter, whose product rule is
 * "hide only what we're sure is a language you don't know" — `null` here means
 * "keep it".
 */
export function detectScriptLanguage(text: string): LangCode | null {
  const candidates = detectScriptCandidates(text);
  // A single candidate is a committed guess. Multiple candidates (only bare Han,
  // which is zh/ja-ambiguous) stay undetermined for this single-answer API —
  // callers that must decide between them use detectScriptCandidates directly.
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * The **set of languages** a short string's script/letters could be, most
 * likely first. Unlike {@link detectScriptLanguage} (which returns null when
 * uncertain), this exposes genuine ambiguity so callers can reason about it:
 *
 *  - kana → `['ja']`; hangul → `['ko']`; Cyrillic → `['ru']` or `['uk']`;
 *    Greek/Arabic/Hebrew/Thai/Devanagari → their single language.
 *  - **bare Han (no kana) → `['zh', 'ja']`** — the honest answer. It is one of
 *    those two, we just can't say which from characters alone. A reader who
 *    knows *neither* still can't read it (the trending filter uses exactly
 *    that); a reader who knows *either* might, so it's kept for them.
 *  - Latin with an exclusive letter → that one language; plain Latin → `[]`.
 *  - nothing scriptable (digits/punctuation) → `[]` (undetermined).
 */
export function detectScriptCandidates(text: string): LangCode[] {
  const counts = new Map<LangCode, number>();
  let ukrainian = false;
  let hasKana = false;
  let hasHan = false;
  for (const ch of text) {
    if (UKRAINIAN_RE.test(ch)) {
      ukrainian = true;
    }
    if (KANA_RE.test(ch)) {
      hasKana = true;
    }
    if (HAN_RE.test(ch)) {
      hasHan = true;
    }
    const lang = scriptFor(ch);
    if (lang) {
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
  }
  // Kana anywhere makes the whole thing unambiguously Japanese, even amid kanji.
  if (hasKana) {
    return ['ja'];
  }
  // Bare Han (no kana): genuinely ambiguous between Chinese and Japanese.
  counts.delete('zh');
  if (hasHan && !counts.size) {
    return ['zh', 'ja'];
  }
  if (!counts.size) {
    // No non-Latin script — try the Latin exclusive-letter test.
    const latin = exclusiveLetterLanguage(text);
    return latin ? [latin] : [];
  }
  let best: LangCode | null = null;
  let bestN = 0;
  for (const [lang, n] of counts) {
    if (n > bestN) {
      best = lang;
      bestN = n;
    }
  }
  if (best === 'ru' && ukrainian) {
    return ['uk'];
  }
  return best ? [best] : [];
}
