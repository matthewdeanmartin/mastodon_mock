import { HttpParams, provideHttpClient } from '@angular/common/http';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, Relationship, SearchResults, Status, Tag } from '../../models';
import { Search } from './search';
import { Auth } from '../../auth';
import { SearchServer } from '../../search-server';

/** Exposes Search's protected signals for white-box testing. */
interface SearchInternals {
  query: WritableSignal<string>;
  type: WritableSignal<'accounts' | 'statuses' | 'hashtags'>;
  blueskyMode: WritableSignal<boolean>;
  results: WritableSignal<SearchResults | null>;
  searching: WritableSignal<boolean>;
  trendingTags: WritableSignal<Tag[]>;
  accountSource: WritableSignal<'bio' | 'posts' | 'both'>;
  followersMax: WritableSignal<string>;
  accountItems: WritableSignal<{ account: Account; matchingPosts: Status[] }[]>;
  visibleAccounts(): { account: Account; matchingPosts: Status[] }[];
  searchServerInput: WritableSignal<string>;
  searchServerStatus: WritableSignal<string>;
  searchServerHits: WritableSignal<number>;
  searchServerPostHits: WritableSignal<number | null>;
  searchServerTagsOnly: WritableSignal<boolean>;
  emptyExplanation(): string | null;
  applySearchServer(): Promise<void>;
  clearSearchServer(): void;
  searchHost(): string;
  run(): void;
  onChanged(updated: Status): void;
  onDeleted(removed: Status): void;
  onTypeSelect(value: string, el?: HTMLSelectElement): void;
  onNetworkSelect(value: string): void;
  networkSelection(): string;
  typeUnavailable(type: 'accounts' | 'statuses' | 'hashtags'): boolean;
  blueskyTarget(): 'accounts' | 'statuses';
  queryPlaceholder(): string;
  webDropped: WritableSignal<string[]>;
  replies: WritableSignal<'include' | 'only' | 'exclude'>;
  followFilter: WritableSignal<'all' | 'following' | 'not-following'>;
  relationships: WritableSignal<Record<string, Relationship>>;
  accountsMissingActivity(): { account: Account; matchingPosts: Status[] }[];
  canEnrichActivity(): boolean;
  enrichActivity(): void;
  enrichError: WritableSignal<string | null>;
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

  // The empty account tab used to push the universal starter pack at anyone with
  // no follows. Bundled collections live on their own page now, reached on
  // purpose from Find Friends, so this offers directories instead.
  it('offers offsite directories on the empty account tab, without a page title of its own', () => {
    const auth = TestBed.inject(Auth);
    auth.setToken('zero-follow-token');
    auth.setAccount({ id: 'me', username: 'me', following_count: 0 } as Account);
    const fixture = setUp();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-offsite-directories')).not.toBeNull();
    expect(el.textContent).toContain('Followgraph');
    // Embedded: the host page already has a heading.
    expect(el.querySelector('app-offsite-directories .page-title')).toBeNull();
    expect(el.querySelector('.starter-pack-card')).toBeNull();
  });

  it('keeps optional idle trends empty when the trends request fails', () => {
    const fixture = setUp();

    httpMock.expectOne('/api/v1/trends/tags').flush('', { status: 503, statusText: 'Unavailable' });

    expect(internals(fixture).trendingTags()).toEqual([]);
  });

  it('never asks for trending posts, which the idle state no longer shows', () => {
    setUp();

    httpMock.expectNone('/api/v1/trends/statuses');
  });

  it('shows the search syntax reference in the idle post-search state', () => {
    const fixture = setUp();
    // The page opens on 'accounts', whose idle state offers follow-list import.
    // The operator reference belongs to the post search, where operators work.
    internals(fixture).type.set('statuses');
    fixture.detectChanges();

    const help = fixture.nativeElement.querySelector('app-search-syntax-help .embedded');
    expect(help).not.toBeNull();
    // Embedded means no dialog chrome — the overlay would darken the page.
    expect(fixture.nativeElement.querySelector('app-search-syntax-help .overlay')).toBeNull();
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
      req.flush({
        accounts: [makeAccount({ id: 'a', display_name: 'Jane' })],
        statuses: [],
        hashtags: [],
      });
      // Relationships batch-fetch for the loaded account.
      httpMock.expectOne((r) => r.url === '/api/v1/accounts/relationships').flush([]);

      expect(
        internals(fixture)
          .accountItems()
          .map((i) => i.account.id),
      ).toEqual(['a']);
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
      httpMock.match((r) => r.url === '/api/v1/accounts/relationships').forEach((r) => r.flush([]));

      const ids = internals(fixture)
        .accountItems()
        .map((i) => i.account.id);
      expect(ids).toContain('bio');
      expect(ids).toContain('poster');
      // The condensed author carries its matching post.
      const poster = internals(fixture)
        .accountItems()
        .find((i) => i.account.id === 'poster');
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
      expect(
        internals(fixture)
          .visibleAccounts()
          .map((i) => i.account.id),
      ).toEqual(['person']);
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
      expect(
        internals(second)
          .accountItems()
          .map((i) => i.account.id),
      ).toEqual(['econ1']);
      httpMock.expectNone((r) => r.url === '/api/v2/search');
    });

    /** Run an account search returning `accounts`, settling the relationship call. */
    function accountSearch(fixture: ComponentFixture<Search>, accounts: Account[]): void {
      internals(fixture).accountSource.set('bio');
      search(fixture, 'economist', 'accounts');
      httpMock
        .expectOne((r) => r.url === '/api/v2/search' && r.params.get('type') === 'accounts')
        .flush({ accounts, statuses: [], hashtags: [] });
      httpMock.match((r) => r.url === '/api/v1/accounts/relationships').forEach((r) => r.flush([]));
      fixture.detectChanges();
    }

    it('offers enrichment only for accounts that arrived without a last-post date', () => {
      const fixture = setUp();
      accountSearch(fixture, [
        makeAccount({ id: 'dated', last_status_at: '2026-08-01' }),
        makeAccount({ id: 'thin' }),
      ]);

      expect(
        internals(fixture)
          .accountsMissingActivity()
          .map((i) => i.account.id),
      ).toEqual(['thin']);
      expect(internals(fixture).canEnrichActivity()).toBe(true);
    });

    it('fills in last_status_at from one batched call', () => {
      const fixture = setUp();
      accountSearch(fixture, [makeAccount({ id: 'thin' })]);

      internals(fixture).enrichActivity();
      const req = httpMock.expectOne((r) => r.url === '/api/v1/accounts');
      expect(req.request.params.getAll('id[]')).toEqual(['thin']);
      req.flush([makeAccount({ id: 'thin', last_status_at: '2026-08-05' })]);
      fixture.detectChanges();

      expect(internals(fixture).accountItems()[0].account.last_status_at).toBe('2026-08-05');
      // Nothing left unanswered, so the offer retires rather than repeating.
      expect(internals(fixture).canEnrichActivity()).toBe(false);
    });

    it('leaves ids the server omitted as unknown rather than inventing a date', () => {
      const fixture = setUp();
      accountSearch(fixture, [makeAccount({ id: 'known' }), makeAccount({ id: 'gone' })]);

      internals(fixture).enrichActivity();
      // The batch endpoint drops unknown ids instead of erroring the request.
      httpMock
        .expectOne((r) => r.url === '/api/v1/accounts')
        .flush([makeAccount({ id: 'known', last_status_at: '2026-08-05' })]);
      fixture.detectChanges();

      const byId = new Map(
        internals(fixture)
          .accountItems()
          .map((i) => [i.account.id, i.account]),
      );
      expect(byId.get('known')!.last_status_at).toBe('2026-08-05');
      expect(byId.get('gone')!.last_status_at).toBeUndefined();
    });

    it('reports a failed enrichment instead of silently doing nothing', () => {
      const fixture = setUp();
      accountSearch(fixture, [makeAccount({ id: 'thin' })]);

      internals(fixture).enrichActivity();
      httpMock
        .expectOne((r) => r.url === '/api/v1/accounts')
        .flush('nope', { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(internals(fixture).enrichError()).toBeTruthy();
      // Still offered, so the reader can retry.
      expect(internals(fixture).canEnrichActivity()).toBe(true);
    });

    it('filters the visible list by whether the viewer follows each account', () => {
      const fixture = setUp();
      accountSearch(fixture, [makeAccount({ id: 'friend' }), makeAccount({ id: 'stranger' })]);
      internals(fixture).relationships.set({
        friend: { id: 'friend', following: true } as Relationship,
        stranger: { id: 'stranger', following: false } as Relationship,
      });

      internals(fixture).followFilter.set('following');
      expect(
        internals(fixture)
          .visibleAccounts()
          .map((i) => i.account.id),
      ).toEqual(['friend']);

      internals(fixture).followFilter.set('not-following');
      expect(
        internals(fixture)
          .visibleAccounts()
          .map((i) => i.account.id),
      ).toEqual(['stranger']);
    });
  });

  describe('search server picker', () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Stub global fetch, which the canary probe uses (not HttpClient). */
    function stubProbe(body: unknown, status = 200): void {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: status < 300, status, json: async () => body }) as Response),
      );
    }

    it('adopts a server whose anonymous search returns results', async () => {
      const fixture = setUp();
      stubProbe({ accounts: [{ id: '1' }, { id: '2' }] });

      internals(fixture).searchServerInput.set('mastodon.social');
      await internals(fixture).applySearchServer();

      expect(internals(fixture).searchServerStatus()).toBe('ok');
      expect(internals(fixture).searchServerHits()).toBe(2);
      expect(TestBed.inject(SearchServer).baseUrl()).toBe('https://mastodon.social');
    });

    it('refuses a server that is reachable but returns nothing', async () => {
      const fixture = setUp();
      stubProbe({ accounts: [] });

      internals(fixture).searchServerInput.set('empty.example');
      await internals(fixture).applySearchServer();

      expect(internals(fixture).searchServerStatus()).toBe('no-results');
      // Crucially, an unusable server must not become the search server.
      expect(TestBed.inject(SearchServer).active()).toBe(false);
    });

    it('refuses a server that requires a login for search', async () => {
      const fixture = setUp();
      stubProbe({ error: 'unauthorized' }, 401);

      internals(fixture).searchServerInput.set('closed.example');
      await internals(fixture).applySearchServer();

      expect(internals(fixture).searchServerStatus()).toBe('auth-required');
      expect(TestBed.inject(SearchServer).active()).toBe(false);
    });

    it('routes anonymous search at the search server once one is set', async () => {
      const fixture = setUp();
      stubProbe({ accounts: [{ id: '1' }] });

      internals(fixture).searchServerInput.set('mastodon.social');
      await internals(fixture).applySearchServer();

      expect(internals(fixture).searchHost()).toBe('https://mastodon.social');
    });

    it('clearing sends search back to the primary server', async () => {
      const fixture = setUp();
      stubProbe({ accounts: [{ id: '1' }] });
      internals(fixture).searchServerInput.set('mastodon.social');
      await internals(fixture).applySearchServer();

      internals(fixture).clearSearchServer();

      expect(TestBed.inject(SearchServer).active()).toBe(false);
      expect(internals(fixture).searchServerInput()).toBe('');
    });

    it('an empty box clears rather than probing', async () => {
      const fixture = setUp();
      stubProbe({ accounts: [{ id: '1' }] });
      internals(fixture).searchServerInput.set('mastodon.social');
      await internals(fixture).applySearchServer();

      internals(fixture).searchServerInput.set('   ');
      await internals(fixture).applySearchServer();

      expect(TestBed.inject(SearchServer).active()).toBe(false);
    });

    /** Accounts work; the hashtag canary answers with whatever `postCanary` says. */
    function stubAccountsOnlyProbe(postCanary: unknown) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          new URL(url).searchParams.get('type') === 'accounts'
            ? ({
                ok: true,
                status: 200,
                json: async () => ({ accounts: [{ id: '1' }] }),
              } as Response)
            : ({ ok: true, status: 200, json: async () => postCanary } as Response),
        ),
      );
    }

    it('adopts a hand-typed accounts-only server but reports the missing post search', async () => {
      // The user named this host explicitly, so we take it — but a server that
      // serves no posts would otherwise make every post search look merely unlucky.
      const fixture = setUp();
      stubAccountsOnlyProbe({ statuses: [], hashtags: [] });

      internals(fixture).searchServerInput.set('no-es.example');
      await internals(fixture).applySearchServer();

      expect(internals(fixture).searchServerStatus()).toBe('ok');
      expect(internals(fixture).searchServerPostHits()).toBe(0);
      expect(internals(fixture).searchServerTagsOnly()).toBe(false);
      expect(TestBed.inject(SearchServer).baseUrl()).toBe('https://no-es.example');
    });

    it('flags the tags-only server, whose payload otherwise looks like a result set', async () => {
      const fixture = setUp();
      stubAccountsOnlyProbe({ statuses: [], hashtags: [{ name: 'mastodon' }] });

      internals(fixture).searchServerInput.set('tags-only.example');
      await internals(fixture).applySearchServer();

      expect(internals(fixture).searchServerPostHits()).toBe(0);
      expect(internals(fixture).searchServerTagsOnly()).toBe(true);
    });
  });

  describe('empty results that are not really empty', () => {
    it('says nothing before a probe has grounds to say anything', () => {
      const fixture = setUp();
      // The explanation must never appear on a page we have not checked.
      expect(internals(fixture).emptyExplanation()).toBeNull();
    });

    /**
     * Drive a zero-result post search through to its capability probe.
     *
     * The probe runs its two canaries in sequence — accounts first, posts only once
     * accounts have proved the server answers at all — so they must be flushed in
     * that order. The post canary carries no `type` (it asks for a hashtag and needs
     * to see whether tag names came back instead of posts), so it is matched on the
     * absence of the parameter.
     */
    async function probeEmptyPostSearch(
      postCanary: Partial<SearchResults>,
    ): Promise<ReturnType<typeof setUp>> {
      const fixture = setUp();
      internals(fixture).query.set('rust');
      internals(fixture).type.set('statuses');
      internals(fixture).run();

      httpMock
        .expectOne((r) => r.url === '/api/v2/search')
        .flush({ accounts: [], statuses: [], hashtags: [] });

      const flushProbe = async (
        match: (params: HttpParams) => boolean,
        results: Partial<SearchResults>,
      ) => {
        let request!: ReturnType<HttpTestingController['expectOne']>;
        await vi.waitFor(() => {
          request = httpMock.expectOne((r) => r.url === '/api/v2/search' && match(r.params));
        });
        request.flush({ accounts: [], statuses: [], hashtags: [], ...results });
      };

      await flushProbe((p) => p.get('type') === 'accounts', { accounts: [makeAccount()] });
      await flushProbe((p) => p.get('type') === null, postCanary);
      return fixture;
    }

    it('names post search as the missing half when nothing comes back at all', async () => {
      const fixture = await probeEmptyPostSearch({ statuses: [], hashtags: [] });

      await vi.waitFor(() => {
        expect(internals(fixture).emptyExplanation()).toContain("Post search isn't available");
      });
    });

    it('says the hashtag matched when the server returned the tag and no posts', async () => {
      // The distinction the user has to act on: this server understood the query
      // perfectly and still has nothing to show, so retyping will not help.
      const fixture = await probeEmptyPostSearch({
        statuses: [],
        hashtags: [{ name: 'rust', url: 'https://example.social/tags/rust' }],
      });

      await vi.waitFor(() => {
        expect(internals(fixture).emptyExplanation()).toContain('recognises the hashtag');
      });
    });
  });

  /**
   * The four engines share the type dropdown but are an action, not a fourth
   * type — anonymous post search is off on nearly every server, and the posts
   * are still public HTML that Google indexes.
   */
  describe('web search hand-off', () => {
    let opened: string[];

    beforeEach(() => {
      opened = [];
      vi.spyOn(window, 'open').mockImplementation((url) => {
        opened.push(String(url));
        return null;
      });
    });

    it('opens the engine in a new tab, scoped to the search host', () => {
      const fixture = setUp();
      internals(fixture).query.set('rust borrow checker');

      internals(fixture).onTypeSelect('google');

      expect(opened).toHaveLength(1);
      expect(opened[0]).toContain('https://www.google.com/search?q=');
      expect(decodeURIComponent(opened[0])).toContain('rust borrow checker');
      // Scoped, so results are posts rather than the whole web.
      expect(decodeURIComponent(opened[0])).toContain('site:');
    });

    it('leaves the search type alone — an engine is not a fourth tab', () => {
      const fixture = setUp();
      internals(fixture).query.set('rust');
      internals(fixture).type.set('accounts');

      internals(fixture).onTypeSelect('kagi');

      // "google" must never reach type(): it would leak into the URL, saved
      // searches, and every `type() === …` branch on the page.
      expect(internals(fixture).type()).toBe('accounts');
    });

    it('snaps the select element back to the real type', () => {
      // Regression: `[ngModel]` is bound to type(), which an engine pick does
      // not change — with no change to write back, the <select> kept displaying
      // "Google" while the page was still on Accounts.
      const fixture = setUp();
      internals(fixture).query.set('rust');
      internals(fixture).type.set('accounts');
      const el = { value: 'google' } as HTMLSelectElement;

      internals(fixture).onTypeSelect('google', el);

      expect(el.value).toBe('accounts');
    });

    it('does nothing when there is no query to hand off', () => {
      const fixture = setUp();
      internals(fixture).query.set('   ');

      internals(fixture).onTypeSelect('bing');

      expect(opened).toHaveLength(0);
    });

    it('reports post criteria the web cannot express', () => {
      const fixture = setUp();
      internals(fixture).type.set('statuses');
      internals(fixture).query.set('angular');
      internals(fixture).replies.set('exclude');

      internals(fixture).onTypeSelect('duckduckgo');

      expect(internals(fixture).webDropped()).toContain('no replies');
      // Dropped, not approximated: the operator must not reach the engine.
      expect(decodeURIComponent(opened[0])).not.toContain('is:reply');
    });

    it('clears the dropped note when a real search type is chosen', () => {
      const fixture = setUp();
      internals(fixture).type.set('statuses');
      internals(fixture).query.set('angular');
      internals(fixture).replies.set('exclude');
      internals(fixture).onTypeSelect('google');
      expect(internals(fixture).webDropped().length).toBeGreaterThan(0);

      internals(fixture).onTypeSelect('accounts');

      expect(internals(fixture).webDropped()).toEqual([]);
      expect(internals(fixture).type()).toBe('accounts');
    });
  });
  /**
   * Which engine the page opens on.
   *
   * A Bluesky-primary account searching Mastodon by default is searching a
   * connector that, after the Sprint 4 opt-in reversal, may not exist at all —
   * so the landing panel has to follow the identity. And `blueskyMode` was not
   * in the URL at all before this sprint, which made the Bluesky panel
   * unlinkable and lost it on back-navigation.
   */
  describe('landing panel by account kind', () => {
    function seedBlueskyPrimary(): void {
      localStorage.setItem('mastodon_mock_account_mode', 'bluesky');
      localStorage.setItem(
        'mockingbird_bsky_identity_profile',
        JSON.stringify({ did: 'did:plc:me', handle: 'me.bsky.social' }),
      );
      localStorage.setItem(
        'mockingbird_bsky_identity_credentials',
        JSON.stringify({ accessJwt: 'a', refreshJwt: 'r', connectedAt: Date.now() }),
      );
    }

    it('opens the Bluesky panel for a Bluesky-primary account', () => {
      seedBlueskyPrimary();
      const fixture = setUp();

      expect(internals(fixture).blueskyMode()).toBe(true);
    });

    it('opens Accounts for a mastodon-primary account, as before', () => {
      TestBed.inject(Auth).setToken('tok');
      const fixture = setUp();

      expect(internals(fixture).blueskyMode()).toBe(false);
      expect(internals(fixture).type()).toBe('accounts');
    });

    it('opens Accounts when signed out or anonymous, as before', () => {
      const fixture = setUp();

      expect(internals(fixture).blueskyMode()).toBe(false);
      expect(internals(fixture).type()).toBe('accounts');
    });

    it('lets an explicit ?type= beat the kind default', () => {
      seedBlueskyPrimary();
      queryParams$.next(convertToParamMap({ type: 'statuses' }));
      const fixture = setUp();

      // A shared Mastodon link must show the recipient what the sender saw,
      // whatever network the recipient happens to be on.
      expect(internals(fixture).blueskyMode()).toBe(false);
      expect(internals(fixture).type()).toBe('statuses');
    });

    it('restores the Bluesky panel from the URL', () => {
      queryParams$.next(convertToParamMap({ type: 'bluesky-posts' }));
      const fixture = setUp();

      // The round-trip that makes the panel linkable and back-navigable. Note
      // this works for a mastodon-primary reader too — it is the URL asking,
      // not the account kind.
      expect(internals(fixture).blueskyMode()).toBe(true);
    });

    it('does not widen SearchType when the URL carries the Bluesky value', () => {
      queryParams$.next(convertToParamMap({ type: 'bluesky-posts' }));
      const fixture = setUp();

      // `bluesky-posts` is a wire value translated at the URL boundary, never a
      // fourth SearchType — widening it would put a "…or bluesky" case in the
      // query serializers, saved searches and the explain panel.
      expect(['accounts', 'statuses', 'hashtags']).toContain(internals(fixture).type());
    });
  });

  /**
   * One set of widgets for both networks.
   *
   * The page used to hide the query box, Search, Advanced, Syntax and the AI
   * helper whenever Bluesky was showing, and the Bluesky panel brought its own
   * seg control in their place. The result read as two different applications
   * sharing a URL. Network and type are now two plain selects driving one
   * shared bar, and these tests hold that boundary.
   */
  describe('network and type selects', () => {
    /**
     * A reader with a usable Bluesky session.
     *
     * The mode key is not optional decoration: `BlueskySession` picks the
     * identity key pair over the scoped connector pair at construction, based on
     * exactly that key (see `blueskyIsPrimaryKind`). Writing the identity keys
     * without it leaves `linked()` false, because the session goes looking for a
     * connector that was never stored.
     */
    function seedBlueskySession(): void {
      localStorage.setItem('mastodon_mock_account_mode', 'bluesky');
      localStorage.setItem(
        'mockingbird_bsky_identity_profile',
        JSON.stringify({ did: 'did:plc:me', handle: 'me.bsky.social' }),
      );
      localStorage.setItem(
        'mockingbird_bsky_identity_credentials',
        JSON.stringify({ accessJwt: 'a', refreshJwt: 'r', connectedAt: Date.now() }),
      );
    }

    it('reports the network the selects are pointed at', () => {
      const fixture = setUp();
      expect(internals(fixture).networkSelection()).toBe('mastodon');

      internals(fixture).onNetworkSelect('bluesky');

      expect(internals(fixture).networkSelection()).toBe('bluesky');
      expect(internals(fixture).blueskyMode()).toBe(true);
    });

    it('keeps the chosen type when switching network, where the network allows it', () => {
      seedBlueskySession();
      const fixture = setUp();
      // A seeded reader lands on Bluesky, so go to Mastodon first and come back
      // — the switch is what is under test, not the landing panel.
      internals(fixture).onNetworkSelect('mastodon');
      internals(fixture).type.set('statuses');

      internals(fixture).onNetworkSelect('bluesky');

      // The whole point of one type select: picking Posts once means Posts on
      // whichever network you look at next.
      expect(internals(fixture).type()).toBe('statuses');
    });

    it('falls back to Accounts when the type the reader is on is Mastodon-only', () => {
      const fixture = setUp();
      internals(fixture).type.set('hashtags');

      internals(fixture).onNetworkSelect('bluesky');

      // Bluesky has no hashtag index to search, only a hashtag filter inside
      // post search — so Hashtags cannot survive the switch.
      expect(internals(fixture).type()).toBe('accounts');
    });

    it('falls back to Accounts for Posts without a linked Bluesky account', () => {
      const fixture = setUp();
      internals(fixture).type.set('statuses');

      internals(fixture).onNetworkSelect('bluesky');

      // Measured: searchActors answers anonymously, searchPosts refuses.
      expect(internals(fixture).type()).toBe('accounts');
    });

    it('disables only the types the current network cannot serve', () => {
      const fixture = setUp();
      expect(internals(fixture).typeUnavailable('hashtags')).toBe(false);

      internals(fixture).onNetworkSelect('bluesky');

      expect(internals(fixture).typeUnavailable('accounts')).toBe(false);
      expect(internals(fixture).typeUnavailable('hashtags')).toBe(true);
      expect(internals(fixture).typeUnavailable('statuses')).toBe(true);
    });

    it('enables Bluesky posts once an account is linked', () => {
      seedBlueskySession();
      const fixture = setUp();
      internals(fixture).onNetworkSelect('bluesky');

      expect(internals(fixture).typeUnavailable('statuses')).toBe(false);
    });

    it('narrows the type to what the Bluesky panel accepts', () => {
      const fixture = setUp();
      internals(fixture).onNetworkSelect('bluesky');
      internals(fixture).type.set('hashtags');

      // Unreachable through the UI — the option is disabled — but the select's
      // value is the page-wide SearchType, so the narrowing is stated once
      // rather than cast at the binding.
      expect(internals(fixture).blueskyTarget()).toBe('statuses');
    });

    it('names the network in the shared box placeholder', () => {
      const fixture = setUp();
      internals(fixture).type.set('accounts');
      expect(internals(fixture).queryPlaceholder()).toBe('Search Mastodon accounts');

      internals(fixture).onNetworkSelect('bluesky');

      expect(internals(fixture).queryPlaceholder()).toBe('Search Bluesky accounts');
    });

    it('restores which half of Bluesky a shared link meant', () => {
      queryParams$.next(convertToParamMap({ type: 'bluesky-posts', bskyType: 'accounts' }));
      const fixture = setUp();

      expect(internals(fixture).blueskyMode()).toBe(true);
      expect(internals(fixture).type()).toBe('accounts');
    });

    it('reads a Bluesky link made before the selects were split as Posts', () => {
      seedBlueskySession();
      queryParams$.next(convertToParamMap({ type: 'bluesky-posts' }));
      const fixture = setUp();

      // Posts was the only thing `type=bluesky-posts` could mean back then.
      expect(internals(fixture).type()).toBe('statuses');
    });

    it('does not restore a type the reader cannot run', () => {
      queryParams$.next(convertToParamMap({ type: 'bluesky-posts', bskyType: 'statuses' }));
      const fixture = setUp();

      // No linked account: the link asks for Posts, which would open the select
      // on a disabled option.
      expect(internals(fixture).type()).toBe('accounts');
    });
  });
});
