import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account, Status, UserList } from '../../models';
import { ListTimeline } from './list-timeline';
import { Auth } from '../../auth';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';
import { AnonymousLists } from '../../providers/anonymous/anonymous-lists';

interface ListTimelineInternals {
  title: WritableSignal<string>;
  statuses: WritableSignal<Status[]>;
  loading: WritableSignal<boolean>;
  tab: WritableSignal<'posts' | 'members'>;
  members: WritableSignal<Account[]>;
  setTab(tab: 'posts' | 'members'): void;
  removeMember(account: Account): void;
  onBulkAdded(): void;
}

function makeAccount(id: string): Account {
  return { id, username: `u${id}`, acct: `u${id}`, display_name: `User ${id}` } as Account;
}

function internals(fixture: ComponentFixture<ListTimeline>): ListTimelineInternals {
  return fixture.componentInstance as unknown as ListTimelineInternals;
}

function makeStatus(id: string): Status {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: '1', username: 'user', acct: 'user', display_name: 'User' } as never,
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

function makeList(id: string, title: string): UserList {
  return { id, title };
}

let httpMock: HttpTestingController;

function setUpWithList(listId: string, prepare?: () => void): ComponentFixture<ListTimeline> {
  TestBed.overrideProvider(ActivatedRoute, {
    useValue: { paramMap: of(convertToParamMap({ id: listId })) },
  });
  prepare?.();
  httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ListTimeline);
  fixture.detectChanges();
  return fixture;
}

describe('ListTimeline', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ---------------------------------------------------------------- initial load

  it('blends posts from browser-local list members through their saved public read refs', () => {
    let follows!: AnonymousFollows;
    let target!: Account;
    const fixture = setUpWithList('anonymous-list', () => {
      localStorage.setItem(
        'mockingbird_anonymous_lists',
        JSON.stringify({
          version: 2,
          lists: [{ id: 'anonymous-list', title: 'Readers', memberKeys: ['alice@social.example'] }],
        }),
      );
      TestBed.inject(Auth).enterAnonymous('https://home.example');
      follows = TestBed.inject(AnonymousFollows);
      target = {
        ...makeAccount('local-alice'),
        username: 'alice',
        acct: 'alice@social.example',
        url: 'https://social.example/@alice',
      };
      follows.follow(target, 'https://home.example');
    });
    httpMock
      .expectOne(
        'https://home.example/api/v1/accounts/local-alice/statuses?limit=20&exclude_replies=true',
      )
      .flush([{ ...makeStatus('post-1'), account: target }]);

    expect(internals(fixture).members()).toEqual([follows.follows()[0].account]);
    expect(internals(fixture).statuses()).toHaveLength(1);
    expect(internals(fixture).statuses()[0].provider).toBe('anonymous-mastodon');
    expect(internals(fixture).title()).toBe('Readers');
    httpMock.expectNone((request) => request.url.startsWith('/api/v1/lists/'));
  });

  it('fetches list metadata and timeline on init for the route param', () => {
    const fixture = setUpWithList('42');

    httpMock.expectOne('/api/v1/lists/42').flush(makeList('42', 'Dev Friends'));
    httpMock
      .expectOne((r) => r.url === '/api/v1/timelines/list/42')
      .flush([makeStatus('1'), makeStatus('2')]);

    expect(internals(fixture).title()).toBe('Dev Friends');
    expect(internals(fixture).statuses()).toHaveLength(2);
    expect(internals(fixture).loading()).toBe(false);
  });

  it('starts in loading state', () => {
    const fixture = setUpWithList('1');
    expect(internals(fixture).loading()).toBe(true);

    httpMock.expectOne('/api/v1/lists/1').flush(makeList('1', 'My List'));
    httpMock.expectOne((r) => r.url === '/api/v1/timelines/list/1').flush([]);
  });

  it('clears loading on timeline HTTP error', () => {
    const fixture = setUpWithList('99');
    httpMock.expectOne('/api/v1/lists/99').flush(makeList('99', 'Broken'));
    httpMock
      .expectOne((r) => r.url === '/api/v1/timelines/list/99')
      .flush('', { status: 500, statusText: 'Error' });

    expect(internals(fixture).loading()).toBe(false);
  });

  // ---------------------------------------------------------------- onChanged

  it('onChanged: replaces the status at the given index', () => {
    const fixture = setUpWithList('5');
    httpMock.expectOne('/api/v1/lists/5').flush(makeList('5', 'Test'));
    httpMock
      .expectOne((r) => r.url === '/api/v1/timelines/list/5')
      .flush([makeStatus('a'), makeStatus('b')]);

    const updated = { ...makeStatus('a'), favourited: true };
    fixture.componentInstance.onChanged(0, updated);

    expect(internals(fixture).statuses()[0].favourited).toBe(true);
    expect(internals(fixture).statuses()[1].id).toBe('b');
  });

  // ---------------------------------------------------------------- onDeleted

  it('onDeleted: removes the status with the matching id', () => {
    const fixture = setUpWithList('7');
    httpMock.expectOne('/api/v1/lists/7').flush(makeList('7', 'Filtered'));
    httpMock
      .expectOne((r) => r.url === '/api/v1/timelines/list/7')
      .flush([makeStatus('x'), makeStatus('y'), makeStatus('z')]);

    fixture.componentInstance.onDeleted(makeStatus('y'));

    expect(
      internals(fixture)
        .statuses()
        .map((s) => s.id),
    ).toEqual(['x', 'z']);
  });

  // ---------------------------------------------------------------- members tab

  /** Load the list + timeline so the component settles on the posts tab. */
  function loadList(fixture: ComponentFixture<ListTimeline>, id: string): void {
    httpMock.expectOne(`/api/v1/lists/${id}`).flush(makeList(id, 'Members List'));
    httpMock.expectOne((r) => r.url === `/api/v1/timelines/list/${id}`).flush([]);
  }

  it('does NOT request members on init (posts tab is default)', () => {
    const fixture = setUpWithList('10');
    loadList(fixture, '10');

    expect(internals(fixture).tab()).toBe('posts');
    httpMock.expectNone('/api/v1/lists/10/accounts');
  });

  it('lazy-loads members on the first members-tab click, and does not refetch on the second', () => {
    const fixture = setUpWithList('11');
    loadList(fixture, '11');

    internals(fixture).setTab('members');
    httpMock.expectOne('/api/v1/lists/11/accounts').flush([makeAccount('a'), makeAccount('b')]);
    expect(
      internals(fixture)
        .members()
        .map((m) => m.id),
    ).toEqual(['a', 'b']);

    // Second visit → guard prevents a refetch.
    internals(fixture).setTab('posts');
    internals(fixture).setTab('members');
    httpMock.expectNone('/api/v1/lists/11/accounts');
  });

  it('shows a person added by name to an Anonymous list without a page refresh', () => {
    let follows!: AnonymousFollows;
    let lists!: AnonymousLists;
    const fixture = setUpWithList('anonymous-list', () => {
      localStorage.setItem(
        'mockingbird_anonymous_lists',
        JSON.stringify({
          version: 2,
          lists: [{ id: 'anonymous-list', title: 'Readers', memberKeys: [] }],
        }),
      );
      TestBed.inject(Auth).enterAnonymous('https://home.example');
      follows = TestBed.inject(AnonymousFollows);
      lists = TestBed.inject(AnonymousLists);
    });
    const added = {
      ...makeAccount('bob'),
      username: 'bob',
      acct: 'bob@social.example',
      url: 'https://social.example/@bob',
    };
    follows.follow(added, 'https://social.example');
    const follow = follows.findByAccountId('bob');
    expect(follow).not.toBeNull();
    lists.setMember('anonymous-list', follow!.key, true);

    internals(fixture).setTab('members');
    internals(fixture).onBulkAdded();

    expect(
      internals(fixture)
        .members()
        .map((member) => member.id),
    ).toEqual(['bob']);
    httpMock.expectNone((request) => request.url.startsWith('/api/v1/lists/'));
  });

  it('removeMember DELETEs /lists/:id/accounts and drops the row', () => {
    const fixture = setUpWithList('12');
    loadList(fixture, '12');

    internals(fixture).setTab('members');
    httpMock.expectOne('/api/v1/lists/12/accounts').flush([makeAccount('a'), makeAccount('b')]);

    internals(fixture).removeMember(makeAccount('a'));
    const del = httpMock.expectOne('/api/v1/lists/12/accounts');
    expect(del.request.method).toBe('DELETE');
    del.flush({});

    expect(
      internals(fixture)
        .members()
        .map((m) => m.id),
    ).toEqual(['b']);
  });
});
