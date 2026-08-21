import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MawkingbirdMetrics } from '../../observability/mawkingbird-metrics';
import { ACCOUNT_ORIGIN, AUTH_ORIGIN, MawkingbirdSession, type Tier } from './mawkingbird-session';

const AUTH = 'https://auth.example.test';
const ACCOUNT = 'https://account.example.test';
const NOW = 1_800_000_000_000;

function minted(token: string, tier: Tier, expiresInSeconds = 3_600): Response {
  return Response.json({
    token,
    expiresAt: NOW / 1_000 + expiresInSeconds,
    auth: 'email',
    tier,
  });
}

describe('MawkingbirdSession token lifecycle', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let session: MawkingbirdSession;

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [
        MawkingbirdSession,
        { provide: AUTH_ORIGIN, useValue: AUTH },
        { provide: ACCOUNT_ORIGIN, useValue: ACCOUNT },
        { provide: MawkingbirdMetrics, useValue: { record: vi.fn() } },
      ],
    });
    session = TestBed.inject(MawkingbirdSession);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reuses a fresh token instead of spending another mint request', async () => {
    fetchMock.mockResolvedValueOnce(minted('free-token', 'free'));

    await expect(session.token()).resolves.toBe('free-token');
    await expect(session.token()).resolves.toBe('free-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws away a still-fresh free claim when Plus entitlement is confirmed', async () => {
    fetchMock
      .mockResolvedValueOnce(minted('stale-free-token', 'free'))
      .mockResolvedValueOnce(minted('fresh-plus-token', 'plus'));

    await expect(session.token()).resolves.toBe('stale-free-token');
    await expect(session.upgradeIfStale(true)).resolves.toBe(true);
    await expect(session.token()).resolves.toBe('fresh-plus-token');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as unknown),
    ).toEqual([{ grant: 'cookie' }, { grant: 'cookie' }]);
    expect(session.heldTier()).toBe('plus');
  });

  it('does not re-mint a free token without positive entitlement evidence', async () => {
    fetchMock.mockResolvedValueOnce(minted('free-token', 'free'));

    await session.token();
    await expect(session.upgradeIfStale(false)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.heldTier()).toBe('free');
  });

  it('does not re-mint when the held claim is already Plus', async () => {
    fetchMock.mockResolvedValueOnce(minted('plus-token', 'plus'));

    await session.token();
    await expect(session.upgradeIfStale(true)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one mint between concurrent profile callers', async () => {
    fetchMock.mockResolvedValueOnce(minted('shared-token', 'plus'));

    await expect(Promise.all([session.token(), session.token(), session.token()])).resolves.toEqual(
      ['shared-token', 'shared-token', 'shared-token'],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-mints inside the two-minute expiry safety margin', async () => {
    fetchMock
      .mockResolvedValueOnce(minted('nearly-expired', 'plus', 119))
      .mockResolvedValueOnce(minted('replacement', 'plus'));

    await expect(session.token()).resolves.toBe('nearly-expired');
    await expect(session.token()).resolves.toBe('replacement');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
