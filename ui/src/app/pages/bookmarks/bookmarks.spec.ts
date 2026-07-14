import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Status } from '../../models';
import { BookmarkGroup } from './bookmark-groups';
import { Bookmarks } from './bookmarks';

/** Exposes Bookmarks' protected signals for white-box testing. */
interface BookmarksInternals {
  statuses: WritableSignal<Status[]>;
  loading: WritableSignal<boolean>;
  view: WritableSignal<'all' | 'authors' | 'hashtags' | 'media'>;
  groups: Signal<BookmarkGroup[]>;
  onChanged(updated: Status): void;
  onDeleted(removed: Status): void;
}

function internals(fixture: ComponentFixture<Bookmarks>): BookmarksInternals {
  return fixture.componentInstance as unknown as BookmarksInternals;
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
    bookmarked: true,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
  };
}

describe('Bookmarks', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(): ComponentFixture<Bookmarks> {
    const fixture = TestBed.createComponent(Bookmarks);
    fixture.detectChanges();
    return fixture;
  }

  it('starts with loading=true and an empty statuses list', () => {
    const fixture = setUp();
    expect(internals(fixture).loading()).toBe(true);
    expect(internals(fixture).statuses()).toEqual([]);
    httpMock.expectOne('/api/v1/bookmarks').flush([]);
  });

  it('populates statuses and clears loading on successful fetch', () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    const s2 = makeStatus('2');

    httpMock.expectOne('/api/v1/bookmarks').flush([s1, s2]);

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).statuses()).toEqual([s1, s2]);
  });

  it('clears loading on HTTP error', () => {
    const fixture = setUp();

    httpMock.expectOne('/api/v1/bookmarks').error(new ProgressEvent('error'));

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).statuses()).toEqual([]);
  });

  it('onChanged replaces the status with the matching id', () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    const s2 = makeStatus('2');
    httpMock.expectOne('/api/v1/bookmarks').flush([s1, s2]);

    const updated = { ...s2, content: '<p>updated</p>' };
    internals(fixture).onChanged(updated);

    expect(internals(fixture).statuses()).toEqual([s1, updated]);
  });

  it('onDeleted removes the matching status by id', () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    const s2 = makeStatus('2');
    httpMock.expectOne('/api/v1/bookmarks').flush([s1, s2]);

    internals(fixture).onDeleted(s1);

    expect(internals(fixture).statuses()).toEqual([s2]);
  });

  it('onChanged does not affect other statuses', () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    const s2 = makeStatus('2');
    const s3 = makeStatus('3');
    httpMock.expectOne('/api/v1/bookmarks').flush([s1, s2, s3]);

    const updated = { ...s2, content: '<p>changed</p>' };
    internals(fixture).onChanged(updated);

    expect(internals(fixture).statuses()[0]).toBe(s1);
    expect(internals(fixture).statuses()[1]).toBe(updated);
    expect(internals(fixture).statuses()[2]).toBe(s3);
  });

  // ---------------------------------------------------------------- library views

  function makeAuthored(id: string, acct: string, content: string, media = 0): Status {
    const s = makeStatus(id);
    return {
      ...s,
      content,
      account: { ...s.account, id: `a-${acct}`, acct, username: acct },
      media_attachments: Array.from(
        { length: media },
        (_, i) =>
          ({ id: `m${id}-${i}`, url: 'x', preview_url: 'x' }) as Status['media_attachments'][0],
      ),
    };
  }

  it("the 'all' view is a single unlabeled group in fetch order", () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    const s2 = makeStatus('2');
    httpMock.expectOne('/api/v1/bookmarks').flush([s1, s2]);

    const groups = internals(fixture).groups();
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('');
    expect(groups[0].statuses).toEqual([s1, s2]);
  });

  it("the 'authors' view groups by account with largest shelf first", () => {
    const fixture = setUp();
    httpMock
      .expectOne('/api/v1/bookmarks')
      .flush([
        makeAuthored('1', 'alice', '<p>one</p>'),
        makeAuthored('2', 'bob', '<p>two</p>'),
        makeAuthored('3', 'bob', '<p>three</p>'),
      ]);

    internals(fixture).view.set('authors');
    const groups = internals(fixture).groups();
    expect(groups.map((g) => g.label)).toEqual(['@bob', '@alice']);
    expect(groups[0].statuses.map((s) => s.id)).toEqual(['2', '3']);
  });

  it("the 'hashtags' view shelves posts under every tag plus a no-hashtags shelf", () => {
    const fixture = setUp();
    httpMock
      .expectOne('/api/v1/bookmarks')
      .flush([
        makeAuthored('1', 'alice', '<p>I love #cats and #dogs</p>'),
        makeAuthored('2', 'bob', '<p>more #cats</p>'),
        makeAuthored('3', 'bob', '<p>nothing tagged</p>'),
      ]);

    internals(fixture).view.set('hashtags');
    const groups = internals(fixture).groups();
    expect(groups.map((g) => g.label)).toEqual(['#cats', '#dogs', 'no hashtags']);
    expect(groups[0].statuses.map((s) => s.id)).toEqual(['1', '2']);
    expect(groups[2].statuses.map((s) => s.id)).toEqual(['3']);
  });

  it("the 'media' view keeps only posts with attachments", () => {
    const fixture = setUp();
    httpMock
      .expectOne('/api/v1/bookmarks')
      .flush([
        makeAuthored('1', 'alice', '<p>photo</p>', 2),
        makeAuthored('2', 'bob', '<p>text only</p>'),
      ]);

    internals(fixture).view.set('media');
    const groups = internals(fixture).groups();
    expect(groups).toHaveLength(1);
    expect(groups[0].statuses.map((s) => s.id)).toEqual(['1']);
  });
});
