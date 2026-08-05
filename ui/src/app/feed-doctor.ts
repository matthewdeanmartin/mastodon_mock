import { Account, Status } from './models';
import { AuthorRow, feedAuthors, feedSubject } from './feed-metrics';
import { SourceOutcome } from './providers/anonymous/anonymous-mastodon-provider';

/**
 * Three questions a reader actually asks about their feed, answered with a verdict
 * and a button rather than a chart.
 *
 *   - Who is flooding?
 *   - Why did my feed end?
 *   - Are the sources mixing?
 *
 * This is the diagnostic companion to `feed-metrics.ts`, and the split is
 * deliberate: that module is *descriptive* ("here is the composition"), this one is
 * *prescriptive* ("here is what is wrong and here is the fix"). Merging them would
 * blunt both — descriptive stats want to show everything, a diagnosis wants to show
 * the one thing that is broken.
 *
 * Pure, like `follow-quality.ts` and `copy-collections.ts`: the interesting parts are
 * arithmetic and thresholds, and none of them need HTTP or a component to test.
 *
 * **The sample is the population.** Every verdict describes the posts that were
 * actually retrieved, never "your feed" in the abstract — `feed-metrics.ts` is
 * emphatic about this and the Doctor makes louder-sounding claims than it does, so it
 * carries the caveat harder. {@link FeedDiagnosis.sampleSize} exists to be shown.
 */

/** How alarmed to be. `ok` sections collapse to a single line. */
export type Severity = 'ok' | 'notice' | 'warn';

/**
 * One author over this share of the window is flooding it.
 *
 * A quarter is high enough that a merely prolific account does not trip it, and low
 * enough to catch the case that prompted this: one bot filling a page.
 */
export const FLOOD_SHARE = 0.25;

/**
 * Never call flooding on a sample this small.
 *
 * Without it, 4 posts out of 10 in a quiet window reads as a 40% flood — a confident
 * accusation built on nothing. Sample-size guards are the difference between a
 * diagnosis and a horoscope.
 */
export const FLOOD_MIN_POSTS = 8;

/** One source category above this share means the feed is not really mixing. */
export const THIN_SOURCE_SHARE = 0.8;

/** When this fraction of follows returned nothing, the feed's thinness has a cause. */
export const DEAD_FOLLOW_RATIO = 0.3;

/** An action the page offers. Never applied automatically — the user decides. */
export interface DoctorAction {
  kind: 'mute' | 'unfollow' | 'review-filters' | 'review-quiet';
  label: string;
  /** The account it applies to, for the account-scoped actions. */
  account?: Account;
  /** Mute duration in seconds, for `mute`. */
  seconds?: number;
}

export interface Verdict {
  id: 'flooding' | 'ended' | 'mixing';
  severity: Severity;
  /** One sentence, already phrased for a human. */
  headline: string;
  /** Supporting rows, rendered under the headline. */
  detail: string[];
  actions: DoctorAction[];
}

export interface FeedDiagnosis {
  sampleSize: number;
  verdicts: Verdict[];
}

const MUTE_8H = 8 * 60 * 60;

function pct(share: number): number {
  return Math.round(share * 100);
}

/**
 * Who is taking up the window, and is it too much?
 *
 * Reads authorship through `feedSubject`, so a boost counts for whoever *wrote* the
 * post rather than whoever boosted it — the reader's complaint is about what fills
 * their screen, and a boosted post fills it with the author's words.
 */
export function diagnoseFlooding(posts: Status[]): Verdict {
  const authors = feedAuthors(posts);
  const top = authors[0];

  if (!top || posts.length < FLOOD_MIN_POSTS || top.share < FLOOD_SHARE) {
    return {
      id: 'flooding',
      severity: 'ok',
      headline: top
        ? `No one is dominating — the loudest is @${top.account.acct} at ${pct(top.share)}%.`
        : 'Nothing in this sample yet.',
      detail: [],
      actions: [],
    };
  }

  const runnerUp = authors[1];
  return {
    id: 'flooding',
    severity: top.share >= 0.4 ? 'warn' : 'notice',
    headline: `@${top.account.acct} is ${pct(top.share)}% of this sample.`,
    detail: [
      `${top.count} of ${posts.length} posts.`,
      runnerUp
        ? `Next highest is @${runnerUp.account.acct} at ${pct(runnerUp.share)}%.`
        : 'No other account comes close.',
    ],
    actions: [
      { kind: 'mute', label: 'Mute for 8 hours', account: top.account, seconds: MUTE_8H },
      { kind: 'unfollow', label: 'Unfollow', account: top.account },
    ],
  };
}

/**
 * Why the feed stopped.
 *
 * The interesting case, and the one no other surface can report: a feed ended
 * because the reader's *own filters* emptied it. That looks exactly like an empty
 * feed, so a reader with an aggressive calm-mode or language filter concludes their
 * follows are dead when in fact they are being hidden.
 */
export function diagnoseEnding(outcomes: SourceOutcome[]): Verdict {
  if (!outcomes.length) {
    return {
      id: 'ended',
      severity: 'ok',
      headline: 'No follow sources in this sample.',
      detail: [],
      actions: [],
    };
  }

  const errored = outcomes.filter((o) => o.ending === 'error');
  const filtered = outcomes.filter((o) => o.ending === 'filtered');
  const empty = outcomes.filter((o) => o.ending === 'empty');
  const quiet = empty.length + errored.length;

  const detail: string[] = [
    `${outcomes.length} follows checked · ${empty.length} returned nothing · ${errored.length} could not be loaded`,
  ];
  for (const source of errored.slice(0, 5)) {
    detail.push(`@${source.handle} — could not be loaded`);
  }
  if (filtered.length) {
    detail.push(
      `${filtered.length} more ${filtered.length === 1 ? 'was' : 'were'} cut short by your filters.`,
    );
  }

  const actions: DoctorAction[] = [];
  if (filtered.length) {
    actions.push({ kind: 'review-filters', label: 'Review filters' });
  }
  if (quiet) {
    actions.push({ kind: 'review-quiet', label: 'Review quiet follows' });
  }

  const troubled = quiet + filtered.length;
  const severity: Severity =
    troubled === 0 ? 'ok' : troubled / outcomes.length >= DEAD_FOLLOW_RATIO ? 'warn' : 'notice';

  return {
    id: 'ended',
    severity,
    headline:
      severity === 'ok'
        ? 'Every follow returned posts.'
        : filtered.length
          ? 'Your filters ended this feed early.'
          : 'Your feed ended early.',
    detail: severity === 'ok' ? [] : detail,
    actions: severity === 'ok' ? [] : actions,
  };
}

/**
 * Whether the feed is actually a mix.
 *
 * Takes counts by source label rather than posts, because "what counts as a source"
 * belongs to whoever assembled the feed (`AlgoSource` for the algo feed, follows vs
 * hashtags vs RSS for Home) and not to this module.
 */
export function diagnoseMixing(bySource: Record<string, number>): Verdict {
  const entries = Object.entries(bySource).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (!total) {
    return {
      id: 'mixing',
      severity: 'ok',
      headline: 'Nothing in this sample yet.',
      detail: [],
      actions: [],
    };
  }

  const ranked = [...entries].sort((a, b) => b[1] - a[1]);
  const detail = ranked.map(([label, count]) => `${label} ${pct(count / total)}%`);
  const [topLabel, topCount] = ranked[0];
  const topShare = topCount / total;

  if (ranked.length === 1) {
    return {
      id: 'mixing',
      severity: 'notice',
      headline: `Everything here came from ${topLabel}.`,
      detail,
      actions: [],
    };
  }

  return {
    id: 'mixing',
    severity: topShare >= THIN_SOURCE_SHARE ? 'notice' : 'ok',
    headline:
      topShare >= THIN_SOURCE_SHARE
        ? `${topLabel} is ${pct(topShare)}% of this feed.`
        : 'Sources are mixing.',
    detail,
    actions: [],
  };
}

export interface DiagnoseOptions {
  posts: Status[];
  outcomes: SourceOutcome[];
  bySource: Record<string, number>;
}

/** Run every check. Ordered most- to least-actionable, which is the reading order. */
export function diagnoseFeed(options: DiagnoseOptions): FeedDiagnosis {
  return {
    sampleSize: options.posts.length,
    verdicts: [
      diagnoseFlooding(options.posts),
      diagnoseEnding(options.outcomes),
      diagnoseMixing(options.bySource),
    ],
  };
}

/** Re-exported so the page can render author rows without importing two modules. */
export type { AuthorRow };
export { feedSubject };
