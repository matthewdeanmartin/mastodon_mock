import { describe, expect, it } from 'vitest';
import { Account, Status } from '../../models';
import {
  accountMatchesFacet,
  accountMatchesNumeric,
  buildAccountFacets,
  condenseStatusesToAuthors,
  filterAccounts,
  inRange,
  mergeAuthors,
} from './account-refine';

/** Minimal Account fixture; override just the fields a test cares about. */
function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: Math.random().toString(36).slice(2),
    username: 'alan',
    acct: 'alan',
    display_name: 'Alan',
    note: '',
    url: '',
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    fields: [],
    ...over,
  };
}

/** Minimal Status fixture carrying only what condensation reads. */
function makeStatus(account: Account, over: Partial<Status> = {}): Status {
  return {
    id: Math.random().toString(36).slice(2),
    created_at: '2026-07-20T12:00:00Z',
    edited_at: null,
    content: '<p>hi</p>',
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account,
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
    language: null,
    media_attachments: [],
    ...over,
  };
}

describe('inRange', () => {
  it('passes everything when the range is undefined', () => {
    expect(inRange(500, undefined)).toBe(true);
  });
  it('treats an unset bound as open on that side', () => {
    expect(inRange(5, { min: 10 })).toBe(false);
    expect(inRange(50, { min: 10 })).toBe(true);
    expect(inRange(50, { max: 10 })).toBe(false);
    expect(inRange(5, { max: 10 })).toBe(true);
  });
  it('is inclusive on both bounds', () => {
    expect(inRange(10, { min: 10, max: 20 })).toBe(true);
    expect(inRange(20, { min: 10, max: 20 })).toBe(true);
    expect(inRange(21, { min: 10, max: 20 })).toBe(false);
  });
});

describe('accountMatchesNumeric', () => {
  it('ANDs the three gates', () => {
    const a = makeAccount({ followers_count: 500, following_count: 50, statuses_count: 2000 });
    // A "real person": lots of posts, moderate followers, follows some people.
    expect(
      accountMatchesNumeric(a, {
        followers: { max: 5000 },
        following: { min: 10 },
        statuses: { min: 100 },
      }),
    ).toBe(true);
  });
  it('rejects a celebrity when capping followers', () => {
    const celeb = makeAccount({ followers_count: 2_000_000, following_count: 3 });
    expect(accountMatchesNumeric(celeb, { followers: { max: 10_000 } })).toBe(false);
  });
  it('rejects a dead account when requiring recent-ish activity via post count', () => {
    const dead = makeAccount({ statuses_count: 2 });
    expect(accountMatchesNumeric(dead, { statuses: { min: 50 } })).toBe(false);
  });
  it('passes when no bounds are set', () => {
    expect(accountMatchesNumeric(makeAccount(), {})).toBe(true);
  });
});

describe('filterAccounts', () => {
  const accounts = [
    makeAccount({
      display_name: 'Jane Economist',
      acct: 'jane@econ.social',
      note: '<p>I study inflation</p>',
    }),
    makeAccount({ display_name: 'Bob', acct: 'bob@tech.example', note: '<p>rust and go</p>' }),
  ];
  it('returns everything for an empty filter', () => {
    expect(filterAccounts(accounts, '   ')).toHaveLength(2);
  });
  it('matches display name', () => {
    expect(filterAccounts(accounts, 'jane')).toHaveLength(1);
  });
  it('matches handle', () => {
    expect(filterAccounts(accounts, 'tech.example')).toHaveLength(1);
  });
  it('matches bio text with tags stripped', () => {
    expect(filterAccounts(accounts, 'inflation')[0].display_name).toBe('Jane Economist');
  });
});

describe('condenseStatusesToAuthors', () => {
  it('dedupes by account id and preserves first-seen order', () => {
    const a = makeAccount({ id: 'a', display_name: 'Ada' });
    const b = makeAccount({ id: 'b', display_name: 'Bo' });
    const result = condenseStatusesToAuthors([
      makeStatus(a, { id: 's1' }),
      makeStatus(b, { id: 's2' }),
      makeStatus(a, { id: 's3' }),
    ]);
    expect(result.map((r) => r.account.id)).toEqual(['a', 'b']);
  });
  it('attaches every matching post in appearance order', () => {
    const a = makeAccount({ id: 'a' });
    const result = condenseStatusesToAuthors([
      makeStatus(a, { id: 's1' }),
      makeStatus(a, { id: 's3' }),
      makeStatus(a, { id: 's2' }),
    ]);
    expect(result[0].matchingPosts.map((s) => s.id)).toEqual(['s1', 's3', 's2']);
  });
  it('skips statuses without an account id', () => {
    const bad = makeStatus(makeAccount(), { account: { id: '' } as Account });
    expect(condenseStatusesToAuthors([bad])).toHaveLength(0);
  });
});

describe('mergeAuthors', () => {
  it('dedupes across inputs, first-seen wins, posts concatenate', () => {
    const a1 = { account: makeAccount({ id: 'a', display_name: 'From bio' }), matchingPosts: [] };
    const a2 = {
      account: makeAccount({ id: 'a', display_name: 'From posts' }),
      matchingPosts: [makeStatus(makeAccount({ id: 'a' }), { id: 'p1' })],
    };
    const c = { account: makeAccount({ id: 'c' }), matchingPosts: [] };
    const merged = mergeAuthors([a1], [a2, c]);
    expect(merged.map((m) => m.account.id)).toEqual(['a', 'c']);
    expect(merged[0].account.display_name).toBe('From bio'); // first-seen wins
    expect(merged[0].matchingPosts.map((p) => p.id)).toEqual(['p1']); // posts merged in
  });
});

describe('buildAccountFacets', () => {
  it('returns nothing for an empty set', () => {
    expect(buildAccountFacets([])).toEqual([]);
  });

  it('omits facets that do not discriminate', () => {
    // All local, all human, all open, all in one follower bucket → no facets.
    const same = [makeAccount({ acct: 'a' }), makeAccount({ acct: 'b' })];
    expect(buildAccountFacets(same)).toEqual([]);
  });

  it('builds a domain facet from mixed hosts', () => {
    const accounts = [
      makeAccount({ acct: 'a@econ.social' }),
      makeAccount({ acct: 'b@econ.social' }),
      makeAccount({ acct: 'c@tech.example' }),
    ];
    const domain = buildAccountFacets(accounts).find((f) => f.kind === 'domain');
    expect(domain).toBeTruthy();
    expect(domain!.values[0]).toMatchObject({ value: 'econ.social', count: 2 });
  });

  it('buckets follower counts and keeps small→large order', () => {
    const accounts = [
      makeAccount({ followers_count: 50 }),
      makeAccount({ followers_count: 500 }),
      makeAccount({ followers_count: 50_000 }),
    ];
    const followers = buildAccountFacets(accounts).find((f) => f.kind === 'followers');
    expect(followers!.values.map((v) => v.value)).toEqual(['0-99', '100-999', '10000+']);
  });

  it('builds a bot facet when the set is mixed', () => {
    const accounts = [makeAccount({ bot: true }), makeAccount({ bot: false })];
    expect(buildAccountFacets(accounts).some((f) => f.kind === 'bot')).toBe(true);
  });
});

describe('accountMatchesFacet', () => {
  it('matches domain, treating local as "local"', () => {
    expect(
      accountMatchesFacet(makeAccount({ acct: 'x@econ.social' }), 'domain', 'econ.social'),
    ).toBe(true);
    expect(accountMatchesFacet(makeAccount({ acct: 'local' }), 'domain', 'local')).toBe(true);
  });
  it('matches bot / human buckets', () => {
    expect(accountMatchesFacet(makeAccount({ bot: true }), 'bot', 'bot')).toBe(true);
    expect(accountMatchesFacet(makeAccount({ bot: false }), 'bot', 'human')).toBe(true);
  });
  it('matches the follower bucket the account falls in', () => {
    expect(accountMatchesFacet(makeAccount({ followers_count: 500 }), 'followers', '100-999')).toBe(
      true,
    );
    expect(accountMatchesFacet(makeAccount({ followers_count: 500 }), 'followers', '10000+')).toBe(
      false,
    );
  });
});
