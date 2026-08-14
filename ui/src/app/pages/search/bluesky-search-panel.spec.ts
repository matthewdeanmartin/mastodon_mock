import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Account, Status } from '../../models';
import { BlueskySearchPanel } from './bluesky-search-panel';
import { BlueskySearch, BlueskySearchPage } from '../../providers/bluesky/bluesky-search';
import {
  BlueskyAccountPage,
  BlueskyAccountSearch,
} from '../../providers/bluesky/bluesky-account-search';
import { FacetKind } from './search-refine';

function makeAccount(acct: string): Account {
  return {
    id: `bsky:${acct}`,
    username: acct,
    acct,
    display_name: acct,
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
  } as Account;
}

function makeStatus(id: string, acct = 'alice.bsky.social', over: Partial<Status> = {}): Status {
  return {
    id,
    created_at: '2026-08-01T12:00:00.000Z',
    content: `<p>post ${id}</p>`,
    account: makeAccount(acct),
    media_attachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    favourites_count: 0,
    reblogs_count: 0,
    replies_count: 0,
    sensitive: false,
    spoiler_text: '',
    visibility: 'public',
    language: 'en',
    in_reply_to_id: null,
    ...over,
  } as unknown as Status;
}

/** Exposes the panel's protected members for white-box testing. */
interface PanelInternals {
  criteria: WritableSignal<{ text: string; sort?: string }>;
  statuses(): Status[];
  visible(): Status[];
  callsUsed(): number;
  apiBudget: WritableSignal<number>;
  setBudget(value: number): void;
  canLoadMore(): boolean;
  exhausted(): boolean;
  grouping: WritableSignal<'none' | 'author' | 'date'>;
  groups(): { key: string; label: string; statuses: Status[] }[];
  collapseRepeats: WritableSignal<boolean>;
  repeatsHidden(): number;
  excludedCount(): number;
  excludedAuthors(): ReadonlySet<string>;
  toggleExcludedAuthor(acct: string): void;
  isAuthorExcluded(acct: string): boolean;
  toggleFacet(kind: FacetKind, value: string): void;
  isFacetSelected(kind: FacetKind, value: string): boolean;
  loadedFilter: WritableSignal<string>;
  clearRefinements(): void;
  runQuery(): void;
  loadMore(): void;
}

function internals(fixture: ComponentFixture<BlueskySearchPanel>): PanelInternals {
  return fixture.componentInstance as unknown as PanelInternals;
}

describe('BlueskySearchPanel', () => {
  /** Pages the stubbed post search will hand back, in order. */
  let postPages: BlueskySearchPage[];
  let accountPages: BlueskyAccountPage[];
  let postCalls: number;
  let accountCalls: number;

  beforeEach(() => {
    localStorage.clear();
    postCalls = 0;
    accountCalls = 0;
    postPages = [];
    accountPages = [];

    const postSearch = {
      search: (): Observable<BlueskySearchPage> => {
        const page = postPages[postCalls] ?? { statuses: [], cursor: null };
        postCalls += 1;
        return of(page);
      },
    };
    const accountSearch = {
      search: (): Observable<BlueskyAccountPage> => {
        const page = accountPages[accountCalls] ?? { results: [], cursor: null };
        accountCalls += 1;
        return of(page);
      },
    };

    TestBed.configureTestingModule({
      imports: [BlueskySearchPanel],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BlueskySearch, useValue: postSearch },
        { provide: BlueskyAccountSearch, useValue: accountSearch },
      ],
    });
  });

  function setUp(target: 'statuses' | 'accounts' = 'statuses') {
    const fixture = TestBed.createComponent(BlueskySearchPanel);
    fixture.componentRef.setInput('target', target);
    fixture.componentRef.setInput('query', 'angular');
    fixture.detectChanges();
    return fixture;
  }

  /** One page of N posts, with a cursor unless it is the last. */
  function page(ids: string[], cursor: string | null, acct?: string): BlueskySearchPage {
    return { statuses: ids.map((id) => makeStatus(id, acct)), cursor };
  }

  describe('API-call budget', () => {
    it('keeps paging until the budget is spent', () => {
      postPages = [page(['1'], 'c1'), page(['2'], 'c2'), page(['3'], 'c3')];
      const fixture = setUp();
      internals(fixture).apiBudget.set(2);

      internals(fixture).runQuery();

      // Two pages pulled eagerly, then it stops — the third cursor is left for
      // the reader's own "Load more".
      expect(postCalls).toBe(2);
      expect(internals(fixture).statuses().length).toBe(2);
      expect(internals(fixture).callsUsed()).toBe(2);
    });

    it('stops early when the server runs out, without spending the budget', () => {
      postPages = [page(['1'], 'c1'), page(['2'], null)];
      const fixture = setUp();
      internals(fixture).apiBudget.set(5);

      internals(fixture).runQuery();

      expect(postCalls).toBe(2);
      expect(internals(fixture).exhausted()).toBe(true);
      expect(internals(fixture).canLoadMore()).toBe(false);
    });

    it('stops when a page brings nothing new, rather than looping on duplicates', () => {
      // A shifting index can hand back the same post under a fresh cursor.
      postPages = [page(['1'], 'c1'), page(['1'], 'c2'), page(['9'], 'c3')];
      const fixture = setUp();
      internals(fixture).apiBudget.set(5);

      internals(fixture).runQuery();

      expect(postCalls).toBe(2);
      expect(internals(fixture).statuses().length).toBe(1);
    });

    it('tops up when the budget is raised after a search', () => {
      postPages = [page(['1'], 'c1'), page(['2'], 'c2'), page(['3'], 'c3')];
      const fixture = setUp();
      internals(fixture).apiBudget.set(1);
      internals(fixture).runQuery();
      expect(postCalls).toBe(1);

      internals(fixture).setBudget(3);

      // Raising it spends the new allowance rather than making the reader
      // re-run the search.
      expect(postCalls).toBe(3);
    });

    it('auto-pages account search too', () => {
      accountPages = [
        { results: [{ account: makeAccount('a'), relationship: null }], cursor: 'c1' },
        { results: [{ account: makeAccount('b'), relationship: null }], cursor: null },
      ] as unknown as BlueskyAccountPage[];
      const fixture = setUp('accounts');
      internals(fixture).apiBudget.set(3);

      internals(fixture).runQuery();

      expect(accountCalls).toBe(2);
    });

    it('resets the call counter for each new search', () => {
      postPages = [page(['1'], null)];
      const fixture = setUp();
      internals(fixture).runQuery();
      expect(internals(fixture).callsUsed()).toBe(1);

      postCalls = 0;
      internals(fixture).runQuery();

      expect(internals(fixture).callsUsed()).toBe(1);
    });
  });

  describe('client-side refinement', () => {
    function loaded(fixture: ComponentFixture<BlueskySearchPanel>, pages: BlueskySearchPage[]) {
      postPages = pages;
      internals(fixture).apiBudget.set(1);
      internals(fixture).runQuery();
    }

    it('groups by author without re-fetching', () => {
      const fixture = setUp();
      loaded(fixture, [
        {
          statuses: [
            makeStatus('1', 'alice.bsky.social'),
            makeStatus('2', 'bob.bsky.social'),
            makeStatus('3', 'alice.bsky.social'),
          ],
          cursor: null,
        },
      ]);
      const callsAfterSearch = postCalls;

      internals(fixture).grouping.set('author');

      const groups = internals(fixture).groups();
      expect(groups.length).toBe(2);
      expect(groups.every((g) => !!g.label)).toBe(true);
      // Grouping reshapes what is loaded; it must never cost a request.
      expect(postCalls).toBe(callsAfterSearch);
    });

    it('excludes a noisy author from the loaded results', () => {
      const fixture = setUp();
      loaded(fixture, [
        {
          statuses: [
            makeStatus('1', 'flooder.bsky.social'),
            makeStatus('2', 'flooder.bsky.social'),
            makeStatus('3', 'quiet.bsky.social'),
          ],
          cursor: null,
        },
      ]);

      internals(fixture).toggleExcludedAuthor('flooder.bsky.social');

      expect(
        internals(fixture)
          .visible()
          .map((s) => s.id),
      ).toEqual(['3']);
      expect(internals(fixture).excludedCount()).toBe(2);
      expect(internals(fixture).isAuthorExcluded('flooder.bsky.social')).toBe(true);
    });

    it('restores an excluded author when toggled back', () => {
      const fixture = setUp();
      loaded(fixture, [
        {
          statuses: [makeStatus('1', 'a.bsky.social'), makeStatus('2', 'b.bsky.social')],
          cursor: null,
        },
      ]);
      internals(fixture).toggleExcludedAuthor('a.bsky.social');
      expect(internals(fixture).visible().length).toBe(1);

      internals(fixture).toggleExcludedAuthor('a.bsky.social');

      expect(internals(fixture).visible().length).toBe(2);
    });

    it('collapses near-identical posts from one author', () => {
      const fixture = setUp();
      const spam = '<p>buy my thing now</p>';
      loaded(fixture, [
        {
          statuses: [
            makeStatus('1', 'flooder.bsky.social', { content: spam }),
            makeStatus('2', 'flooder.bsky.social', { content: spam }),
            makeStatus('3', 'quiet.bsky.social'),
          ],
          cursor: null,
        },
      ]);

      internals(fixture).collapseRepeats.set(true);

      expect(internals(fixture).repeatsHidden()).toBe(1);
      expect(internals(fixture).visible().length).toBe(2);
    });

    it('ORs values within a facet kind and ANDs across kinds', () => {
      const fixture = setUp();
      loaded(fixture, [
        {
          statuses: [
            makeStatus('en-alice', 'alice.bsky.social', { language: 'en' }),
            makeStatus('fr-alice', 'alice.bsky.social', { language: 'fr' }),
            makeStatus('en-bob', 'bob.bsky.social', { language: 'en' }),
          ],
          cursor: null,
        },
      ]);

      internals(fixture).toggleFacet('language', 'en');
      internals(fixture).toggleFacet('language', 'fr');

      // Two languages widen to "either" rather than replacing the first.
      expect(internals(fixture).visible().length).toBe(3);

      internals(fixture).toggleFacet('author', 'alice.bsky.social');

      // A different kind narrows: alice AND (en OR fr).
      expect(
        internals(fixture)
          .visible()
          .map((s) => s.id)
          .sort(),
      ).toEqual(['en-alice', 'fr-alice']);
    });

    it('clears every refinement at once, exclusions included', () => {
      const fixture = setUp();
      loaded(fixture, [
        {
          statuses: [makeStatus('1', 'a.bsky.social'), makeStatus('2', 'b.bsky.social')],
          cursor: null,
        },
      ]);
      internals(fixture).toggleExcludedAuthor('a.bsky.social');
      internals(fixture).loadedFilter.set('nothing matches this');

      internals(fixture).clearRefinements();

      expect(internals(fixture).excludedAuthors().size).toBe(0);
      expect(internals(fixture).visible().length).toBe(2);
    });

    it('drops refinements when a new search runs', () => {
      const fixture = setUp();
      loaded(fixture, [{ statuses: [makeStatus('1', 'a.bsky.social')], cursor: null }]);
      internals(fixture).toggleExcludedAuthor('a.bsky.social');
      internals(fixture).grouping.set('author');

      postCalls = 0;
      internals(fixture).runQuery();

      // Filters describe a result set; a new result set has none of them yet.
      expect(internals(fixture).excludedAuthors().size).toBe(0);
      expect(internals(fixture).grouping()).toBe('none');
    });
  });
});
