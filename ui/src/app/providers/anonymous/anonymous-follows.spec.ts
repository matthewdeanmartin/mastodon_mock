import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models';
import { ANONYMOUS_FOLLOW_LIMIT, AnonymousFollows } from './anonymous-follows';

function account(username: string, host = 'example.social'): Account {
  return {
    id: `${host}:${username}`,
    username,
    acct: `${username}@${host}`,
    display_name: username,
    note: '',
    url: `https://${host}/@${username}`,
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    fields: [],
  };
}

describe('AnonymousFollows', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('persists a canonical cross-instance follow and synthesizes relationships', () => {
    const follows = TestBed.inject(AnonymousFollows);
    const target = account('Alice', 'social.example');

    expect(follows.follow(target, 'https://mastodon.social').ok).toBe(true);
    expect(follows.relationship(target, 'https://mastodon.social').following).toBe(true);
    expect(follows.follows()[0].key).toBe('alice@social.example');
    expect(follows.follows()[0].server).toBe('https://social.example');
    expect(follows.follows()[0].readRef).toEqual({
      server: 'https://mastodon.social',
      accountId: 'social.example:Alice',
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(AnonymousFollows).count()).toBe(1);
  });

  it('deduplicates different account ids for the same federated identity', () => {
    const follows = TestBed.inject(AnonymousFollows);
    follows.follow(account('alice'), 'https://mastodon.social');
    follows.follow({ ...account('alice'), id: 'another-server-id' }, 'https://other.example');

    expect(follows.count()).toBe(1);
  });

  it('unfollows locally', () => {
    const follows = TestBed.inject(AnonymousFollows);
    const target = account('alice');
    follows.follow(target, 'https://mastodon.social');

    expect(follows.unfollow(target, 'https://mastodon.social').following).toBe(false);
    expect(follows.count()).toBe(0);
  });

  it('rejects the twenty-first unique follow with a useful error', () => {
    const follows = TestBed.inject(AnonymousFollows);
    for (let index = 0; index < ANONYMOUS_FOLLOW_LIMIT; index += 1) {
      follows.follow(account(`user${index}`), 'https://mastodon.social');
    }

    const result = follows.follow(account('one-too-many'), 'https://mastodon.social');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected the follow limit to reject this account.');
    }
    expect(result.error).toContain('up to 20');
    expect(follows.count()).toBe(ANONYMOUS_FOLLOW_LIMIT);
  });

  it('recovers from malformed storage', () => {
    localStorage.setItem('mockingbird_anonymous_follows', '{nope');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});

    expect(TestBed.inject(AnonymousFollows).follows()).toEqual([]);
  });

  it('replaces incompatible older storage instead of migrating it', () => {
    localStorage.setItem(
      'mockingbird_anonymous_follows',
      JSON.stringify({ version: 1, follows: [{ key: 'alice@example.social' }] }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});

    expect(TestBed.inject(AnonymousFollows).follows()).toEqual([]);
  });

  it('persists route-specific backoff without extending an active failure window', () => {
    const follows = TestBed.inject(AnonymousFollows);
    follows.follow(account('alice'), 'https://mastodon.social');
    const key = follows.follows()[0].key;

    follows.markRouteFailure(key, 'canonical-api');
    const retryAfter = follows.follows()[0].routeRetryAfter['canonical-api'];
    follows.markRouteFailure(key, 'canonical-api');
    expect(follows.routeDeferred(follows.follows()[0], 'canonical-api')).toBe(true);
    expect(follows.routeDeferred(follows.follows()[0], 'read-api')).toBe(false);
    expect(follows.follows()[0].routeRetryAfter['canonical-api']).toBe(retryAfter);

    follows.clearBackoff(key);
    expect(follows.hasBackoff(follows.follows()[0])).toBe(false);
  });
});
