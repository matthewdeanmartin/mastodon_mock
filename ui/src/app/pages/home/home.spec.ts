import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientPrefs } from '../../client-prefs';
import { Drafts } from '../../drafts';
import { HomeDiagnostics } from '../../home-diagnostics';
import { Status } from '../../models';
import { Streaming } from '../../streaming';
import { FakeStreaming } from '../../testing/fake-streaming';
import { Home } from './home';
import { Auth } from '../../auth';
import { AnonymousHomeFeedCache } from '../../providers/anonymous/anonymous-home-feed-cache';
import { AnonymousMastodonProvider } from '../../providers/anonymous/anonymous-mastodon-provider';

/** Exposes Home's protected signals for white-box testing. */
interface HomeInternals {
  statuses: Signal<Status[]>;
  visible: Signal<Status[]>;
  live: WritableSignal<boolean>;
  autoLoading: Signal<boolean>;
  capActive: Signal<boolean>;
  canLoadMore: Signal<boolean>;
  showBoosts: WritableSignal<boolean>;
  showReplies: WritableSignal<boolean>;
  eliza: { follow(): void; unfollow(): void };
  loadMore(): void;
  toggleBoosts(): void;
  toggleReplies(): void;
  view: WritableSignal<'feed' | 'members' | 'analytics'>;
  setView(view: 'feed' | 'members' | 'analytics'): void;
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

  beforeEach(() => {
    // These specs use fixed 2026-01-01 dates and assert paging, filtering and
    // views — not recency. The default 24h loading window would drop every
    // fixture and stop paging on the first page. The window has its own
    // coverage in feed-aggregator.spec.ts.
    TestBed.inject(ClientPrefs).setHomeWindow('all');
  });

  function setUp(): ComponentFixture<Home> {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush([]);
    httpMock.expectOne('/api/v1/announcements').flush([]);
    return fixture;
  }

  /**
   * Turn streaming on and flush the fresh-snapshot refetch it triggers.
   *
   * Driven by the Blue preference now that "Go live" has left the toolbar —
   * Home follows `autoRefreshTimeline` through an effect, so the switch has to
   * be flipped there and the effect flushed with `detectChanges`.
   */
  function goLive(fixture: ComponentFixture<Home>): void {
    TestBed.inject(ClientPrefs).setAutoRefreshTimeline(true);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush([]);
  }

  /** The inverse of {@link goLive}: no refetch happens on the way down. */
  function stopLive(fixture: ComponentFixture<Home>): void {
    TestBed.inject(ClientPrefs).setAutoRefreshTimeline(false);
    fixture.detectChanges();
  }

  it('reports an empty first page with enough context to diagnose filtering', () => {
    setUp();

    expect(diagnostics.warn).toHaveBeenCalledWith(
      'load:first-page-empty',
      expect.objectContaining({ received: 0, stored: 0, visible: 0 }),
    );
  });

  it('toggles retweets and replies in the home feed', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/announcements').flush([]);
    const original = makeStatus('original');
    const retweet = { ...makeStatus('retweet'), reblog: makeStatus('boosted') };
    const reply = { ...makeStatus('reply'), in_reply_to_id: 'parent' };
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush([original, retweet, reply]);

    expect(
      internals(fixture)
        .visible()
        .map((status) => status.id),
    ).toEqual(['original', 'retweet']);
    internals(fixture).toggleReplies();
    expect(
      internals(fixture)
        .visible()
        .map((status) => status.id),
    ).toEqual(['original', 'retweet', 'reply']);
    internals(fixture).toggleBoosts();
    expect(
      internals(fixture)
        .visible()
        .map((status) => status.id),
    ).toEqual(['original', 'reply']);
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

    const reset = vi.spyOn(TestBed.inject(AnonymousMastodonProvider), 'reset');
    fixture.componentInstance.load(true);
    expect(internals(fixture).statuses()).toEqual([]);
    expect(reset).toHaveBeenCalledOnce();
  });

  // Home used to inject onboarding into a thin feed: an Eliza invite, the
  // universal starter kit, and every shipped starter-kit post. It put the same
  // collections in front of the same person on every fresh browser, so it is
  // gone — one link to the hub, and only when there is nothing else to show.

  it('offers one link to the Find Friends hub when the feed is empty', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const link = el.querySelector('a[href="/find-friends"]');
    expect(link?.textContent).toContain('Find friends');
    // Nothing else fills the empty feed on its own any more.
    expect(el.querySelectorAll('app-starter-kit-post')).toHaveLength(0);
    expect(el.querySelector('.starter-pack-universal')).toBeNull();
    expect(el.querySelector('.eliza-invite')).toBeNull();
  });

  it('keeps the pinned login post for Anonymous, which is not onboarding filler', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const loginPost = fixture.nativeElement.querySelector(
      '.anonymous-login-post',
    ) as HTMLAnchorElement;
    expect(loginPost.textContent).toContain(
      'Login or create an account to post content, reply and more',
    );
    expect(loginPost.getAttribute('href')).toBe('/login');
  });

  it('drops the hub link as soon as the feed has anything in it', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    // Following Eliza fills the feed with her posts.
    internals(fixture).eliza.follow();
    fixture.detectChanges();

    expect(internals(fixture).visible().length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('a[href="/find-friends"]')).toBeNull();
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

  it('opens a user stream and flips the live flag when the Blue pref goes on', () => {
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

  it('turning the pref off closes the stream subscription', () => {
    const fixture = setUp();
    goLive(fixture);
    expect(fakeStreaming.closed).toBe(false);

    stopLive(fixture);

    expect(internals(fixture).live()).toBe(false);
    expect(fakeStreaming.closed).toBe(true);
  });

  it('ignores events once the pref is turned off', () => {
    const fixture = setUp();
    goLive(fixture);
    stopLive(fixture);

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

  // --------------------------------------------------------- thoughtful posting

  it('replaces the writing box with a Write button when thoughtful posting is on', () => {
    TestBed.inject(ClientPrefs).setThoughtfulPosting(true);
    const fixture = setUp();

    expect(fixture.nativeElement.querySelector('app-compose')).toBeNull();
    const write = fixture.nativeElement.querySelector('.write-btn');
    expect(write).not.toBeNull();
    expect(write.getAttribute('href')).toContain('/drafts');
  });

  // The publish step of write -> draft -> edit -> publish happens here. Hiding
  // the composer when you arrive holding a draft would leave the cycle with no
  // way to finish.
  it('still shows a live composer when arriving to finish a handed-off draft', () => {
    TestBed.inject(ClientPrefs).setThoughtfulPosting(true);
    TestBed.inject(Drafts).handoff({
      segments: ['ready to go out'],
      spoilerText: '',
      sensitive: false,
      visibility: 'public',
      poll: null,
    });

    const fixture = setUp();

    expect(fixture.nativeElement.querySelector('app-compose')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.write-btn')).toBeNull();
  });

  it('leaves Home alone when the pref is off', () => {
    const fixture = setUp();
    expect(fixture.nativeElement.querySelector('app-compose')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.write-btn')).toBeNull();
  });

  // ---------------------------------------------------------------- feed views

  it('offers Members and Analytics in the command bar, starting on the feed', () => {
    const fixture = setUp();

    const labels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.command-bar .btn')]
      .map((b) => b.textContent?.trim())
      .join(' ');
    expect(labels).toContain('Members');
    expect(labels).toContain('Analytics');
    expect(internals(fixture).view()).toBe('feed');
  });

  it('swaps the timeline for the members view, off the posts already loaded', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/announcements').flush([]);
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush([makeStatus('a'), makeStatus('b')]);
    fixture.detectChanges();

    internals(fixture).setView('members');
    fixture.detectChanges();
    // The feed itself is never re-fetched; the only call is the batched
    // relationships lookup that marks who you already follow.
    httpMock.expectOne((r) => r.url.startsWith('/api/v1/accounts/relationships')).flush([]);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelectorAll('.member-row').length).toBeGreaterThan(0);
    expect(html.querySelector('app-status-card')).toBeNull();
  });

  it('analyzes the loaded home feed without paging it', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/announcements').flush([]);
    httpMock.expectOne('/api/v1/timelines/home?limit=20').flush([makeStatus('a'), makeStatus('b')]);
    fixture.detectChanges();

    internals(fixture).setView('analytics');
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.startsWith('/api/v1/accounts/relationships')).flush([]);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2 posts currently loaded');
    expect(text).toContain('not the whole feed');
  });

  it('returns to the feed when the active view is toggled off', () => {
    const fixture = setUp();
    internals(fixture).setView('members');
    fixture.detectChanges();
    expect(internals(fixture).view()).toBe('members');

    internals(fixture).setView('feed');
    fixture.detectChanges();
    expect(internals(fixture).view()).toBe('feed');
    expect((fixture.nativeElement as HTMLElement).querySelector('.home-filters')).not.toBeNull();
  });
});
