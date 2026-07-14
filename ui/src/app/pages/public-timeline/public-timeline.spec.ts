import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Status } from '../../models';
import { Streaming } from '../../streaming';
import { FakeStreaming } from '../../testing/fake-streaming';
import { PublicTimeline } from './public-timeline';

interface PublicTimelineInternals {
  statuses: Signal<Status[]>;
  local: WritableSignal<boolean>;
  live: WritableSignal<boolean>;
  setLocal(local: boolean): void;
  toggleLive(): void;
}

function internals(fixture: ComponentFixture<PublicTimeline>): PublicTimelineInternals {
  return fixture.componentInstance as unknown as PublicTimelineInternals;
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

describe('PublicTimeline', () => {
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

  function setUp(): ComponentFixture<PublicTimeline> {
    const fixture = TestBed.createComponent(PublicTimeline);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/timelines/public?limit=20').flush([]);
    return fixture;
  }

  /** Toggle live on and flush the fresh-snapshot refetch that going live triggers. */
  function goLive(fixture: ComponentFixture<PublicTimeline>): void {
    internals(fixture).toggleLive();
    httpMock.expectOne('/api/v1/timelines/public?limit=20').flush([]);
  }

  it('toggleLive() opens a non-local public stream by default', () => {
    const fixture = setUp();
    goLive(fixture);

    expect(internals(fixture).live()).toBe(true);
    expect(fakeStreaming.lastKind).toEqual({ stream: 'public', local: false });
  });

  it('switching to Local while live re-opens the stream as local', () => {
    const fixture = setUp();
    goLive(fixture);
    expect(fakeStreaming.openCount).toBe(1);

    internals(fixture).setLocal(true);
    httpMock.expectOne('/api/v1/timelines/public?limit=20&local=true').flush([]);

    expect(fakeStreaming.openCount).toBe(2);
    expect(fakeStreaming.lastKind).toEqual({ stream: 'public', local: true });
    expect(fakeStreaming.closed).toBe(false);
  });

  it('switching tabs while not live does not open a stream', () => {
    const fixture = setUp();
    internals(fixture).setLocal(true);
    httpMock.expectOne('/api/v1/timelines/public?limit=20&local=true').flush([]);

    expect(fakeStreaming.openCount).toBe(0);
  });

  it('prepends an incoming update and removes on delete', () => {
    const fixture = setUp();
    goLive(fixture);

    fakeStreaming.emit({ event: 'update', payload: makeStatus('1') });
    fakeStreaming.emit({ event: 'update', payload: makeStatus('2') });
    expect(
      internals(fixture)
        .statuses()
        .map((s) => s.id),
    ).toEqual(['2', '1']);

    fakeStreaming.emit({ event: 'delete', payload: '1' });
    expect(
      internals(fixture)
        .statuses()
        .map((s) => s.id),
    ).toEqual(['2']);
  });

  it('toggling live off closes the stream', () => {
    const fixture = setUp();
    goLive(fixture);
    internals(fixture).toggleLive();

    expect(internals(fixture).live()).toBe(false);
    expect(fakeStreaming.closed).toBe(true);
  });
});
