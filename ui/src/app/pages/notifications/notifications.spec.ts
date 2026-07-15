import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MastodonNotification } from '../../models';
import { Streaming } from '../../streaming';
import { FakeStreaming } from '../../testing/fake-streaming';
import { Notifications } from './notifications';

interface NotificationsInternals {
  items: Signal<MastodonNotification[]>;
  live: WritableSignal<boolean>;
  toggleLive(): void;
}

function internals(fixture: ComponentFixture<Notifications>): NotificationsInternals {
  return fixture.componentInstance as unknown as NotificationsInternals;
}

function makeNotification(id: string, type: string): MastodonNotification {
  return {
    id,
    type,
    created_at: '2026-01-01T00:00:00Z',
    account: {
      id: '1',
      username: 'alan',
      acct: 'alan',
      display_name: 'Alan',
    } as MastodonNotification['account'],
  };
}

describe('Notifications', () => {
  let httpMock: HttpTestingController;
  let fakeStreaming: FakeStreaming;

  beforeEach(() => {
    fakeStreaming = new FakeStreaming();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Streaming, useValue: fakeStreaming },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(): ComponentFixture<Notifications> {
    const fixture = TestBed.createComponent(Notifications);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/notifications').flush([]);
    return fixture;
  }

  it('toggleLive() opens the user stream', () => {
    const fixture = setUp();
    internals(fixture).toggleLive();

    expect(internals(fixture).live()).toBe(true);
    expect(fakeStreaming.lastKind).toEqual({ stream: 'user' });
  });

  it('prepends an incoming "notification" event', () => {
    const fixture = setUp();
    internals(fixture).toggleLive();

    fakeStreaming.emit({ event: 'notification', payload: makeNotification('1', 'follow') });

    expect(
      internals(fixture)
        .items()
        .map((n) => n.id),
    ).toEqual(['1']);
  });

  it('ignores non-notification stream events (e.g. update)', () => {
    const fixture = setUp();
    internals(fixture).toggleLive();

    fakeStreaming.emit({ event: 'update', payload: { id: 'should-be-ignored' } });

    expect(internals(fixture).items()).toEqual([]);
  });

  it('renders media thumbnails inside a mention excerpt', () => {
    const fixture = TestBed.createComponent(Notifications);
    fixture.detectChanges();
    const n = makeNotification('9', 'mention');
    n.status = {
      id: 's9',
      content: '<p>look at this</p>',
      media_attachments: [
        { id: 'm1', type: 'image', url: 'https://x/full.png', preview_url: 'https://x/prev.png' },
      ],
    } as unknown as MastodonNotification['status'];
    httpMock.expectOne('/api/v1/notifications').flush([n]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const img = el.querySelector<HTMLImageElement>('.excerpt-media img');
    expect(img?.getAttribute('src')).toBe('https://x/prev.png');
    expect(el.querySelector('.excerpt-content')?.textContent).toContain('look at this');
  });

  it('toggling live off closes the stream', () => {
    const fixture = setUp();
    internals(fixture).toggleLive();
    internals(fixture).toggleLive();

    expect(internals(fixture).live()).toBe(false);
    expect(fakeStreaming.closed).toBe(true);
  });
});
