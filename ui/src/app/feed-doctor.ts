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

/**
 * A source whose freshest post is older than this looks stalled rather than quiet.
 *
 * Generous on purpose: plenty of good RSS feeds post weekly, so this is a "has
 * the connector stopped working" test, not a liveliness contest. What makes it
 * meaningful is the comparison — one source at three days old while another is at
 * three minutes is a different claim from everything being slow.
 */
export const STALE_SOURCE_HOURS = 48;

/**
 * A source contributing less than this share is a garnish, not a section.
 *
 * Used only to decide whether a stalled source is worth mentioning; a provider
 * that supplies two posts of two hundred is not why the feed looks wrong.
 */
export const MINOR_SOURCE_SHARE = 0.02;

/** An action the page offers. Never applied automatically — the user decides. */
export interface DoctorAction {
  kind: 'mute' | 'unfollow' | 'review-filters' | 'review-quiet' | 'review-window';
  label: string;
  /** The account it applies to, for the account-scoped actions. */
  account?: Account;
  /** Mute duration in seconds, for `mute`. */
  seconds?: number;
}

export interface Verdict {
  id: 'flooding' | 'ended' | 'mixing' | 'sources' | 'timespans';
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

/** One provider's contribution to the merged feed, as seen in the sample. */
export interface ProviderSlice {
  /** Provider id (`mastodon`, `bluesky`, `rss`, …) or a display label. */
  id: string;
  label: string;
  count: number;
  /** Newest and oldest post timestamps in the sample, epoch ms. */
  newest: number;
  oldest: number;
  /** Linked and visible, but contributed nothing to this sample. */
  silent?: boolean;
}

/**
 * Group a merged feed by the provider each post came from.
 *
 * Reads `status.provider`, which the aggregator stamps on every foreign post
 * (Mastodon's own posts leave it unset). `linked` names sources the user has
 * connected and made visible, so one that contributed nothing can be reported as
 * silent rather than silently omitted — "Bluesky returned nothing" is exactly the
 * finding a stalled connector produces.
 */
/**
 * Fallback display name for a provider id with no registered label.
 *
 * A verdict reading "bluesky is behind the rest of your feed" is the kind of
 * detail that makes a diagnostic look unfinished; the registry supplies proper
 * labels in the app, and this covers ids that arrive without one.
 */
function titleCase(id: string): string {
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}

export function sliceByProvider(
  posts: Status[],
  labels: Record<string, string> = {},
  linked: string[] = [],
): ProviderSlice[] {
  const byId = new Map<string, ProviderSlice>();

  for (const post of posts) {
    const subject = feedSubject(post);
    const id = post.provider ?? 'mastodon';
    const at = Date.parse(subject.created_at);
    const slice = byId.get(id) ?? {
      id,
      label: labels[id] ?? titleCase(id),
      count: 0,
      newest: 0,
      oldest: Number.POSITIVE_INFINITY,
    };
    slice.count += 1;
    if (!Number.isNaN(at) && at > 0) {
      slice.newest = Math.max(slice.newest, at);
      slice.oldest = Math.min(slice.oldest, at);
    }
    byId.set(id, slice);
  }

  for (const id of linked) {
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        label: labels[id] ?? titleCase(id),
        count: 0,
        newest: 0,
        oldest: 0,
        silent: true,
      });
    }
  }

  return [...byId.values()].map((slice) => ({
    ...slice,
    oldest: Number.isFinite(slice.oldest) ? slice.oldest : slice.newest,
  }));
}

/** Age of the freshest post, in hours. */
function hoursSince(at: number, now: number): number {
  return (now - at) / 3_600_000;
}

function describeAge(hours: number): string {
  if (hours < 1) {
    return 'minutes ago';
  }
  if (hours < 48) {
    return `${Math.round(hours)}h ago`;
  }
  const days = Math.round(hours / 24);
  return days > 60 ? `${Math.round(days / 30)} months ago` : `${days} days ago`;
}

/**
 * Is one of the connected sources stalled, or contributing nothing?
 *
 * Signed-in Home is not one server's timeline — `FeedAggregator` merges Mastodon
 * with Bluesky, Twitter and RSS in per-source rounds. That makes a failure mode
 * the anonymous feed never has: everything looks fine, but one source quietly
 * stopped, and the only symptom is that you have not seen a Bluesky post in two
 * days without ever noticing you stopped.
 *
 * Judged **relatively**. "Nothing since Tuesday" is not damning on its own — you
 * may simply have been away — but one source at three days old while another is
 * at three minutes is a specific, actionable claim.
 */
export function diagnoseSources(slices: ProviderSlice[], now: number = Date.now()): Verdict {
  const contributing = slices.filter((slice) => slice.count > 0);
  const silent = slices.filter((slice) => slice.silent || slice.count === 0);

  if (!contributing.length) {
    return {
      id: 'sources',
      severity: silent.length ? 'warn' : 'ok',
      headline: silent.length
        ? 'None of your connected sources returned anything.'
        : 'No connected sources.',
      detail: silent.map((slice) => `${slice.label} — nothing in this sample`),
      actions: [],
    };
  }

  // The freshest source sets the bar: it is the evidence that the app itself is
  // fetching fine, which is what makes a lagging sibling meaningful.
  const freshest = Math.max(...contributing.map((slice) => slice.newest));
  const total = contributing.reduce((sum, slice) => sum + slice.count, 0);

  const stalled = contributing.filter(
    (slice) =>
      hoursSince(slice.newest, freshest) >= STALE_SOURCE_HOURS &&
      slice.count / total >= MINOR_SOURCE_SHARE,
  );

  const detail = contributing
    .slice()
    .sort((a, b) => b.newest - a.newest)
    .map(
      (slice) =>
        `${slice.label} — ${slice.count} posts, newest ${describeAge(hoursSince(slice.newest, now))}`,
    );
  for (const slice of silent) {
    detail.push(`${slice.label} — nothing in this sample`);
  }

  if (!stalled.length && !silent.length) {
    return {
      id: 'sources',
      severity: 'ok',
      headline: `All ${contributing.length} sources are current.`,
      detail: contributing.length > 1 ? detail : [],
      actions: [],
    };
  }

  const names = [...stalled, ...silent].map((slice) => slice.label).join(', ');
  return {
    id: 'sources',
    severity: 'warn',
    headline: stalled.length
      ? `${names} ${stalled.length + silent.length === 1 ? 'is' : 'are'} behind the rest of your feed.`
      : `${names} contributed nothing.`,
    detail: [
      ...detail,
      'A source that lags far behind the others is usually a stalled connector, or nobody you follow there has posted.',
    ],
    actions: [],
  };
}

/**
 * Do the sources cover the same stretch of time, or are they stacked in layers?
 *
 * The aggregator guarantees every source at least 20 posts per round and then
 * sorts the union by date. When one source is archival — an RSS feed of a blog
 * that stopped in 2019 — the result is a clean slab of recent Mastodon followed
 * by a wall of very old posts, which reads as a broken feed rather than as two
 * sources with different clocks.
 *
 * Disjointness is the signal: a source whose *newest* post predates another
 * source's *oldest* cannot interleave with it at all.
 */
export function diagnoseTimespans(slices: ProviderSlice[], now: number = Date.now()): Verdict {
  const contributing = slices.filter((slice) => slice.count > 0 && slice.newest > 0);
  if (contributing.length < 2) {
    return {
      id: 'timespans',
      severity: 'ok',
      headline: 'Only one source in this sample, so nothing to interleave.',
      detail: [],
      actions: [],
    };
  }

  const ranked = [...contributing].sort((a, b) => b.newest - a.newest);
  const disjoint: [ProviderSlice, ProviderSlice][] = [];
  for (const recent of ranked) {
    for (const old of ranked) {
      if (recent !== old && old.newest < recent.oldest) {
        disjoint.push([recent, old]);
      }
    }
  }

  const detail = ranked.map(
    (slice) =>
      `${slice.label} — ${describeAge(hoursSince(slice.newest, now))} to ${describeAge(hoursSince(slice.oldest, now))}`,
  );

  if (!disjoint.length) {
    return {
      id: 'timespans',
      severity: 'ok',
      headline: 'Your sources cover overlapping time, so they interleave.',
      detail,
      actions: [],
    };
  }

  const [recent, old] = disjoint[0];
  return {
    id: 'timespans',
    severity: 'notice',
    headline: `${old.label} doesn't overlap ${recent.label} in time.`,
    detail: [
      ...detail,
      `Every ${old.label} post is older than every ${recent.label} post, so they stack in layers instead of mixing.`,
    ],
    actions: [{ kind: 'review-window', label: 'Feed settings' }],
  };
}

export interface DiagnoseOptions {
  posts: Status[];
  outcomes: SourceOutcome[];
  bySource: Record<string, number>;
  /**
   * Per-provider stats for the signed-in aggregated feed. Absent for the
   * anonymous feed, which has one kind of source and its own `outcomes`.
   */
  slices?: ProviderSlice[];
  now?: number;
}

/**
 * Run every check that has data behind it.
 *
 * Both feeds get flooding and mixing — those questions are identical whoever you
 * are. The rest depends on what the feed can actually report:
 *
 *  - **Anonymous** builds Home from per-follow reads, so it can say *which
 *    follow* went quiet or was filtered away (`outcomes`).
 *  - **Signed in**, Home is `FeedAggregator` merging Mastodon, Bluesky, Twitter
 *    and RSS. There are no per-follow outcomes, but there is something the
 *    anonymous feed has no equivalent for: per-provider freshness and time
 *    spans, which is where the signed-in feed actually goes wrong.
 *
 * A verdict with nothing behind it is omitted rather than rendered as a
 * reassuring green tick — claiming "every follow returned posts" when nothing was
 * measured is worse than saying nothing.
 */
export function diagnoseFeed(options: DiagnoseOptions): FeedDiagnosis {
  const now = options.now ?? Date.now();
  const verdicts: Verdict[] = [diagnoseFlooding(options.posts)];

  if (options.slices?.length) {
    verdicts.push(diagnoseSources(options.slices, now), diagnoseTimespans(options.slices, now));
  }
  if (options.outcomes.length) {
    verdicts.push(diagnoseEnding(options.outcomes));
  }
  verdicts.push(diagnoseMixing(options.bySource));

  return { sampleSize: options.posts.length, verdicts };
}

/** Re-exported so the page can render author rows without importing two modules. */
export type { AuthorRow };
export { feedSubject };
