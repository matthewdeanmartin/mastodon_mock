import { Status } from './models';

/**
 * A tiny VADER-style "rage" detector for the Algo feed's sentiment filter.
 *
 * Engagement-ranked feeds reward inflammatory posts (outrage travels), so the
 * Algo page offers a client-side toggle that hides posts scoring above
 * {@link HEATED_THRESHOLD}. This is deliberately a lexicon, not a model:
 * `@tensorflow-models/toxicity` costs ~25 MB of network and seconds of warm-up,
 * while a word list is a few KB and synchronous. It will misfire sometimes —
 * that's the accepted trade, and the filter is opt-in and reversible.
 *
 * Scoring: weighted keyword hits, plus small boosts for shouting (many
 * ALL-CAPS words) and exclamation pile-ups — the classic cheap VADER cues.
 */

/** Rage/inflammation lexicon. Weights: 1 = heated, 2 = openly hostile. */
const RAGE_WEIGHTS = new Map<string, number>([
  // insults / contempt
  ['idiot', 2],
  ['idiots', 2],
  ['moron', 2],
  ['morons', 2],
  ['stupid', 2],
  ['dumb', 1],
  ['fool', 1],
  ['fools', 1],
  ['clown', 1],
  ['clowns', 1],
  ['loser', 2],
  ['losers', 2],
  ['pathetic', 2],
  ['scum', 2],
  ['trash', 1],
  ['garbage', 1],
  ['worthless', 2],
  // anger
  ['hate', 2],
  ['hates', 2],
  ['hatred', 2],
  ['furious', 2],
  ['rage', 2],
  ['enraged', 2],
  ['angry', 1],
  ['outrage', 2],
  ['outraged', 2],
  ['outrageous', 2],
  ['disgusting', 2],
  ['disgusted', 2],
  ['sick of', 1],
  ['fed up', 1],
  // hostility / accusation
  ['liar', 2],
  ['liars', 2],
  ['lies', 1],
  ['lying', 1],
  ['fraud', 2],
  ['corrupt', 2],
  ['corruption', 1],
  ['criminal', 1],
  ['criminals', 1],
  ['traitor', 2],
  ['traitors', 2],
  ['treason', 2],
  ['evil', 2],
  ['vile', 2],
  ['despicable', 2],
  ['shameful', 1],
  ['disgrace', 2],
  ['disgraceful', 2],
  // doom / escalation
  ['destroy', 1],
  ['destroyed', 1],
  ['destroying', 1],
  ['ruin', 1],
  ['ruined', 1],
  ['ruining', 1],
  ['attack', 1],
  ['attacks', 1],
  ['war on', 1],
  ['disaster', 1],
  ['catastrophe', 1],
  ['nightmare', 1],
  ['insane', 1],
  ['insanity', 1],
  ['unhinged', 2],
  ['toxic', 1],
  ['terrible', 1],
  ['horrible', 1],
  ['awful', 1],
  ['worst', 1],
  // profanity-adjacent intensity
  ['damn', 1],
  ['hell', 1],
  ['wtf', 2],
  ['screwed', 1],
  ['bullshit', 2],
]);

/** Posts scoring at or above this are considered heated. */
export const HEATED_THRESHOLD = 2;

/** Crude tag stripper for status HTML — good enough for word matching. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rage score for a plain-text snippet: keyword weights + shouting cues. */
export function rageScore(text: string): number {
  const lower = text.toLowerCase();
  const tokens = lower.split(/[^a-z']+/).filter(Boolean);
  let score = 0;

  const seen = new Set<string>();
  for (const token of tokens) {
    const weight = RAGE_WEIGHTS.get(token);
    // Count each distinct word once — repetition is covered by the caps/bang cues.
    if (weight && !seen.has(token)) {
      seen.add(token);
      score += weight;
    }
  }
  // Two-word phrases ("sick of", "war on", "fed up").
  for (const [phrase, weight] of RAGE_WEIGHTS) {
    if (phrase.includes(' ') && lower.includes(phrase)) {
      score += weight;
    }
  }

  // Shouting: three or more ALL-CAPS words (4+ letters) reads as yelling.
  const capsWords = text.match(/\b[A-Z]{4,}\b/g) ?? [];
  if (capsWords.length >= 3) {
    score += 1;
  }
  // Exclamation pile-ups: "!!" or worse, or many sentences ending in "!".
  const bangs = (text.match(/!/g) ?? []).length;
  if (/!{2,}/.test(text) || bangs >= 3) {
    score += 1;
  }
  return score;
}

/**
 * Whether a status (or the status it boosts) reads as inflammatory.
 * Checks the content warning text too — heat often lives in the CW.
 */
export function isHeated(status: Status): boolean {
  const target = status.reblog ?? status;
  const text = `${target.spoiler_text} ${stripHtml(target.content)}`;
  return rageScore(text) >= HEATED_THRESHOLD;
}
