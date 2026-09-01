/**
 * Per-language rules the merge gate enforces, and the trap words it sweeps for.
 *
 * ## Why this file exists
 *
 * German was translated first, and its defects were found by *reading it
 * afterwards*: `Blockieren Sie die Amnestie` for the unblock-everyone button,
 * `Anrufe` (telephone calls) for API calls, `Zeitleiste` (a chronology widget)
 * for the timeline. Every one of those passed `make i18n` — placeholder parity
 * and coverage are necessary and nowhere near sufficient, because coverage
 * counts keys and cannot read.
 *
 * French was translated second, with a validating merge tool written *before*
 * any translating started. Nothing reached `fr.json` except through it. Same
 * total effort, far better result, because a defect rejected at the door costs
 * one retry and a defect found three days later costs a re-read of 5,700 keys.
 *
 * That tool lived in a scratch directory and was French-only. This file is the
 * same idea made per-locale and committed, so language #4 through #60 inherit
 * it instead of re-deriving it.
 *
 * ## What belongs here
 *
 * Two kinds of rule, and the difference matters:
 *
 * - `rules` are **hard gates**. A batch that violates one is rejected whole.
 *   Put a rule here only when a violation is unambiguously wrong and mechanical
 *   to detect — French's narrow no-break space, a register that must not appear
 *   at all. A rule with false positives teaches translators to work around the
 *   checker, which is how the French `<code>` exemption bug got 5 real prose
 *   keys skipped.
 *
 * - `traps` are **advisory greps**. They encode the *wrong sense* of a glossary
 *   term — the meaning a translator reaches for when the word arrives without
 *   context. A hit is not proof of a bug (`Analyseskript` is a legitimate
 *   "script"), so these never fail a build; `make i18n-traps L=xx` prints them
 *   for a human or agent to judge. This sweep found real bugs on both German
 *   passes and is worth minutes.
 *
 * A locale with no entry here still merges — it just gets placeholder, markup
 * and `max` checking, which every locale gets. Adding an entry is optional and
 * incremental: write the traps you know on day one, add more as you find them.
 */

/**
 * Exempt literal syntax before applying a typography rule.
 *
 * Code samples, URLs and HTML entities carry punctuation a reader copies
 * verbatim; French spacing does not apply inside `<code>from:handle</code>`.
 * Blanking them (rather than skipping the whole string) is what lets a prose
 * sentence containing a code sample still be checked — the French tool
 * originally failed here and agents worked around it by leaving real keys
 * untranslated.
 */
function proseOnly(value) {
  return value
    .replace(/<code>[\s\S]*?<\/code>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&(?:[a-zA-Z]+|#[0-9]+);/g, ' ')
    .replace(/\{\{\s*[\w.]+\s*\}\}/g, ' ');
}

export const LOCALE_RULES = {
  fr: {
    name: 'French',
    register: 'informal `tu` throughout — never `vous`',
    rules: [
      {
        id: 'narrow-space',
        why: 'French typography puts a narrow no-break space (U+202F) before : ; ? !',
        check(value) {
          const hits = proseOnly(value).match(/[^\s\u202f\u00a0][;?!:]/g) || [];
          // 14:30 is a clock, not a colon needing a space.
          const real = hits.filter((h) => !/\d:\d/.test(h));
          return real.length ? `missing narrow space before ${real.join(' ')}` : null;
        },
      },
      {
        id: 'ascii-apostrophe',
        why: "French elision uses U+2019 (l’, d’, qu’), never ASCII '",
        check: (value) => (/'/.test(proseOnly(value)) ? 'ASCII apostrophe' : null),
      },
      {
        id: 'formal-register',
        why: 'rule 6: informal `tu`, held across the whole file',
        check: (value) => (/\bvous\b/i.test(value) ? 'formal `vous`' : null),
      },
      {
        id: 'inclusive-endings',
        why: '`·e` endings dodge agreement instead of restructuring — see rule 7',
        check: (value) => (/·e\b/.test(value) ? 'inclusive `·e` ending' : null),
      },
    ],
    traps: {
      booster: 'Boost → partager, not booster/amplifier',
      amplifi: 'Boost → partager, not amplifier',
      poursuiv: 'Follow → suivre; poursuivre reads as pursue',
      traqu: 'Follow → suivre; traquer reads as stalk',
      nourriture: 'Feed → flux, not the food sense',
      alimentation: 'Feed → flux, not the food sense',
      poignée: 'Handle → identifiant, not a door handle',
      filetage: 'Thread → fil, not a screw thread',
      'ligne du temps': 'Timeline → fil / timeline',
      préféré: 'Favourite → favori',
      lumière: 'Light theme → Clair',
      'coup de téléphone': 'API call → requête / appel d’API',
      muet: 'Mute → masquer, not silent',
    },
  },

  de: {
    name: 'German',
    register: 'informal `du` throughout — never `Sie` as a form of address',
    rules: [
      {
        id: 'formal-register',
        why: 'rule 6: informal `du`. Note third-person sie/ihre is legitimate, so this only flags capitalised `Sie` mid-sentence',
        check(value) {
          const hit = /(?<=[a-zäöüß,] )Sie\b/.test(value);
          return hit ? 'formal `Sie`' : null;
        },
      },
    ],
    traps: {
      Anruf: 'API call → Aufruf / Anfrage; Anruf is a telephone call',
      verfolg: 'Follow → folgen; verfolgen reads as stalk/pursue',
      Zeitleiste: 'Timeline → Timeline; a Zeitleiste is a chronology widget',
      Licht: 'Light theme → Hell; Licht is illumination',
      Pasten: 'Paste → Paste; Pasten is pasta',
      Girokonto: 'current account → aktuelles Konto, not a bank account',
      'Wal\\b': 'Fail whale is a joke, never a literal whale',
      Faden: 'Thread → Thread; Faden is sewing thread',
      Futter: 'Feed → Feed; Futter is animal fodder',
      Griff: 'Handle → Handle; Griff is a grip',
    },
  },

  id: {
    name: 'Indonesian',
    register:
      'neutral-informal — `kamu`/`Anda` are both possible; hold ONE. This file uses `kamu`.',
    rules: [
      {
        id: 'formal-register',
        why: 'rule 6: register held across the file. This locale committed to `kamu`; `Anda` is the mixed-register defect German shipped.',
        check: (value) =>
          /\bAnda\b/.test(value) ? 'formal `Anda` (this locale uses `kamu`)' : null,
      },
    ],
    traps: {
      dorongan: 'Boost → the Mastodon term (see glossary), not dorongan/boost-as-encouragement',
      meningkatkan: 'Boost → re-share, not increase',
      tiang: 'Post → kiriman/postingan, never tiang (a physical pole)',
      'pos\\b': 'Post → kiriman/postingan; `pos` alone reads as mail/post office',
      'panggilan telepon': 'API call → permintaan/panggilan API, not a phone call',
      membuntuti: 'Follow → mengikuti; membuntuti reads as tailing someone',
      menguntit: 'Follow → mengikuti; menguntit is stalking',
      makanan: 'Feed → feed/umpan, never the food sense',
      'memberi makan': 'Feed → feed/umpan, never the verb "to feed"',
      benang: 'Thread → utas, not sewing thread',
      gagang: 'Handle → handle/nama pengguna, not a door handle',
      pegangan: 'Handle → handle/nama pengguna, not a grip',
      cahaya: 'Light theme → Terang, not illumination',
      ringan: 'Light theme → Terang; ringan is low-weight',
      bisu: 'Mute → bisukan is fine, but check it stays distinct from blokir',
      'garis waktu': 'Timeline → linimasa (the established Indonesian term)',
      'saring kopi': 'Filter → filter/saringan in the rule sense',
      // `paus` (lowercase) is the correct Indonesian for whale and is expected
      // in the fail-whale joke. Capitalised `Paus` mid-sentence is the Pope.
      '(?<=[a-z,] )Paus\b': 'Capitalised Paus reads as the Pope; the whale is lowercase paus',
      // The *product noun* only. Indonesian's verb "tempel/menempel" (to paste
      // something in) is correct wherever English used the verb, so match the
      // noun shapes: "sebuah tempelan", "Tempelan saya".
      tempelan: 'Paste (the pastebin item) stays "Paste"; tempelan is the pasted thing',
    },
  },

  ja: {
    name: 'Japanese',
    register: 'polite です／ます throughout — not keigo or plain form',
    rules: [],
    traps: {
      増幅: 'Boost → ブースト／再共有, not signal amplification',
      強化: 'Boost → ブースト／再共有, not strengthening',
      食べ物: 'Feed → フィード, not food',
      餌: 'Feed → フィード, not animal feed',
      追跡: 'Follow → フォロー, not pursuit/stalking',
      裁縫: 'Thread → スレッド, not sewing thread',
      ネジ: 'Thread → スレッド, not screw thread',
      電話: 'API call → APIリクエスト, not telephone call',
      光: 'Light theme → ライト, not illumination',
      重量: 'Light theme → ライト, not low weight',
      接着剤: 'Paste → Paste, not glue',
      鯨: 'Fail whale → 失敗クジラ joke, not literal whale',
    },
  },
};

/** Rules for a locale, or an empty set for one that has no entry yet. */
export function rulesFor(lang) {
  return LOCALE_RULES[lang] ?? { name: lang, rules: [], traps: {} };
}
