import { describe, expect, it } from 'vitest';
import { Account } from '../../models';
import {
  CLONE_MAX_PAGES,
  CLONE_TARGET,
  describeSelection,
  selectCloneCandidates,
} from './clone-friends';

const NOW = Date.parse('2026-07-29T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** A follow-worthy account. `over` breaks exactly what a test needs broken. */
function good(id: string, over: Partial<Account> = {}): Account {
  return {
    id,
    username: `user${id}`,
    acct: `user${id}@example.social`,
    display_name: `User ${id}`,
    note: '',
    url: '',
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 100,
    following_count: 100,
    statuses_count: 900,
    last_status_at: new Date(NOW - DAY).toISOString(),
    bot: false,
    locked: false,
    fields: [],
    ...over,
  };
}

/** Dormant: passes nothing, and is the common case in a real follow list. */
function dormant(id: string): Account {
  return good(id, { last_status_at: new Date(NOW - 400 * DAY).toISOString() });
}

function select(over: Partial<Parameters<typeof selectCloneCandidates>[0]> = {}) {
  return selectCloneCandidates({
    candidates: [],
    pagesFetched: 1,
    lastPageFull: false,
    isFollowing: () => false,
    remainingSlots: 50,
    now: NOW,
    ...over,
  });
}

describe('selectCloneCandidates', () => {
  it('adopts healthy accounts up to the target', () => {
    const candidates = Array.from({ length: 30 }, (_, i) => good(`a${i}`));

    const result = select({ candidates });

    expect(result.adopt).toHaveLength(CLONE_TARGET);
    expect(result.skipped).toEqual([]);
  });

  it('filters dormant accounts and keeps the reason for the report', () => {
    const result = select({ candidates: [good('1'), dormant('2'), good('3')] });

    expect(result.adopt.map((a) => a.id)).toEqual(['1', '3']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].account.id).toBe('2');
    expect(result.skipped[0].reason).toContain("hasn't posted");
  });

  it('counts accounts already followed without reporting them as skipped', () => {
    // "Already following" is not a rejection and must not read as one.
    const result = select({
      candidates: [good('1'), good('2'), good('3')],
      isFollowing: (account) => account.id === '2',
    });

    expect(result.adopt.map((a) => a.id)).toEqual(['1', '3']);
    expect(result.alreadyFollowing).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it('never tries to follow the viewer', () => {
    const result = select({ candidates: [good('me'), good('2')], viewerId: 'me' });

    expect(result.adopt.map((a) => a.id)).toEqual(['2']);
    expect(result.skipped).toEqual([]);
  });

  it('dedupes an account that appeared on two pages', () => {
    // The remote list can shift between requests; the same account arriving twice
    // must not become two follows.
    const result = select({ candidates: [good('1'), good('1'), good('2')] });

    expect(result.adopt.map((a) => a.id)).toEqual(['1', '2']);
  });

  it('ignores a malformed candidate rather than adopting a blank', () => {
    const result = select({ candidates: [good('1'), { id: '' } as Account] });

    expect(result.adopt.map((a) => a.id)).toEqual(['1']);
  });

  describe('the slot cap', () => {
    it('never adopts more than the remaining slots allow', () => {
      const candidates = Array.from({ length: 30 }, (_, i) => good(`a${i}`));

      const result = select({ candidates, remainingSlots: 8 });

      expect(result.adopt).toHaveLength(8);
      expect(result.limitedBySlots).toBe(true);
    });

    it('adopts nothing when there are no slots left, and says why', () => {
      const result = select({ candidates: [good('1')], remainingSlots: 0 });

      expect(result.adopt).toEqual([]);
      expect(result.limitedBySlots).toBe(true);
    });

    it('is not "limited by slots" when the target was the binding constraint', () => {
      const result = select({ candidates: [good('1')], remainingSlots: 50 });

      expect(result.limitedBySlots).toBe(false);
    });

    it('treats a negative slot count as zero rather than inverting the cap', () => {
      const result = select({ candidates: [good('1')], remainingSlots: -3 });

      expect(result.adopt).toEqual([]);
    });
  });

  describe('paging', () => {
    it('wants another page when short of the target and the last page was full', () => {
      // The whole reason this pages: five keepers out of eighty follows.
      const result = select({
        candidates: [...Array.from({ length: 75 }, (_, i) => dormant(`d${i}`)), good('1')],
        pagesFetched: 1,
        lastPageFull: true,
      });

      expect(result.adopt).toHaveLength(1);
      expect(result.wantsAnotherPage).toBe(true);
    });

    it('stops when the last page was short, because there is no more to get', () => {
      const result = select({
        candidates: [good('1')],
        pagesFetched: 1,
        lastPageFull: false,
      });

      expect(result.wantsAnotherPage).toBe(false);
    });

    it('stops at the page ceiling however few survivors it found', () => {
      const result = select({
        candidates: Array.from({ length: 200 }, (_, i) => dormant(`d${i}`)),
        pagesFetched: CLONE_MAX_PAGES,
        lastPageFull: true,
      });

      expect(result.adopt).toEqual([]);
      expect(result.wantsAnotherPage).toBe(false);
    });

    it('stops once the target is met, even with pages left to fetch', () => {
      const result = select({
        candidates: Array.from({ length: 40 }, (_, i) => good(`a${i}`)),
        pagesFetched: 1,
        lastPageFull: true,
      });

      expect(result.wantsAnotherPage).toBe(false);
    });

    it('does not keep paging for slots that do not exist', () => {
      // Short of the *target* but not of the cap: another page would be wasted.
      const result = select({
        candidates: [good('1'), good('2')],
        remainingSlots: 2,
        pagesFetched: 1,
        lastPageFull: true,
      });

      expect(result.adopt).toHaveLength(2);
      expect(result.wantsAnotherPage).toBe(false);
    });
  });
});

describe('describeSelection', () => {
  it('states the count and what was filtered, before anything happens', () => {
    const selection = select({ candidates: [good('1'), good('2'), dormant('3')] });

    const text = describeSelection(selection, '@alice');

    expect(text).toContain('Follow 2 accounts @alice follows');
    expect(text).toContain('1 skipped as dormant or too quiet');
  });

  it('mentions accounts already followed', () => {
    const selection = select({
      candidates: [good('1'), good('2')],
      isFollowing: (account) => account.id === '2',
    });

    expect(describeSelection(selection, '@alice')).toContain('1 already followed');
  });

  it('singularises one adoption', () => {
    const selection = select({ candidates: [good('1')] });

    expect(describeSelection(selection, '@alice')).toBe('Follow 1 account @alice follows?');
  });

  it('explains an empty result caused by filtering, not by an empty list', () => {
    const selection = select({ candidates: [dormant('1'), dormant('2')] });

    expect(describeSelection(selection, '@alice')).toContain('look active enough');
  });

  it('explains an empty result caused by already following everyone', () => {
    const selection = select({ candidates: [good('1')], isFollowing: () => true });

    expect(describeSelection(selection, '@alice')).toContain('already follow everyone');
  });

  it('explains an empty result caused by having no slots', () => {
    const selection = select({ candidates: [good('1')], remainingSlots: 0 });

    expect(describeSelection(selection, '@alice')).toContain('no follow slots left');
  });
});
