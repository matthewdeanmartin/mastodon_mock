import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { AudienceScan } from './audience-scan';
import { AnonymousPublicApi } from './providers/anonymous/anonymous-public-api';
import { Account } from './models';

const DAY = 86_400_000;

/** An account that scores as active: posted yesterday, long history. */
function live(id: string): Account {
  return {
    id,
    acct: `user${id}`,
    username: `user${id}`,
    display_name: `user${id}`,
    statuses_count: 1_200,
    last_status_at: new Date(Date.now() - DAY).toISOString(),
    created_at: new Date(Date.now() - 400 * DAY).toISOString(),
  } as Account;
}

/** An account that scores as a zombie: silent for months, lifetime drizzle. */
function zombie(id: string): Account {
  return {
    id,
    acct: `user${id}`,
    username: `user${id}`,
    display_name: `user${id}`,
    statuses_count: 180,
    last_status_at: new Date(Date.now() - 90 * DAY).toISOString(),
    created_at: new Date(Date.now() - 1825 * DAY).toISOString(),
  } as Account;
}

/** `count` accounts, alternating live/zombie, with unique ids from `start`. */
function page(start: number, count: number): Account[] {
  return Array.from({ length: count }, (_, i) =>
    (start + i) % 2 === 0 ? live(String(start + i)) : zombie(String(start + i)),
  );
}

function fakeApi() {
  return {
    accountFollowers: vi.fn((_id: string, _maxId?: string, _limit?: number) =>
      of([] as Account[]),
    ),
    accountFollowing: vi.fn((_id: string, _maxId?: string, _limit?: number) =>
      of([] as Account[]),
    ),
  };
}

function fakeAnonymous() {
  return {
    getAccountFollowers: vi.fn((_ref: { server: string; id: string }, _maxId?: string) =>
      of([] as Account[]),
    ),
    getAccountFollowing: vi.fn((_ref: { server: string; id: string }, _maxId?: string) =>
      of([] as Account[]),
    ),
  };
}

describe('AudienceScan', () => {
  let api: ReturnType<typeof fakeApi>;
  let anonymous: ReturnType<typeof fakeAnonymous>;
  let scan: AudienceScan;

  beforeEach(() => {
    api = fakeApi();
    anonymous = fakeAnonymous();
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: api },
        { provide: AnonymousPublicApi, useValue: anonymous },
      ],
    });
    scan = TestBed.inject(AudienceScan);
  });

  it('stops paging when a short page says the list is exhausted', async () => {
    api.accountFollowers.mockReturnValueOnce(of(page(0, 30)));

    await scan.start({
      accountId: '1',
      followersTotal: 30,
      followingTotal: 0,
      sides: ['followers'],
    });

    expect(api.accountFollowers).toHaveBeenCalledTimes(1);
    const result = scan.state()?.results.followers;
    expect(result?.scanned).toBe(30);
    expect(result?.complete).toBe(true);
  });

  it('follows the cursor across full pages', async () => {
    api.accountFollowers
      .mockReturnValueOnce(of(page(0, 80)))
      .mockReturnValueOnce(of(page(80, 80)))
      .mockReturnValueOnce(of(page(160, 10)));

    await scan.start({
      accountId: '1',
      followersTotal: 170,
      followingTotal: 0,
      sides: ['followers'],
    });

    expect(api.accountFollowers).toHaveBeenCalledTimes(3);
    // Second call must carry the last id of the first page as the cursor.
    expect(api.accountFollowers.mock.calls[1][1]).toBe('79');
    expect(scan.state()?.results.followers?.scanned).toBe(170);
  });

  it('scores active and zombie accounts as it pages', async () => {
    // 40 accounts, alternating — 20 live, 20 zombie.
    api.accountFollowers.mockReturnValueOnce(of(page(0, 40)));

    await scan.start({
      accountId: '1',
      followersTotal: 40,
      followingTotal: 0,
      sides: ['followers'],
    });

    const result = scan.state()?.results.followers;
    expect(result?.active).toBe(20);
    expect(result?.zombies).toBe(20);
    expect(result?.effectiveRatePct).toBe(50);
    expect(result?.zombieRatePct).toBe(50);
  });

  it('scans both sides when both are requested', async () => {
    api.accountFollowing.mockReturnValueOnce(of(page(0, 10)));
    api.accountFollowers.mockReturnValueOnce(of(page(0, 20)));

    await scan.start({
      accountId: '1',
      followersTotal: 20,
      followingTotal: 10,
      sides: ['following', 'followers'],
    });

    expect(scan.state()?.results.following?.scanned).toBe(10);
    expect(scan.state()?.results.followers?.scanned).toBe(20);
  });

  /**
   * The core of the stop-early contract: unlike a cancelled bulk *write*
   * preview, a cancelled read keeps what it measured and reports it as a
   * sample. Discarding it would throw away a perfectly good estimate.
   */
  it('keeps a partial tally when cancelled, and extrapolates it', async () => {
    api.accountFollowers.mockImplementation((_id, _maxId) => {
      // Cancel after the first page lands, so the walk stops with 80 of 400 read.
      scan.cancel();
      return of(page(0, 80));
    });

    await scan.start({
      accountId: '1',
      followersTotal: 400,
      followingTotal: 0,
      sides: ['followers'],
    });

    const result = scan.state()?.results.followers;
    expect(scan.state()?.phase).toBe('cancelled');
    expect(result?.scanned).toBe(80);
    expect(result?.complete).toBe(false);
    expect(result?.coverage).toBeCloseTo(0.2, 5);
    // 40 of 80 active → scaled to 400 gives 200.
    expect(result?.effective).toBe(200);
  });

  it('does not start the second side after a cancel', async () => {
    api.accountFollowing.mockImplementation(() => {
      scan.cancel();
      return of(page(0, 10));
    });

    await scan.start({
      accountId: '1',
      followersTotal: 500,
      followingTotal: 10,
      sides: ['following', 'followers'],
    });

    expect(api.accountFollowers).not.toHaveBeenCalled();
    expect(scan.state()?.results.following).toBeDefined();
    expect(scan.state()?.results.followers).toBeUndefined();
  });

  it('reports a failure without claiming numbers', async () => {
    api.accountFollowers.mockReturnValueOnce(throwError(() => new Error('boom')));

    await scan.start({
      accountId: '1',
      followersTotal: 100,
      followingTotal: 0,
      sides: ['followers'],
    });

    expect(scan.state()?.phase).toBe('failed');
    expect(scan.state()?.error).toContain('boom');
    expect(scan.state()?.results.followers).toBeUndefined();
  });

  it('routes through the anonymous API for a public profile', async () => {
    anonymous.getAccountFollowers.mockReturnValueOnce(of(page(0, 5)));

    await scan.start({
      accountId: 'local-1',
      followersTotal: 5,
      followingTotal: 0,
      sides: ['followers'],
      publicRef: { server: 'https://mastodon.social', id: 'remote-9' } as never,
    });

    expect(anonymous.getAccountFollowers).toHaveBeenCalled();
    expect(api.accountFollowers).not.toHaveBeenCalled();
    // The ref's id wins over the local account id — they are different namespaces.
    expect(anonymous.getAccountFollowers.mock.calls[0][0]).toMatchObject({ id: 'remote-9' });
  });

  it('refuses to start a second scan while one is running', async () => {
    api.accountFollowers.mockReturnValue(of(page(0, 10)));
    const first = scan.start({
      accountId: '1',
      followersTotal: 10,
      followingTotal: 0,
      sides: ['followers'],
    });
    await scan.start({
      accountId: '2',
      followersTotal: 10,
      followingTotal: 0,
      sides: ['followers'],
    });
    await first;

    expect(api.accountFollowers).toHaveBeenCalledTimes(1);
  });

  it('tracks per-side progress and request counts', async () => {
    api.accountFollowers.mockReturnValueOnce(of(page(0, 40)));

    await scan.start({
      accountId: '1',
      followersTotal: 40,
      followingTotal: 0,
      sides: ['followers'],
    });

    const progress = scan.state()?.progress.followers;
    expect(progress?.scanned).toBe(40);
    expect(progress?.apiCalls).toBe(1);
    expect(progress?.done).toBe(true);
    expect(scan.apiCalls()).toBe(1);
  });
});
