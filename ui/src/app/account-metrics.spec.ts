import { describe, expect, it } from 'vitest';
import { Status } from './models';
import {
  MIN_MONTHS_FOR_MONTHLY,
  MIN_WEEKS_FOR_WEEKLY,
  REACH_MODEL,
  computeLiveliness,
  estimatePostReach,
  estimateTotalReach,
  hasMonthlyRange,
  hasWeeklyRange,
  hourHistogram,
  monthlyActivity,
  sampleSpanDays,
  weekdayHistogram,
  weeklyActivity,
} from './account-metrics';

const DAY_MS = 86_400_000;

/** Minimal Status with a given created_at and engagement counts. */
function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    id: Math.random().toString(36).slice(2),
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: '',
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: 'a', username: 'a', acct: 'a', display_name: 'A' } as never,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
    ...overrides,
  };
}

/** A post `daysAgo` before `now`, newest-first sample building. */
function postDaysAgo(daysAgo: number, now = Date.now(), overrides: Partial<Status> = {}): Status {
  return makeStatus({ created_at: new Date(now - daysAgo * DAY_MS).toISOString(), ...overrides });
}

describe('estimatePostReach', () => {
  it('reaches a baseline fraction of followers with no engagement', () => {
    const post = makeStatus();
    expect(estimatePostReach(post, 1000)).toBe(
      Math.round(1000 * REACH_MODEL.organicReachFraction),
    );
  });

  it('adds boost audience on top of own audience', () => {
    const noBoost = estimatePostReach(makeStatus(), 1000);
    const withBoost = estimatePostReach(makeStatus({ reblogs_count: 4 }), 1000);
    expect(withBoost - noBoost).toBe(4 * REACH_MODEL.avgBoosterAudience);
  });

  it('caps own-audience reach at the full follower count', () => {
    // Enough favourites to blow past 100% of followers — still capped.
    const post = makeStatus({ favourites_count: 100_000 });
    expect(estimatePostReach(post, 500)).toBe(500);
  });

  it('uses the boost target for a reblogged status', () => {
    const inner = makeStatus({ reblogs_count: 2, favourites_count: 0 });
    const boost = makeStatus({ reblog: inner });
    expect(estimatePostReach(boost, 1000)).toBe(estimatePostReach(inner, 1000));
  });
});

describe('estimateTotalReach', () => {
  it('sums per-post reach', () => {
    const posts = [makeStatus({ reblogs_count: 1 }), makeStatus({ reblogs_count: 1 })];
    expect(estimateTotalReach(posts, 100)).toBe(
      estimatePostReach(posts[0], 100) + estimatePostReach(posts[1], 100),
    );
  });

  it('is zero for an empty sample', () => {
    expect(estimateTotalReach([], 1000)).toBe(0);
  });
});

describe('sampleSpanDays', () => {
  it('is zero for fewer than two posts', () => {
    expect(sampleSpanDays([])).toBe(0);
    expect(sampleSpanDays([makeStatus()])).toBe(0);
  });

  it('measures oldest-to-newest span of a newest-first sample', () => {
    const posts = [postDaysAgo(0), postDaysAgo(10)];
    expect(Math.round(sampleSpanDays(posts))).toBe(10);
  });
});

describe('computeLiveliness', () => {
  const now = new Date('2026-07-25T12:00:00Z');

  it('treats a busy-but-old account as dormant', () => {
    // 1000-post-equivalent burst, all in 2023, nothing since: the classic ghost.
    const posts = Array.from({ length: 100 }, (_, i) =>
      postDaysAgo(900 + i, now.getTime()),
    );
    const live = computeLiveliness(posts, now);
    expect(live.label).toBe('Dormant');
    expect(live.score).toBeLessThan(10);
    expect(live.postsLast30Days).toBe(0);
    expect(live.postsLast90Days).toBe(0);
  });

  it('scores a recently-active account high', () => {
    const posts = Array.from({ length: 30 }, (_, i) => postDaysAgo(i, now.getTime()));
    const live = computeLiveliness(posts, now);
    expect(live.label).toBe('Active');
    expect(live.postsLast30Days).toBe(30);
    expect(live.recentPostsPerDay).toBe(1);
  });

  it('flags a slowing account between the two', () => {
    // Last post ~3 weeks ago, a handful recently.
    const posts = [postDaysAgo(20, now.getTime()), postDaysAgo(35, now.getTime())];
    const live = computeLiveliness(posts, now);
    expect(live.label).toBe('Slowing');
  });

  it('handles an empty sample', () => {
    const live = computeLiveliness([], now);
    expect(live.daysSinceLastPost).toBe(Infinity);
    expect(live.score).toBe(0);
    expect(live.label).toBe('Dormant');
  });
});

describe('range gating', () => {
  const now = Date.now();

  it('suppresses weekly below the minimum span', () => {
    const posts = [postDaysAgo(0, now), postDaysAgo(MIN_WEEKS_FOR_WEEKLY * 7 - 5, now)];
    expect(hasWeeklyRange(posts)).toBe(false);
    expect(weeklyActivity(posts, 100)).toEqual([]);
  });

  it('enables weekly at the minimum span', () => {
    const posts = [postDaysAgo(0, now), postDaysAgo(MIN_WEEKS_FOR_WEEKLY * 7 + 2, now)];
    expect(hasWeeklyRange(posts)).toBe(true);
    expect(weeklyActivity(posts, 100).length).toBeGreaterThanOrEqual(MIN_WEEKS_FOR_WEEKLY);
  });

  it('suppresses monthly below the minimum span', () => {
    const posts = [postDaysAgo(0, now), postDaysAgo(MIN_MONTHS_FOR_MONTHLY * 30 - 10, now)];
    expect(hasMonthlyRange(posts)).toBe(false);
    expect(monthlyActivity(posts, 100)).toEqual([]);
  });

  it('enables monthly at the minimum span', () => {
    const posts = [postDaysAgo(0, now), postDaysAgo(MIN_MONTHS_FOR_MONTHLY * 30 + 5, now)];
    expect(hasMonthlyRange(posts)).toBe(true);
    expect(monthlyActivity(posts, 100).length).toBeGreaterThanOrEqual(2);
  });
});

describe('activity bucketing', () => {
  const now = Date.now();

  it('assigns every post to a weekly bucket and preserves total counts', () => {
    const posts = Array.from({ length: 40 }, (_, i) => postDaysAgo(i * 2, now));
    const buckets = weeklyActivity(posts, 100);
    const totalPosts = buckets.reduce((s, b) => s + b.posts, 0);
    expect(totalPosts).toBe(posts.length);
  });

  it('buckets monthly in chronological order', () => {
    const posts = Array.from({ length: 40 }, (_, i) => postDaysAgo(i * 6, now));
    const buckets = monthlyActivity(posts, 100);
    const starts = buckets.map((b) => new Date(b.startIso).getTime());
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
    expect(buckets.reduce((s, b) => s + b.posts, 0)).toBe(posts.length);
  });
});

describe('histograms', () => {
  it('weekday histogram has 7 labelled buckets summing to the sample size', () => {
    const posts = Array.from({ length: 14 }, (_, i) => postDaysAgo(i));
    const hist = weekdayHistogram(posts);
    expect(hist).toHaveLength(7);
    expect(hist.reduce((s, b) => s + b.posts, 0)).toBe(14);
  });

  it('hour histogram has 24 buckets summing to the sample size', () => {
    const posts = Array.from({ length: 10 }, (_, i) => postDaysAgo(i));
    const hist = hourHistogram(posts);
    expect(hist).toHaveLength(24);
    expect(hist.reduce((s, b) => s + b.posts, 0)).toBe(10);
  });
});
