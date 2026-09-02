import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../../api';
import { Account } from '../../models';
import { PageDiagnostics } from '../../page-diagnostics';
import { CorsProxy } from '../cors-proxy/cors-proxy';
import { FriendFeedCache, ProbeRecord } from './friend-feed-cache';
import { FriendFeedScan } from './friend-feed-scan';
import { PasteResolve } from './paste-resolve';

/** An account whose profile fields carry `urls`. */
function account(acct: string, ...urls: string[]): Account {
  return {
    id: acct,
    username: acct,
    acct,
    display_name: acct,
    note: '',
    url: `https://example.social/@${acct}`,
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    fields: urls.map((value, index) => ({ name: `link${index}`, value })),
  };
}

/**
 * An in-memory stand-in for the IndexedDB cache.
 *
 * jsdom has no IndexedDB, so the real class degrades to "no cache" there and
 * every assertion about *not re-probing* would pass vacuously. This fake is
 * what makes the cost-control tests mean something.
 */
class FakeCache {
  records = new Map<string, ProbeRecord>();
  saved: unknown[] = [];

  probes = vi.fn(async () => this.records);
  recordProbe = vi.fn(async (url: string, outcome: ProbeRecord['outcome'], feeds = []) => {
    this.records.set(url, { url, outcome, feeds, probedAt: 1 });
  });
  opml = vi.fn(async () => null);
  saveOpml = vi.fn(async (record: unknown) => {
    this.saved.push(record);
  });
  clear = vi.fn(async () => undefined);
}

describe('FriendFeedScan', () => {
  let api: { accountFollowingPage: ReturnType<typeof vi.fn> };
  let resolver: { resolve: ReturnType<typeof vi.fn> };
  let cache: FakeCache;
  let scan: FriendFeedScan;

  /** One page of `accounts`, with no cursor so the walk stops. */
  function onePage(accounts: Account[]) {
    return of({ accounts, nextMaxId: null, source: 'link' as const });
  }

  /** A resolution reporting one feed on the probed site. */
  function feedFound(url: string) {
    return {
      kind: 'feeds' as const,
      feeds: [{ url: `${url}/feed.xml`, title: 'A blog' }],
      siteUrl: url,
      needsProxy: false,
    };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    api = { accountFollowingPage: vi.fn() };
    resolver = { resolve: vi.fn() };
    cache = new FakeCache();
    TestBed.configureTestingModule({
      providers: [
        FriendFeedScan,
        { provide: Api, useValue: api },
        { provide: PasteResolve, useValue: resolver },
        { provide: FriendFeedCache, useValue: cache },
        { provide: CorsProxy, useValue: { available: () => true } },
        { provide: PageDiagnostics, useValue: { info: vi.fn(), warn: vi.fn() } },
      ],
    });
    scan = TestBed.inject(FriendFeedScan);
  });

  it('probes each site once however many friends link it', async () => {
    // The group-blog case. Three friends, one site, one probe — and the
    // attribution keeps the first handle rather than the last.
    api.accountFollowingPage.mockReturnValue(
      onePage([
        account('ana', 'https://shared.example/'),
        account('ben', 'https://www.shared.example'),
        account('cal', 'https://shared.example/#about'),
      ]),
    );
    resolver.resolve.mockResolvedValue(feedFound('https://shared.example'));

    const result = await scan.scan('me', 'account-1', 500);

    expect(resolver.resolve).toHaveBeenCalledOnce();
    expect(result?.feeds).toHaveLength(1);
    expect(result?.feeds[0].via).toBe('ana');
  });

  it('never re-probes a URL an earlier scan already answered', async () => {
    // The reason the cache exists. A site that had no feed last time is still
    // not going to have one, and re-asking is the expensive half of a re-scan.
    cache.records.set('https://known.example', {
      url: 'https://known.example',
      outcome: 'none',
      feeds: [],
      probedAt: 1,
    });
    api.accountFollowingPage.mockReturnValue(
      onePage([account('ana', 'https://known.example'), account('ben', 'https://fresh.example')]),
    );
    resolver.resolve.mockResolvedValue(feedFound('https://fresh.example'));

    await scan.scan('me', 'account-1', 500);

    expect(resolver.resolve).toHaveBeenCalledOnce();
    expect(resolver.resolve).toHaveBeenCalledWith('https://fresh.example');
  });

  it('retries a site that could not be reached, unlike one that had no feed', async () => {
    // `unreachable` means the site was never actually answered. Believing it
    // would bake one bad afternoon into a permanent "your friend has no blog".
    cache.records.set('https://flaky.example', {
      url: 'https://flaky.example',
      outcome: 'unreachable',
      feeds: [],
      probedAt: 1,
    });
    api.accountFollowingPage.mockReturnValue(onePage([account('ana', 'https://flaky.example')]));
    resolver.resolve.mockResolvedValue(feedFound('https://flaky.example'));

    await scan.scan('me', 'account-1', 500);

    expect(resolver.resolve).toHaveBeenCalledOnce();
  });

  it('records an unreachable site as unreachable, not as feedless', async () => {
    api.accountFollowingPage.mockReturnValue(onePage([account('ana', 'https://down.example')]));
    resolver.resolve.mockRejectedValue(new Error('network'));

    await scan.scan('me', 'account-1', 500);

    expect(cache.recordProbe).toHaveBeenCalledWith('https://down.example', 'unreachable');
  });

  it('spends nothing on hosts that certainly have no per-profile feed', async () => {
    api.accountFollowingPage.mockReturnValue(
      onePage([account('ana', 'https://twitter.com/ana', 'https://linktr.ee/ana')]),
    );

    await scan.scan('me', 'account-1', 500);

    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('stops at the cap and says the result is partial', async () => {
    api.accountFollowingPage.mockReturnValue(
      onePage([
        account('ana', 'https://one.example'),
        account('ben', 'https://two.example'),
        account('cal', 'https://three.example'),
      ]),
    );
    resolver.resolve.mockImplementation((url: string) => Promise.resolve(feedFound(url)));

    const result = await scan.scan('me', 'account-1', 2);

    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    // Partial is the honest label: a third site was never looked at, and the
    // dialog has to be able to say so rather than imply a complete answer.
    expect(result?.partial).toBe(true);
  });

  it('reports a complete run as complete', async () => {
    api.accountFollowingPage.mockReturnValue(onePage([account('ana', 'https://one.example')]));
    resolver.resolve.mockResolvedValue(feedFound('https://one.example'));

    const result = await scan.scan('me', 'account-1', 500);

    expect(result?.partial).toBe(false);
  });

  it('keeps what it found when stopped part-way', async () => {
    // Unlike a bulk write, a partial read is still a real answer: the feeds
    // found so far are exactly as valid as a complete run would have made them.
    api.accountFollowingPage.mockReturnValue(
      onePage([account('ana', 'https://one.example'), account('ben', 'https://two.example')]),
    );
    resolver.resolve.mockImplementation((url: string) => {
      scan.stop();
      return Promise.resolve(feedFound(url));
    });

    const result = await scan.scan('me', 'account-1', 500);

    expect(result?.feeds).toHaveLength(1);
    expect(result?.partial).toBe(true);
  });

  it('builds an OPML document and stores it against the account', async () => {
    api.accountFollowingPage.mockReturnValue(onePage([account('ana', 'https://one.example')]));
    resolver.resolve.mockResolvedValue(feedFound('https://one.example'));

    const result = await scan.scan('me', 'account-1', 500);

    expect(result?.opml).toContain('https://one.example/feed.xml');
    expect(cache.saveOpml).toHaveBeenCalledOnce();
    expect(cache.saved[0]).toMatchObject({ accountKey: 'account-1', feedCount: 1 });
  });

  it('ignores profile fields that are not links at all', async () => {
    // Pronouns, an email address and a location are what profile fields are
    // mostly full of. Each one that reached the prober would cost a fetch.
    api.accountFollowingPage.mockReturnValue(
      onePage([account('ana', 'she/her', 'mailto:ana@example.com', 'Berlin')]),
    );

    await scan.scan('me', 'account-1', 500);

    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('reads the href out of a rendered profile link', async () => {
    // Mastodon sends field values as HTML; servers vary, so both shapes matter.
    api.accountFollowingPage.mockReturnValue(
      onePage([account('ana', '<a href="https://one.example" rel="me">one.example</a>')]),
    );
    resolver.resolve.mockResolvedValue(feedFound('https://one.example'));

    await scan.scan('me', 'account-1', 500);

    expect(resolver.resolve).toHaveBeenCalledWith('https://one.example');
  });

  it('walks every page of the following list', async () => {
    api.accountFollowingPage
      .mockReturnValueOnce(of({ accounts: [account('ana')], nextMaxId: 'p2', source: 'link' }))
      .mockReturnValueOnce(of({ accounts: [account('ben')], nextMaxId: null, source: 'link' }));

    await scan.scan('me', 'account-1', 500);

    expect(api.accountFollowingPage).toHaveBeenCalledTimes(2);
  });
});
