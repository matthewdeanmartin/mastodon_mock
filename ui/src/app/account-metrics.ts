import { Status } from './models';

/**
 * Cheap, client-side account metrics derived entirely from a sample of an
 * account's recent posts (plus the account's own follower count). No history
 * endpoints, no per-day queries — the sample the analytics page already holds
 * in memory *is* the time series. Every function here is a pure transform over
 * that sample, so adding a metric costs zero API calls.
 *
 * Two things worth stating up front, because the numbers look more authoritative
 * than they are:
 *
 *  - **Reach is a folk model, not a measurement.** Mastodon exposes no
 *    impression counts, so we infer reach from followers, boosts and favourites
 *    using the deliberately-guessed constants in {@link REACH_MODEL}. It is a
 *    "cheap peek", in the same spirit as the rage lexicon in `sentiment.ts`.
 *  - **Liveliness is always relative to *now*.** An account that posted 1000
 *    times in 2023 and nothing since is *dormant*, not lively — so cadence is
 *    measured over a trailing window ending today, never across the sample's
 *    own span (which would make any dead account look busy).
 */

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------

/**
 * The guessed constants behind the reach estimate. These are folklore, not
 * data — tune them here, in one place, and treat every number they produce as
 * an estimate.
 */
export const REACH_MODEL = {
  /**
   * Assumed audience gained per boost. Each boost re-exposes the post to a
   * *different* account's followers, so this is genuinely new reach. ~250 is
   * the well-worn "the average account has a few hundred followers" guess.
   */
  avgBoosterAudience: 250,
  /**
   * How many of your *own* followers a single favourite implies actually saw
   * the post. A like doesn't broadcast, but it correlates with visibility
   * (faved posts float up; likers had to see it to like it). Folded into a
   * fraction-of-followers-saw multiplier that can never exceed 1.0 — likes
   * alone can't reach beyond your follower count.
   */
  followersSeenPerFavourite: 1.5,
  /**
   * The floor for "how much of your own audience saw a post" even with zero
   * favourites — not everyone sees everything, but some baseline fraction of
   * followers is assumed reached organically.
   */
  organicReachFraction: 0.1,
} as const;

/**
 * Estimated number of people who saw a single post.
 *
 *   reach = ownAudienceReached + boosts × avgBoosterAudience
 *
 * where `ownAudienceReached` is a fraction of the follower count that grows
 * with favourites (capped at the full follower count). Boosts add fresh
 * audience on top. `followers` is passed in because a post's own
 * `account.followers_count` is the same for every post in the sample.
 */
export function estimatePostReach(post: Status, followers: number): number {
  const target = post.reblog ?? post;
  const seenFraction = Math.min(
    1,
    REACH_MODEL.organicReachFraction +
      (target.favourites_count * REACH_MODEL.followersSeenPerFavourite) / Math.max(1, followers),
  );
  const ownAudience = followers * seenFraction;
  const boostAudience = target.reblogs_count * REACH_MODEL.avgBoosterAudience;
  return Math.round(ownAudience + boostAudience);
}

/** Total estimated reach across a sample of posts. */
export function estimateTotalReach(posts: Status[], followers: number): number {
  return posts.reduce((sum, p) => sum + estimatePostReach(p, followers), 0);
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Days between two ISO timestamps (absolute). */
function daysBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / DAY_MS;
}

/**
 * The span, in days, covered by the sample (oldest → newest post). Zero for an
 * empty or single-post sample. Assumes `posts` is newest-first, as the API
 * returns it.
 */
export function sampleSpanDays(posts: Status[]): number {
  if (posts.length < 2) {
    return 0;
  }
  return daysBetween(posts[0].created_at, posts[posts.length - 1].created_at);
}

// ---------------------------------------------------------------------------
// Liveliness
// ---------------------------------------------------------------------------

/** Cadence half-life: posting within ~2 weeks reads as hot, silence cools fast. */
const LIVELINESS_TAU_DAYS = 14;

export type LivelinessLabel = 'Active' | 'Slowing' | 'Dormant';

export interface Liveliness {
  /** Days since the most recent post (0 if it was today; Infinity if none). */
  daysSinceLastPost: number;
  /** Posts made in the trailing 30 days ending *now*. */
  postsLast30Days: number;
  /** Posts made in the trailing 90 days ending *now*. */
  postsLast90Days: number;
  /** Recent cadence: posts per day over the trailing 30 days. */
  recentPostsPerDay: number;
  /** 0–100 liveliness score, recency-weighted and anchored to today. */
  score: number;
  /** Traffic-light bucket derived from {@link score}. */
  label: LivelinessLabel;
}

/**
 * Recency-weighted liveliness, always measured relative to `now`.
 *
 * The score multiplies a recency-decay term (how long since the last post) by a
 * recent-cadence term (how much posting happened in the last month). Both go to
 * ~0 for an account that has been silent, which is the whole point: history
 * before the trailing window never props the number up.
 */
export function computeLiveliness(posts: Status[], now: Date = new Date()): Liveliness {
  const nowMs = now.getTime();
  if (!posts.length) {
    return {
      daysSinceLastPost: Infinity,
      postsLast30Days: 0,
      postsLast90Days: 0,
      recentPostsPerDay: 0,
      score: 0,
      label: 'Dormant',
    };
  }

  const times = posts.map((p) => new Date(p.created_at).getTime());
  const lastMs = Math.max(...times);
  const daysSinceLastPost = Math.max(0, (nowMs - lastMs) / DAY_MS);
  const postsLast30Days = times.filter((t) => nowMs - t <= 30 * DAY_MS).length;
  const postsLast90Days = times.filter((t) => nowMs - t <= 90 * DAY_MS).length;
  const recentPostsPerDay = Math.round((postsLast30Days / 30) * 10) / 10;

  // Recency decay: 1.0 if posted today, ~0.37 at one tau, → 0 as silence grows.
  const recency = Math.exp(-daysSinceLastPost / LIVELINESS_TAU_DAYS);
  // Cadence, saturating: ~1 post/day in the last month is already "very active".
  const cadence = Math.min(1, postsLast30Days / 30);
  // Recency dominates (a dead account can't be lively however busy it once was),
  // but a live account that posts a lot should still outscore one that posts rarely.
  const score = Math.round(100 * recency * (0.5 + 0.5 * cadence));

  let label: LivelinessLabel;
  if (score >= 40) {
    label = 'Active';
  } else if (score >= 10) {
    label = 'Slowing';
  } else {
    label = 'Dormant';
  }

  return {
    daysSinceLastPost: Math.round(daysSinceLastPost),
    postsLast30Days,
    postsLast90Days,
    recentPostsPerDay,
    score,
    label,
  };
}

// ---------------------------------------------------------------------------
// Time-bucketed activity (for sparklines / "when they post")
// ---------------------------------------------------------------------------

/** One time bucket of activity: a label plus the posts and reach that fell in it. */
export interface ActivityBucket {
  /** Human label for the bucket ("Wk of Mar 3", "Mar 2025"). */
  label: string;
  /** Start of the bucket (ISO), oldest edge. */
  startIso: string;
  posts: number;
  reach: number;
}

/** Minimum sample span before weekly buckets are meaningful enough to show. */
export const MIN_WEEKS_FOR_WEEKLY = 10;
/** Minimum sample span before monthly buckets are meaningful enough to show. */
export const MIN_MONTHS_FOR_MONTHLY = 6;

/** Whether the sample spans enough time for a weekly breakdown to be worth showing. */
export function hasWeeklyRange(posts: Status[]): boolean {
  return sampleSpanDays(posts) >= MIN_WEEKS_FOR_WEEKLY * 7;
}

/** Whether the sample spans enough time for a monthly breakdown to be worth showing. */
export function hasMonthlyRange(posts: Status[]): boolean {
  return sampleSpanDays(posts) >= MIN_MONTHS_FOR_MONTHLY * 30;
}

const WEEK_LABEL_OPTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const MONTH_LABEL_OPTS: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };

/**
 * Bucket posts into consecutive weeks (oldest → newest), each carrying its post
 * count and estimated reach. Empty weeks in the middle are included so a
 * sparkline shows real gaps. Returns [] if the span is too short to be useful.
 */
export function weeklyActivity(posts: Status[], followers: number): ActivityBucket[] {
  if (!hasWeeklyRange(posts)) {
    return [];
  }
  const oldest = new Date(posts[posts.length - 1].created_at).getTime();
  const newest = new Date(posts[0].created_at).getTime();
  const buckets: ActivityBucket[] = [];
  for (let start = oldest; start <= newest; start += WEEK_MS) {
    buckets.push({
      label: 'Wk of ' + new Date(start).toLocaleDateString([], WEEK_LABEL_OPTS),
      startIso: new Date(start).toISOString(),
      posts: 0,
      reach: 0,
    });
  }
  for (const p of posts) {
    const idx = Math.floor((new Date(p.created_at).getTime() - oldest) / WEEK_MS);
    const bucket = buckets[Math.min(idx, buckets.length - 1)];
    bucket.posts += 1;
    bucket.reach += estimatePostReach(p, followers);
  }
  return buckets;
}

/**
 * Bucket posts by calendar month (oldest → newest). Returns [] if the span is
 * too short to be useful.
 */
export function monthlyActivity(posts: Status[], followers: number): ActivityBucket[] {
  if (!hasMonthlyRange(posts)) {
    return [];
  }
  const byKey = new Map<string, ActivityBucket>();
  // Walk oldest → newest so insertion order is chronological.
  for (const p of [...posts].reverse()) {
    const d = new Date(p.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        label: d.toLocaleDateString([], MONTH_LABEL_OPTS),
        startIso: new Date(d.getFullYear(), d.getMonth(), 1).toISOString(),
        posts: 0,
        reach: 0,
      };
      byKey.set(key, bucket);
    }
    bucket.posts += 1;
    bucket.reach += estimatePostReach(p, followers);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// "When they post" — weekday / hour distribution (no timezone inference)
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Post counts per local weekday (index 0 = Sunday), for a bar chart. */
export function weekdayHistogram(posts: Status[]): { label: string; posts: number }[] {
  const counts = new Array(7).fill(0);
  for (const p of posts) {
    counts[new Date(p.created_at).getDay()] += 1;
  }
  return WEEKDAY_LABELS.map((label, i) => ({ label, posts: counts[i] }));
}

/** Post counts per local hour (0–23), for a bar chart. */
export function hourHistogram(posts: Status[]): { hour: number; posts: number }[] {
  const counts = new Array(24).fill(0);
  for (const p of posts) {
    counts[new Date(p.created_at).getHours()] += 1;
  }
  return counts.map((posts, hour) => ({ hour, posts }));
}

// ---------------------------------------------------------------------------
// Contribution heatmap ("the lawn")
// ---------------------------------------------------------------------------

/** One day cell in the heatmap. */
export interface HeatmapDay {
  /** Local midnight of the day, ISO — also the cell's track key. */
  dayIso: string;
  /** Localised date, for the tooltip. */
  label: string;
  posts: number;
  /** 0 (none) to 4 (busiest), for CSS shading. */
  level: number;
}

/** A calendar heatmap: weeks as columns, Sunday-first days as rows. */
export interface Heatmap {
  /** Columns, oldest week first; each holds exactly 7 days (Sun → Sat). */
  weeks: HeatmapDay[][];
  /** Month labels positioned by the column their month starts in. */
  months: { label: string; weekIndex: number }[];
  /** Busiest single day in the range, for the legend. */
  peak: number;
  /** How many days the grid spans, padding included. */
  days: number;
  /** Days in the range with at least one post. */
  activeDays: number;
}

const HEATMAP_LEVELS = 4;
const DAY_TOOLTIP_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};
const HEATMAP_MONTH_OPTS: Intl.DateTimeFormatOptions = { month: 'short' };

function localMidnight(value: string | number | Date): Date {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * A GitHub-style contribution grid over **exactly the span the sample covers** —
 * from the Sunday on or before the oldest post to the Saturday on or after the
 * newest. Deliberately not a fixed 52-week year: the sample is ~100 posts, so
 * for a busy account that is a few weeks and drawing an empty year would imply
 * silence we never observed. Widening the window is the caller's job (the
 * "get more posts" control), and the grid grows with it.
 *
 * Shading is relative to the sample's own busiest day, so the lawn always uses
 * its full range of greens regardless of how prolific the account is.
 */
export function postHeatmap(posts: Status[]): Heatmap {
  if (!posts.length) {
    return { weeks: [], months: [], peak: 0, days: 0, activeDays: 0 };
  }

  const counts = new Map<number, number>();
  let oldest = Infinity;
  let newest = -Infinity;
  for (const p of posts) {
    const day = localMidnight(p.created_at).getTime();
    counts.set(day, (counts.get(day) ?? 0) + 1);
    oldest = Math.min(oldest, day);
    newest = Math.max(newest, day);
  }

  // Pad out to whole weeks so every column is a full Sunday→Saturday strip.
  const start = new Date(oldest);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(newest);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const peak = Math.max(...counts.values());
  const weeks: HeatmapDay[][] = [];
  const months: { label: string; weekIndex: number }[] = [];
  let week: HeatmapDay[] = [];
  let days = 0;
  let lastMonth = -1;

  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = new Date(cursor);
    const posts = counts.get(day.getTime()) ?? 0;
    week.push({
      dayIso: day.toISOString(),
      label: day.toLocaleDateString([], DAY_TOOLTIP_OPTS),
      posts,
      // Ceil so any activity at all is visible, never washed out to level 0.
      level: posts ? Math.max(1, Math.ceil((posts / peak) * HEATMAP_LEVELS)) : 0,
    });
    days += 1;
    if (day.getDay() === 0 && day.getMonth() !== lastMonth) {
      lastMonth = day.getMonth();
      months.push({
        label: day.toLocaleDateString([], HEATMAP_MONTH_OPTS),
        weekIndex: weeks.length,
      });
    }
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    weeks.push(week);
  }

  return { weeks, months, peak, days, activeDays: counts.size };
}
