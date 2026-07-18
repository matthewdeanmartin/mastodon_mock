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
import { SearchResults, Status, Tag } from '../../models';
import { Search } from './search';

/** Exposes Search's protected signals for white-box testing. */
interface SearchInternals {
  query: WritableSignal<string>;
  results: WritableSignal<SearchResults | null>;
  searching: WritableSignal<boolean>;
  trendingPosts: WritableSignal<Status[]>;
  trendingTags: WritableSignal<Tag[]>;
  run(): void;
  onChanged(updated: Status): void;
  onDeleted(removed: Status): void;
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

  /** Type a query and run the search (navigation is synchronous in the stub). */
  function search(fixture: ComponentFixture<Search>, query: string): void {
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

    search(fixture, 'cats');

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v2/search' && r.params.get('q') === 'cats',
    );
    req.flush(makeResults([s1]));

    expect(internals(fixture).searching()).toBe(false);
    expect(internals(fixture).results()).toEqual(makeResults([s1]));
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
    queryParams$.next(convertToParamMap({ q: 'cats', type: 'accounts' }));
    const fixture = setUp();

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v2/search' && r.params.get('q') === 'cats',
    );
    req.flush(makeResults());

    expect(internals(fixture).query()).toBe('cats');
  });
});
