import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Status } from '../../models';
import { Streaming } from '../../streaming';
import { FakeStreaming } from '../../testing/fake-streaming';
import { Home } from './home';

/** Exposes Home's protected signals for white-box testing. */
interface HomeInternals {
  statuses: Signal<Status[]>;
  live: WritableSignal<boolean>;
  toggleLive(): void;
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

  beforeEach(() => {
    fakeStreaming = new FakeStreaming();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Streaming, useValue: fakeStreaming },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
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
});
