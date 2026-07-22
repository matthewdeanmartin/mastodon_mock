import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientPrefs } from '../../client-prefs';
import { HomeDiagnostics } from '../../home-diagnostics';
import { Status } from '../../models';
import { Streaming } from '../../streaming';
import { FakeStreaming } from '../../testing/fake-streaming';
import { Home } from './home';
import { Auth } from '../../auth';
import { AnonymousHomeFeedCache } from '../../providers/anonymous/anonymous-home-feed-cache';

/** Exposes Home's protected signals for white-box testing. */
interface HomeInternals {
  statuses: Signal<Status[]>;
  visible: Signal<Status[]>;
  live: WritableSignal<boolean>;
  autoLoading: Signal<boolean>;
  capActive: Signal<boolean>;
  canLoadMore: Signal<boolean>;
  eliza: { follow(): void; unfollow(): void };
  toggleLive(): void;
  loadMore(): void;
}

function internals(fixture: ComponentFixture<Home>): HomeInternals {
  return fixture.componentInstance as unknown as HomeInternals;
}

function makeStatus(id: string): Status {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: `<p>status ${id}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: '1', username: 'alan', acct: 'alan', display_name: 'Alan' } as Status['account'],
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
  };
}

describe('Home', () => {
  let httpMock: HttpTestingController;
  let fakeStreaming: FakeStreaming;
  let diagnostics: Pick<HomeDiagnostics, 'info' | 'warn' | 'error'>;

  beforeEach(() => {
    fakeStreaming = new FakeStreaming();
    diagnostics = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Streaming, useValue: fakeStreaming },
        { provide: HomeDiagnostics, useValue: diagnostics },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  function setUp(): ComponentFixture<Home> {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush([]);
    httpMock.expectOne('/api/v1/announcements').flush([]);
    return fixture;
  }

  /** Toggle live on and flush the fresh-snapshot refetch that going live triggers. */
  function goLive(fixture: ComponentFixture<Home>): void {
    internals(fixture).toggleLive();
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush([]);
  }

  it('reports an empty first page with enough context to diagnose filtering', () => {
    setUp();

    expect(diagnostics.warn).toHaveBeenCalledWith(
      'load:first-page-empty',
      expect.objectContaining({ received: 0, stored: 0, visible: 0 }),
    );
  });

  it('reuses a populated Anonymous feed until the user explicitly refreshes', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const cached = { ...makeStatus('cached'), provider: 'anonymous-mastodon' } as Status;
    TestBed.inject(AnonymousHomeFeedCache).store(
      [cached],
      JSON.stringify({ follows: [], tags: [] }),
    );

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    expect(
      internals(fixture)
        .statuses()
        .map((status) => status.id),
    ).toEqual(['cached']);
    httpMock.expectNone((request) => request.url.includes('/statuses'));

    fixture.componentInstance.load(true);
    expect(internals(fixture).statuses()).toEqual([]);
  });

  it('offers the universal starter pack in an empty zero-follow Anonymous feed', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector(
      '.starter-pack-universal a',
    ) as HTMLAnchorElement;
    expect(link.textContent).toContain('Get your account started with the universal starter pack');
    expect(link.getAttribute('href')).toBe('/collections/starter');
    const loginPost = fixture.nativeElement.querySelector(
      '.anonymous-login-post',
    ) as HTMLAnchorElement;
    expect(loginPost.textContent).toContain(
      'Login or create an account to post content, reply and more',
    );
    expect(loginPost.textContent).toContain('Pinned');
    expect(loginPost.getAttribute('href')).toBe('/login');
  });

  it('keeps the starter pack after following Eliza (still few real friends)', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    // Follow Eliza — her posts now fill the feed, but the onboarding cards must stay.
    (fixture.componentInstance as unknown as { eliza: { follow(): void } }).eliza.follow();
    fixture.detectChanges();

    const starter = fixture.nativeElement.querySelector('.starter-pack-universal a');
    expect(starter).not.toBeNull();
    // The Eliza invite, however, retires once she's followed.
    expect(fixture.nativeElement.querySelector('.eliza-invite')).toBeNull();
    // And the feed is no longer empty.
    expect(
      (fixture.componentInstance as unknown as { visible: () => unknown[] }).visible().length,
    ).toBeGreaterThan(0);
  });

  it('shows the Anonymous practice composer only after Eliza is followed', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-local-compose')).toBeNull();

    internals(fixture).eliza.follow();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-local-compose')).not.toBeNull();
  });

  it('toggleLive() opens a user stream and flips the live flag', () => {
    const fixture = setUp();
    goLive(fixture);

    expect(internals(fixture).live()).toBe(true);
    expect(fakeStreaming.lastKind).toEqual({ stream: 'user' });
  });

  it('prepends an incoming "update" event to the timeline', () => {
    const fixture = setUp();
    goLive(fixture);

    fakeStreaming.emit({ event: 'update', payload: makeStatus('99') });

    expect(
      internals(fixture)
        .statuses()
        .map((s) => s.id),
    ).toEqual(['99']);
  });

  it('removes a status on an incoming "delete" event', () => {
    const fixture = setUp();
    goLive(fixture);
    fakeStreaming.emit({ event: 'update', payload: makeStatus('1') });
    fakeStreaming.emit({ event: 'update', payload: makeStatus('2') });

    fakeStreaming.emit({ event: 'delete', payload: '1' });

    expect(
      internals(fixture)
        .statuses()
        .map((s) => s.id),
    ).toEqual(['2']);
  });

  it('toggling live off closes the stream subscription', () => {
    const fixture = setUp();
    goLive(fixture);
    expect(fakeStreaming.closed).toBe(false);

    internals(fixture).toggleLive();

    expect(internals(fixture).live()).toBe(false);
    expect(fakeStreaming.closed).toBe(true);
  });

  it('ignores events once live is toggled off', () => {
    const fixture = setUp();
    goLive(fixture);
    internals(fixture).toggleLive();

    fakeStreaming.emit({ event: 'update', payload: makeStatus('99') });

    expect(internals(fixture).statuses()).toEqual([]);
  });

  // ---------------------------------------------------------------- feed size

  /** A full page of `n` statuses (ids offset so pages don't collide). */
  function page(n: number, offset = 0): Status[] {
    return Array.from({ length: n }, (_, i) => makeStatus(String(offset + i)));
  }

  it('auto-loads further pages until the minimum feed size is reached', () => {
    // Minimum 40 → a full first page (20) triggers one more page automatically.
    TestBed.inject(ClientPrefs).setFeedMin(40);

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/announcements').flush([]);

    // First page: a full 20 → below min(40), so auto-load fires a second page.
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush(page(20, 0));
    // Second page: another full 20 → now 40, min reached, auto-load stops.
    httpMock.expectOne((r) => r.url === '/api/v1/timelines/home').flush(page(20, 20));

    expect(internals(fixture).statuses()).toHaveLength(40);
    expect(internals(fixture).autoLoading()).toBe(false);
    httpMock.expectNone((r) => r.url === '/api/v1/timelines/home');
  });

  it('does not apply Anonymous canonical deduplication to authenticated Home', () => {
    const firstBoost = makeStatus('boost-1');
    const secondBoost = makeStatus('boost-2');
    const sharedOriginal = makeStatus('original');
    sharedOriginal.url = 'https://social.example/@author/original';
    firstBoost.reblog = sharedOriginal;
    secondBoost.reblog = { ...sharedOriginal };

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/announcements').flush([]);
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush([firstBoost, secondBoost]);

    expect(
      internals(fixture)
        .statuses()
        .map((status) => status.id),
    ).toEqual(['boost-1', 'boost-2']);
  });

  it('loadMore stops at the maximum and activates the cap', () => {
    // Min 20 (default), max 20 → first page already hits the cap boundary.
    TestBed.inject(ClientPrefs).setFeedMax(20);

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/announcements').flush([]);
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush(page(20, 0));

    // Feed is at 20 == max; loadMore must NOT fetch, and the cap engages.
    expect(internals(fixture).statuses()).toHaveLength(20);
    internals(fixture).loadMore();

    httpMock.expectNone((r) => r.url === '/api/v1/timelines/home');
    // Hitting the cap tacks the bookmark tail onto the bottom first.
    httpMock.expectOne('/api/v1/bookmarks?limit=40').flush([]);
    expect(internals(fixture).capActive()).toBe(true);
    expect(internals(fixture).canLoadMore()).toBe(false);
  });

  it('hitting the cap tacks up to 40 bookmarks onto the bottom, once', () => {
    TestBed.inject(ClientPrefs).setFeedMax(20);

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/announcements').flush([]);
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush(page(20, 0));

    internals(fixture).loadMore();
    httpMock.expectOne('/api/v1/bookmarks?limit=40').flush([makeStatus('bm1'), makeStatus('bm2')]);

    fixture.detectChanges();
    const rendered = fixture.nativeElement.textContent as string;
    expect(rendered).toContain('some posts you saved for later');
    expect(rendered).toContain('status bm1');
    // The "had enough" wall still lands after the bookmarks.
    expect(rendered).toContain('You’ve had enough for now');
    expect(rendered.indexOf('saved for later')).toBeLessThan(rendered.indexOf('had enough'));

    // A second cap hit reuses the fetched tail — no refetch.
    internals(fixture).loadMore();
    httpMock.expectNone((r) => r.url === '/api/v1/bookmarks');
  });

  // ---------------------------------------------------------------- Eliza merge
  it('keeps Eliza out of the feed until she is followed', () => {
    const fixture = setUp();
    const home = internals(fixture);
    expect(home.visible().some((s) => s.id.startsWith('eliza:'))).toBe(false);
  });

  it('folds Eliza posts into the visible feed once followed', () => {
    const fixture = setUp();
    const home = internals(fixture);

    home.eliza.follow();
    fixture.detectChanges();

    const elizaPosts = home.visible().filter((s) => s.id.startsWith('eliza:'));
    expect(elizaPosts.length).toBeGreaterThan(0);
    // She's not in the raw feed — only the derived visible() view.
    expect(home.statuses().some((s) => s.id.startsWith('eliza:'))).toBe(false);
  });

  it('removes Eliza posts again on unfollow', () => {
    const fixture = setUp();
    const home = internals(fixture);

    home.eliza.follow();
    fixture.detectChanges();
    expect(home.visible().some((s) => s.id.startsWith('eliza:'))).toBe(true);

    home.eliza.unfollow();
    fixture.detectChanges();
    expect(home.visible().some((s) => s.id.startsWith('eliza:'))).toBe(false);
  });
});
