import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import {
  ActivatedRoute,
  ParamMap,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, SearchResults, Status, Tag } from '../../models';
import { Search } from './search';
import { Auth } from '../../auth';

/** Exposes Search's protected signals for white-box testing. */
interface SearchInternals {
  query: WritableSignal<string>;
  type: WritableSignal<'accounts' | 'statuses' | 'hashtags'>;
  results: WritableSignal<SearchResults | null>;
  searching: WritableSignal<boolean>;
  trendingPosts: WritableSignal<Status[]>;
  trendingTags: WritableSignal<Tag[]>;
  accountSource: WritableSignal<'bio' | 'posts' | 'both'>;
  followersMax: WritableSignal<string>;
  accountItems: WritableSignal<{ account: Account; matchingPosts: Status[] }[]>;
  visibleAccounts(): { account: Account; matchingPosts: Status[] }[];
  run(): void;
  onChanged(updated: Status): void;
  onDeleted(removed: Status): void;
}

function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: Math.random().toString(36).slice(2),
    username: 'user',
    acct: 'user',
    display_name: 'User',
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

function internals(fixture: ComponentFixture<Search>): SearchInternals {
  return fixture.componentInstance as unknown as SearchInternals;
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

function makeResults(statuses: Status[] = []): SearchResults {
  return { accounts: [], statuses, hashtags: [] };
}

describe('Search', () => {
  let httpMock: HttpTestingController;
  // Drives the component's queryParamMap subscription; the Router mock feeds it.
  let queryParams$: BehaviorSubject<ParamMap>;

  beforeEach(() => {
    localStorage.clear();
    queryParams$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // provideRouter wires up RouterLink + Location; we override only the
        // ActivatedRoute stream so we can control the query params directly.
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams$.asObservable() } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);

    // run() calls router.navigate to push the query into the URL; reflect that
    // back into our controllable ActivatedRoute stream instead of navigating.
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation((_commands, extras) => {
      const qp = (extras?.queryParams ?? {}) as Record<string, string>;
      queryParams$.next(convertToParamMap(qp));
      return Promise.resolve(true);
    });
  });

  function setUp(): ComponentFixture<Search> {
    const fixture = TestBed.createComponent(Search);
    fixture.detectChanges();
    return fixture;
  }

  /** Type a query and run the search (navigation is synchronous in the stub).
   *  Defaults to the Posts tab, whose single-request flow these generic tests
   *  exercise; the Accounts tab fans out to two requests (bio + posts) and stores
   *  results in `accountItems()`, covered separately. */
  function search(
    fixture: ComponentFixture<Search>,
    query: string,
    type: 'accounts' | 'statuses' | 'hashtags' = 'statuses',
  ): void {
    internals(fixture).type.set(type);
    internals(fixture).query.set(query);
    internals(fixture).run();
    fixture.detectChanges();
  }

  it('starts with searching=false and no results', () => {
    const fixture = setUp();
    expect(internals(fixture).searching()).toBe(false);
    expect(internals(fixture).results()).toBeNull();
    expect(internals(fixture).query()).toBe('');
  });

  it('places the universal starter pack above follow-list import for an account with no follows', () => {
    const auth = TestBed.inject(Auth);
    auth.setToken('zero-follow-token');
    auth.setAccount({ id: 'me', username: 'me', following_count: 0 } as Account);
    const fixture = setUp();
    const starter = fixture.nativeElement.querySelector('.starter-pack-card') as HTMLAnchorElement;
    const importer = fixture.nativeElement.querySelector('.card') as HTMLElement;

    expect(starter.textContent).toContain('Universal starter pack');
    expect(starter.getAttribute('href')).toBe('/collections/starter');
    expect(
      starter.compareDocumentPosition(importer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('hides the universal starter pack when the account already follows someone', () => {
    const auth = TestBed.inject(Auth);
    auth.setToken('following-token');
    auth.setAccount({ id: 'me', username: 'me', following_count: 1 } as Account);
    const fixture = setUp();

    expect(fixture.nativeElement.querySelector('.starter-pack-card')).toBeNull();
  });

  it('keeps optional idle trends empty when either trends request fails', () => {
    const fixture = setUp();

    httpMock
      .expectOne('/api/v1/trends/statuses')
      .flush('', { status: 503, statusText: 'Unavailable' });
    httpMock.expectOne('/api/v1/trends/tags').flush('', { status: 503, statusText: 'Unavailable' });

    expect(internals(fixture).trendingPosts()).toEqual([]);
    expect(internals(fixture).trendingTags()).toEqual([]);
  });

  it('run() does nothing when query is blank', () => {
    const fixture = setUp();
    search(fixture, '   ');

    httpMock.expectNone('/api/v2/search');
    expect(internals(fixture).searching()).toBe(false);
  });

  it('run() sets searching=true while request is in flight', () => {
    const fixture = setUp();
    search(fixture, 'cats');

    expect(internals(fixture).searching()).toBe(true);

    httpMock.expectOne((req) => req.url === '/api/v2/search').flush(makeResults());
  });

  it('run() calls GET /api/v2/search?q=... and populates results', () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    // Budget 1 → no eager auto-fill second page, so the flow settles on one call.
    (internals(fixture) as unknown as { apiBudget: WritableSignal<number> }).apiBudget.set(1);

    search(fixture, 'cats');

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v2/search' && r.params.get('q') === 'cats',
    );
    req.flush(makeResults([s1]));

    expect(internals(fixture).searching()).toBe(false);
    expect(internals(fixture).results()).toEqual(makeResults([s1]));
  });

  it('uses the selected instance public API for anonymous hashtag search', () => {
    TestBed.inject(Auth).enterAnonymous('https://home.example');
    queryParams$.next(convertToParamMap({ q: 'cats', type: 'hashtags' }));
    const fixture = setUp();

    const request = httpMock.expectOne(
      (candidate) =>
        candidate.url === 'https://home.example/api/v2/search' &&
        candidate.params.get('type') === 'hashtags',
    );
    request.flush({ accounts: [], statuses: [], hashtags: [{ name: 'cats' }] });

    expect(internals(fixture).results()?.hashtags[0].name).toBe('cats');
  });

  it('fakes anonymous post search by fetching a public hashtag timeline for each word', () => {
    TestBed.inject(Auth).enterAnonymous('https://home.example');
    queryParams$.next(convertToParamMap({ q: 'good dogs', type: 'statuses' }));
    const fixture = setUp();

    httpMock
      .expectOne('https://home.example/api/v1/timelines/tag/good?limit=20')
      .flush([makeStatus('1')]);
    httpMock
      .expectOne('https://home.example/api/v1/timelines/tag/dogs?limit=20')
      .flush([makeStatus('2')]);

    expect(internals(fixture).results()?.statuses).toHaveLength(2);
    expect(
      internals(fixture)
        .results()
        ?.hashtags.map((tag) => tag.name),
    ).toEqual(['good', 'dogs']);
    httpMock.expectNone((request) => request.url.includes('/api/v2/search'));
  });

  it('run() clears searching on HTTP error', () => {
    const fixture = setUp();
    search(fixture, 'dogs');

    httpMock.expectOne((r) => r.url === '/api/v2/search').error(new ProgressEvent('error'));

    expect(internals(fixture).searching()).toBe(false);
    expect(internals(fixture).results()).toBeNull();
  });

  it('onChanged updates the matching status inside results', () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    const s2 = makeStatus('2');

    search(fixture, 'cats');
    httpMock.expectOne((r) => r.url === '/api/v2/search').flush(makeResults([s1, s2]));

    const updated = { ...s2, content: '<p>changed</p>' };
    internals(fixture).onChanged(updated);

    expect(internals(fixture).results()?.statuses).toEqual([s1, updated]);
  });

  it('onChanged does not change results when results is null', () => {
    const fixture = setUp();
    const updated = makeStatus('99');

    internals(fixture).onChanged(updated);

    expect(internals(fixture).results()).toBeNull();
  });

  it('onDeleted removes the matching status from results', () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    const s2 = makeStatus('2');

    search(fixture, 'cats');
    httpMock.expectOne((r) => r.url === '/api/v2/search').flush(makeResults([s1, s2]));

    internals(fixture).onDeleted(s1);

    expect(internals(fixture).results()?.statuses).toEqual([s2]);
  });

  it('onDeleted does not change results when results is null', () => {
    const fixture = setUp();

    internals(fixture).onDeleted(makeStatus('99'));

    expect(internals(fixture).results()).toBeNull();
  });

  it('run() trims the query before sending', () => {
    const fixture = setUp();
    search(fixture, '  angular  ');

    const req = httpMock.expectOne((r) => r.url === '/api/v2/search');
    expect(req.request.params.get('q')).toBe('angular');
    req.flush(makeResults());
  });

  it('restores the search when the URL already carries query params', () => {
    // Simulate arriving at /search?q=cats (e.g. via the browser back button).
    queryParams$.next(convertToParamMap({ q: 'cats', type: 'statuses' }));
    const fixture = setUp();

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v2/search' && r.params.get('q') === 'cats',
    );
    req.flush(makeResults());

    expect(internals(fixture).query()).toBe('cats');
  });

  it('cancels an obsolete search when query parameters change', () => {
    queryParams$.next(convertToParamMap({ q: 'cats', type: 'statuses' }));
    const fixture = setUp();
    const cats = httpMock.expectOne(
      (r) => r.url === '/api/v2/search' && r.params.get('q') === 'cats',
    );

    queryParams$.next(convertToParamMap({ q: 'dogs', type: 'statuses' }));
    expect(cats.cancelled).toBe(true);
    httpMock
      .expectOne((r) => r.url === '/api/v2/search' && r.params.get('q') === 'dogs')
      .flush(makeResults());

    expect(internals(fixture).searching()).toBe(false);
  });

  describe('account search', () => {
    it("'bio' source hits the account endpoint once and fills accountItems", () => {
      const fixture = setUp();
      internals(fixture).accountSource.set('bio');
      search(fixture, 'economist', 'accounts');

      const req = httpMock.expectOne(
        (r) => r.url === '/api/v2/search' && r.params.get('type') === 'accounts',
      );
      req.flush({ accounts: [makeAccount({ id: 'a', display_name: 'Jane' })], statuses: [], hashtags: [] });
      // Relationships batch-fetch for the loaded account.
      httpMock.expectOne((r) => r.url === '/api/v1/accounts/relationships').flush([]);

      expect(internals(fixture).accountItems().map((i) => i.account.id)).toEqual(['a']);
    });

    it("'both' source fans out to account + post search and merges authors", () => {
      const fixture = setUp();
      internals(fixture).accountSource.set('both');
      search(fixture, 'pycharm', 'accounts');

      const bio = httpMock.expectOne(
        (r) => r.url === '/api/v2/search' && r.params.get('type') === 'accounts',
      );
      const posts = httpMock.expectOne(
        (r) => r.url === '/api/v2/search' && r.params.get('type') === 'statuses',
      );
      const author = makeAccount({ id: 'poster', display_name: 'Poster' });
      bio.flush({ accounts: [makeAccount({ id: 'bio' })], statuses: [], hashtags: [] });
      posts.flush({
        accounts: [],
        statuses: [{ ...makeStatus('p1'), account: author }],
        hashtags: [],
      });
      // Each branch merges independently as it arrives, so each batch-loads
      // relationships for its own accounts (bio, then post-authors).
      httpMock
        .match((r) => r.url === '/api/v1/accounts/relationships')
        .forEach((r) => r.flush([]));

      const ids = internals(fixture).accountItems().map((i) => i.account.id);
      expect(ids).toContain('bio');
      expect(ids).toContain('poster');
      // The condensed author carries its matching post.
      const poster = internals(fixture).accountItems().find((i) => i.account.id === 'poster');
      expect(poster?.matchingPosts.map((s) => s.id)).toEqual(['p1']);
    });

    it('a follower cap gates visibleAccounts after the search runs', () => {
      const fixture = setUp();
      internals(fixture).accountSource.set('bio');
      internals(fixture).followersMax.set('10000');
      search(fixture, 'writers', 'accounts');

      const req = httpMock.expectOne(
        (r) => r.url === '/api/v2/search' && r.params.get('type') === 'accounts',
      );
      req.flush({
        accounts: [
          makeAccount({ id: 'celeb', followers_count: 2_000_000 }),
          makeAccount({ id: 'person', followers_count: 300 }),
        ],
        statuses: [],
        hashtags: [],
      });
      httpMock.expectOne((r) => r.url === '/api/v1/accounts/relationships').flush([]);

      // Both loaded; only the sub-10k account survives the numeric gate.
      expect(internals(fixture).accountItems()).toHaveLength(2);
      expect(internals(fixture).visibleAccounts().map((i) => i.account.id)).toEqual(['person']);
    });

    it('restores the result set from the store on return (no new request)', () => {
      // First visit: a bio-only account search (single request) that settles.
      const first = setUp();
      internals(first).accountSource.set('bio');
      search(first, 'economist', 'accounts');
      httpMock
        .match((r) => r.url === '/api/v2/search')
        .forEach((r) =>
          r.flush({ accounts: [makeAccount({ id: 'econ1' })], statuses: [], hashtags: [] }),
        );
      httpMock.match((r) => r.url === '/api/v1/accounts/relationships').forEach((r) => r.flush([]));
      expect(internals(first).accountItems()).toHaveLength(1);

      // Leaving the page snapshots the results.
      first.destroy();

      // Returning with the same URL restores from the store — no search HTTP.
      queryParams$.next(convertToParamMap({ q: 'economist', type: 'accounts' }));
      const second = setUp();
      expect(internals(second).accountItems().map((i) => i.account.id)).toEqual(['econ1']);
      httpMock.expectNone((r) => r.url === '/api/v2/search');
    });
  });
});
