import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Status, UserList } from '../../models';
import { ListTimeline } from './list-timeline';

interface ListTimelineInternals {
  title: WritableSignal<string>;
  statuses: WritableSignal<Status[]>;
  loading: WritableSignal<boolean>;
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

function setUpWithList(listId: string): ComponentFixture<ListTimeline> {
  TestBed.overrideProvider(ActivatedRoute, {
    useValue: { paramMap: of(convertToParamMap({ id: listId })) },
  });
  const fixture = TestBed.createComponent(ListTimeline);
  fixture.detectChanges();
  return fixture;
}

describe('ListTimeline', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ---------------------------------------------------------------- initial load

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
});
