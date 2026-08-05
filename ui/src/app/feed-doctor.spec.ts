import { describe, expect, it } from 'vitest';
import { Account, Status } from './models';
import { SourceOutcome } from './providers/anonymous/anonymous-mastodon-provider';
import {
  DEAD_FOLLOW_RATIO,
  FLOOD_MIN_POSTS,
  diagnoseEnding,
  diagnoseFeed,
  diagnoseFlooding,
  diagnoseMixing,
} from './feed-doctor';

function account(id: string): Account {
  return {
    id,
    username: `u${id}`,
    acct: `u${id}@example.social`,
    fields: [],
  } as unknown as Account;
}

function post(id: string, authorId: string): Status {
  return {
    id,
    account: account(authorId),
    content: '',
    created_at: new Date().toISOString(),
    favourites_count: 0,
    reblogs_count: 0,
    replies_count: 0,
    tags: [],
    media_attachments: [],
    mentions: [],
  } as unknown as Status;
}

/** `n` posts by the same author, plus filler from distinct others. */
function feed(dominant: number, others: number): Status[] {
  return [
    ...Array.from({ length: dominant }, (_, i) => post(`d${i}`, 'loud')),
    ...Array.from({ length: others }, (_, i) => post(`o${i}`, `quiet${i}`)),
  ];
}

describe('diagnoseFlooding', () => {
  it('names an author who dominates the window', () => {
    const verdict = diagnoseFlooding(feed(8, 12));
    expect(verdict.severity).not.toBe('ok');
    expect(verdict.headline).toContain('uloud@example.social');
    expect(verdict.headline).toContain('40%');
  });

  it('escalates to warn once one account owns 40% of the sample', () => {
    expect(diagnoseFlooding(feed(10, 10)).severity).toBe('warn');
    // A quarter is enough to mention, not enough to alarm.
    expect(diagnoseFlooding(feed(6, 18)).severity).toBe('notice');
  });

  it('stays quiet when the feed is well spread', () => {
    const verdict = diagnoseFlooding(feed(2, 18));
    expect(verdict.severity).toBe('ok');
    expect(verdict.actions).toEqual([]);
  });

  /**
   * The guard that separates a diagnosis from a horoscope: 3 of 5 posts is 60% and
   * means nothing at all.
   */
  it('refuses to call flooding on a sample below the minimum', () => {
    const tiny = feed(3, 2);
    expect(tiny.length).toBeLessThan(FLOOD_MIN_POSTS);
    expect(diagnoseFlooding(tiny).severity).toBe('ok');
  });

  it('offers a mute and an unfollow, and applies neither itself', () => {
    const verdict = diagnoseFlooding(feed(10, 10));
    expect(verdict.actions.map((a) => a.kind)).toEqual(['mute', 'unfollow']);
    expect(verdict.actions[0].account?.acct).toBe('uloud@example.social');
    expect(verdict.actions[0].seconds).toBe(8 * 60 * 60);
  });

  it('handles an empty sample without inventing a culprit', () => {
    expect(diagnoseFlooding([]).severity).toBe('ok');
  });
});

describe('diagnoseEnding', () => {
  function outcome(handle: string, ending: SourceOutcome['ending'], fetched = 0): SourceOutcome {
    return { handle, ending, fetched };
  }

  it('says nothing is wrong when every source delivered', () => {
    const verdict = diagnoseEnding([outcome('a', 'ok', 5), outcome('b', 'ok', 3)]);
    expect(verdict.severity).toBe('ok');
    expect(verdict.actions).toEqual([]);
  });

  /**
   * The case no other surface can report. A filter that empties the feed looks
   * exactly like dead follows, so the reader blames their follows.
   */
  it('blames the filters when they are what cut the feed short', () => {
    const verdict = diagnoseEnding([
      outcome('a', 'ok', 5),
      outcome('b', 'filtered', 1),
      outcome('c', 'filtered', 0),
    ]);
    expect(verdict.headline).toContain('filters');
    expect(verdict.detail.join(' ')).toContain('2 more were cut short');
    expect(verdict.actions.map((a) => a.kind)).toContain('review-filters');
  });

  it('distinguishes an unreachable server from a quiet account', () => {
    const verdict = diagnoseEnding([
      outcome('alive', 'ok', 4),
      outcome('quiet', 'empty'),
      outcome('dead@gone.example', 'error'),
    ]);
    const text = verdict.detail.join(' ');
    expect(text).toContain('1 returned nothing');
    expect(text).toContain('1 could not be loaded');
    expect(text).toContain('@dead@gone.example — could not be loaded');
  });

  it('escalates once enough follows are contributing nothing', () => {
    const outcomes = [
      ...Array.from({ length: 6 }, (_, i) => outcome(`ok${i}`, 'ok', 2)),
      ...Array.from({ length: 4 }, (_, i) => outcome(`dead${i}`, 'empty')),
    ];
    expect(4 / outcomes.length).toBeGreaterThanOrEqual(DEAD_FOLLOW_RATIO);
    expect(diagnoseEnding(outcomes).severity).toBe('warn');
  });

  it('mentions only a handful of failures rather than listing hundreds', () => {
    const outcomes = Array.from({ length: 30 }, (_, i) => outcome(`dead${i}`, 'error'));
    const listed = diagnoseEnding(outcomes).detail.filter((line) =>
      line.includes('could not be loaded'),
    );
    // One summary line plus at most five named accounts.
    expect(listed.length).toBeLessThanOrEqual(6);
  });

  it('says nothing when there were no follow sources at all', () => {
    expect(diagnoseEnding([]).severity).toBe('ok');
  });
});

describe('diagnoseMixing', () => {
  it('reports a healthy blend without alarm', () => {
    const verdict = diagnoseMixing({ Follows: 61, Hashtags: 22, RSS: 17 });
    expect(verdict.severity).toBe('ok');
    expect(verdict.detail).toContain('Follows 61%');
  });

  it('flags a feed that is really one source wearing a hat', () => {
    const verdict = diagnoseMixing({ Follows: 90, Hashtags: 10 });
    expect(verdict.severity).toBe('notice');
    expect(verdict.headline).toContain('90%');
  });

  it('says so when only one source contributed anything', () => {
    const verdict = diagnoseMixing({ Follows: 40, Hashtags: 0 });
    expect(verdict.headline).toContain('Everything here came from Follows');
  });

  it('handles an empty feed', () => {
    expect(diagnoseMixing({}).severity).toBe('ok');
  });
});

describe('diagnoseFeed', () => {
  it('answers all three questions and states the sample size', () => {
    const diagnosis = diagnoseFeed({
      posts: feed(10, 10),
      outcomes: [{ handle: 'a', ending: 'ok', fetched: 20 }],
      bySource: { Follows: 20 },
    });

    expect(diagnosis.sampleSize).toBe(20);
    expect(diagnosis.verdicts.map((v) => v.id)).toEqual(['flooding', 'ended', 'mixing']);
  });
});
