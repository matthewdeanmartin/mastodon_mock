import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Status } from '../../models';
import { Bookmarks } from './bookmarks';

/** Exposes Bookmarks' protected signals for white-box testing. */
interface BookmarksInternals {
  statuses: WritableSignal<Status[]>;
  loading: WritableSignal<boolean>;
  onChanged(index: number, updated: Status): void;
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

  it('onChanged replaces the status at the given index', () => {
    const fixture = setUp();
    const s1 = makeStatus('1');
    const s2 = makeStatus('2');
    httpMock.expectOne('/api/v1/bookmarks').flush([s1, s2]);

    const updated = { ...s2, content: '<p>updated</p>' };
    internals(fixture).onChanged(1, updated);

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
    internals(fixture).onChanged(1, updated);

    expect(internals(fixture).statuses()[0]).toBe(s1);
    expect(internals(fixture).statuses()[1]).toBe(updated);
    expect(internals(fixture).statuses()[2]).toBe(s3);
  });
});
