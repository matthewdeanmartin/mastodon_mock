import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../auth';
import { ProfileAccountKey } from '../providers/account/profile-account-key';
import { SupporterStatus } from '../providers/account/supporter-status';
import { FoundFeed } from '../providers/rss/friend-feed-cache';
import { FriendFeedScan, FriendScanResult } from '../providers/rss/friend-feed-scan';
import { RssSubscriptions } from '../providers/rss/rss-subscriptions';
import { FriendFeedsDialog } from './friend-feeds-dialog';

function feed(url: string, via = 'ana'): FoundFeed {
  return { url, title: `Blog at ${url}`, siteUrl: url, via };
}

function result(feeds: FoundFeed[], partial = false): FriendScanResult {
  return {
    feeds,
    opml: '<opml />',
    generatedAt: Date.now(),
    checkedCount: 12,
    partial,
  };
}

describe('FriendFeedsDialog', () => {
  let supporter: { isSupporter: ReturnType<typeof vi.fn> };
  let scan: {
    progress: ReturnType<typeof signal>;
    result: ReturnType<typeof signal>;
    running: ReturnType<typeof vi.fn>;
    percent: ReturnType<typeof vi.fn>;
    available: ReturnType<typeof vi.fn>;
    scan: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    loadStored: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    supporter = { isSupporter: vi.fn().mockReturnValue(true) };
    scan = {
      progress: signal(null),
      result: signal(null),
      running: vi.fn().mockReturnValue(false),
      percent: vi.fn().mockReturnValue(null),
      available: vi.fn().mockReturnValue(true),
      scan: vi.fn().mockResolvedValue(null),
      stop: vi.fn(),
      loadStored: vi.fn().mockResolvedValue(null),
      forget: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      imports: [FriendFeedsDialog],
      providers: [
        provideRouter([]),
        { provide: SupporterStatus, useValue: supporter },
        { provide: FriendFeedScan, useValue: scan },
        { provide: ProfileAccountKey, useValue: { current: () => 'account-1' } },
        // The scan walks *your* following list, so it needs an account to walk.
        // Signed out is a real state the dialog handles, but it is not the one
        // most of these tests are about.
        { provide: Auth, useValue: { account: signal({ id: 'me', acct: 'me' }) } },
      ],
    });
  });

  function render(): ComponentFixture<FriendFeedsDialog> {
    const fixture = TestBed.createComponent(FriendFeedsDialog);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ComponentFixture<FriendFeedsDialog>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('offers the upsell rather than the scan when the account is not Plus', () => {
    // Visible to everyone on purpose: a feature nobody can see is a feature
    // nobody upgrades for. What must not happen is it being *runnable*.
    supporter.isSupporter.mockReturnValue(false);

    const fixture = render();

    expect(text(fixture)).toContain('Part of Mawkingbird Plus');
    const buttons = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ];
    expect(buttons.some((b) => b.textContent?.includes('Start checking'))).toBe(false);
  });

  it('quotes the cost in sites before anything is spent', () => {
    const fixture = render();

    // Sites, not accounts: one profile carries up to four links, so only the
    // site count maps to requests actually made.
    expect(text(fixture)).toContain('500 sites');
  });

  it('will not start without a proxy to fetch through', () => {
    scan.available.mockReturnValue(false);

    const fixture = render();

    const start = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('Start checking'));
    expect(start?.disabled).toBe(true);
  });

  it('shows what was found and never what was not', () => {
    scan.result.set(result([feed('https://one.example/feed.xml')]));

    const fixture = render();
    const body = text(fixture);

    expect(body).toContain('Blog at https://one.example/feed.xml');
    expect(body).toContain('from ana');
    // The sites that had nothing are one number, not hundreds of rows.
    expect(body).toContain('checked 12 sites');
  });

  it('says a stopped run may have missed things', () => {
    scan.result.set(result([feed('https://one.example/feed.xml')], true));

    expect(text(render())).toContain('Stopped before the end');
  });

  it('reports finding nothing as a plain answer', () => {
    scan.result.set(result([]));

    const fixture = render();

    expect(text(fixture)).toContain('No feeds found');
    // Nothing to download and nothing to follow, so neither is offered.
    const labels = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ].map((b) => b.textContent?.trim());
    expect(labels.some((l) => l?.includes('Follow all'))).toBe(false);
    expect(labels.some((l) => l?.includes('Download'))).toBe(false);
  });

  it('fills to the subscription limit and says what was left over', () => {
    // The user asked for all of them, so they should get as many as they can
    // have — and then be told plainly why the rest did not fit, with the lever
    // that fixes it named.
    const subs = TestBed.inject(RssSubscriptions);
    subs.setLimit(2);
    scan.result.set(
      result([
        feed('https://one.example/feed.xml'),
        feed('https://two.example/feed.xml'),
        feed('https://three.example/feed.xml'),
      ]),
    );

    const fixture = render();
    const followAll = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.includes('Follow all'));
    followAll?.click();
    fixture.detectChanges();

    expect(subs.feeds()).toHaveLength(2);
    const body = text(fixture);
    expect(body).toContain('Added 2');
    expect(body).toContain('2-feed limit');
  });

  it('marks a feed as followed once it has been added', () => {
    const subs = TestBed.inject(RssSubscriptions);
    scan.result.set(result([feed('https://one.example/feed.xml')]));

    const fixture = render();
    const follow = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.trim() === 'Follow');
    follow?.click();
    fixture.detectChanges();

    expect(subs.has('https://one.example/feed.xml')).toBe(true);
    expect(text(fixture)).toContain('Following');
  });

  it('reopens on the stored result rather than asking to scan again', async () => {
    // The result is the expensive part and it is already paid for.
    scan.loadStored.mockResolvedValue(result([feed('https://one.example/feed.xml')]));

    render();
    await Promise.resolve();

    expect(scan.loadStored).toHaveBeenCalledWith('account-1');
  });
});
