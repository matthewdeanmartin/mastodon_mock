import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account } from '../../../models';
import { Auth } from '../../../auth';
import {
  ANONYMOUS_FOLLOW_LIMIT,
  AnonymousFollows,
} from '../../../providers/anonymous/anonymous-follows';
import { CloneFriendsDialog } from './clone-friends-dialog';

const DAY = 24 * 60 * 60 * 1000;

function account(id: string, over: Partial<Account> = {}): Account {
  return {
    id,
    username: `user${id}`,
    acct: `user${id}@example.social`,
    display_name: `User ${id}`,
    note: '',
    url: `https://example.social/@user${id}`,
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 100,
    following_count: 100,
    statuses_count: 900,
    last_status_at: new Date(Date.now() - DAY).toISOString(),
    bot: false,
    locked: false,
    fields: [],
    ...over,
  };
}

/** Dormant for over a year — the common case in a real follow list. */
function dormant(id: string): Account {
  return account(id, { last_status_at: new Date(Date.now() - 400 * DAY).toISOString() });
}

describe('CloneFriendsDialog', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
  });

  function open(target = account('900')): ComponentFixture<CloneFriendsDialog> {
    const fixture = TestBed.createComponent(CloneFriendsDialog);
    fixture.componentRef.setInput('account', target);
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Wait for the next `/following` request and hand it back.
   *
   * `match` both finds and *consumes*, so the request has to be captured inside the
   * poll rather than looked up again afterwards.
   */
  async function nextFollowingRequest() {
    let found!: ReturnType<HttpTestingController['match']>[number];
    await vi.waitFor(() => {
      const matches = httpMock.match((r) => r.url.includes('/following'));
      expect(matches.length).toBeGreaterThan(0);
      found = matches[0];
    });
    return found;
  }

  /** Flush the next `/following` page. */
  async function flushPage(page: Account[]): Promise<void> {
    (await nextFollowingRequest()).flush(page);
  }

  function text(fixture: ComponentFixture<CloneFriendsDialog>): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function clickButton(fixture: ComponentFixture<CloneFriendsDialog>, label: string): void {
    fixture.detectChanges();
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes(label))!
      .click();
  }

  it('lists who it will follow and what it filtered, before following anything', async () => {
    const fixture = open();
    await flushPage([account('1'), dormant('2'), account('3')]);

    const body = text(fixture);
    expect(body).toContain('Follow 2 accounts');
    expect(body).toContain('1 skipped');
    // Nothing has happened yet — this is a confirm step, not a report.
    expect(TestBed.inject(AnonymousFollows).count()).toBe(0);
  });

  it('follows locally on confirm, with no write requests at all', async () => {
    // The safety property, asserted at the HTTP boundary: an anonymous clone is
    // localStorage writes, never POST /follow.
    const fixture = open();
    await flushPage([account('1'), account('2')]);

    clickButton(fixture, 'Follow 2');
    await vi.waitFor(() => expect(text(fixture)).toContain('Followed 2 accounts'));

    expect(TestBed.inject(AnonymousFollows).count()).toBe(2);
    httpMock.expectNone((r) => r.method === 'POST');
  });

  it('emits how many it followed', async () => {
    const fixture = open();
    const cloned: number[] = [];
    fixture.componentInstance.cloned.subscribe((n) => cloned.push(n));
    await flushPage([account('1')]);

    clickButton(fixture, 'Follow 1');
    await vi.waitFor(() => expect(cloned).toEqual([1]));
  });

  it('pages when the quality gate ate most of a full page', async () => {
    const fixture = open();
    // 80 back, 79 dormant: one keeper, so it must ask for more.
    await flushPage([...Array.from({ length: 79 }, (_, i) => dormant(`d${i}`)), account('keep')]);
    await flushPage([account('good1'), account('good2')]);

    expect(text(fixture)).toContain('Follow 3 accounts');
  });

  it('stops paging when a short page proves there is no more', async () => {
    const fixture = open();
    await flushPage([account('1')]);

    await vi.waitFor(() => expect(text(fixture)).toContain('Follow 1 account'));
    httpMock.expectNone((r) => r.url.includes('/following'));
  });

  it('says so when everything was filtered out, rather than showing an empty list', async () => {
    const fixture = open();
    await flushPage([dormant('1'), dormant('2')]);

    expect(text(fixture)).toContain('look active enough');
  });

  it('respects the follow cap and says how many slots are left', async () => {
    const follows = TestBed.inject(AnonymousFollows);
    for (let i = 0; i < ANONYMOUS_FOLLOW_LIMIT - 3; i += 1) {
      follows.follow(account(`existing${i}`), 'https://mastodon.social');
    }
    const fixture = open();
    await flushPage(Array.from({ length: 20 }, (_, i) => account(`new${i}`)));

    const body = text(fixture);
    expect(body).toContain('Follow 3');
    expect(body).toContain('3 of 50 follow slots left');
  });

  it('surfaces a failed load instead of an empty confirm screen', async () => {
    const fixture = open();
    (await nextFollowingRequest()).flush('', { status: 500, statusText: 'Server Error' });

    await vi.waitFor(() => expect(text(fixture)).toContain("Couldn't load"));
  });

  it('closes on cancel without following anyone', async () => {
    const fixture = open();
    const closed: unknown[] = [];
    fixture.componentInstance.closed.subscribe(() => closed.push(true));
    await flushPage([account('1')]);

    clickButton(fixture, 'Cancel');

    expect(closed).toHaveLength(1);
    expect(TestBed.inject(AnonymousFollows).count()).toBe(0);
  });
});
