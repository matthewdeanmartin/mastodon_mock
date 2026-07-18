import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MastodonNotification, Status } from '../../models';
import { Streaming } from '../../streaming';
import { FakeStreaming } from '../../testing/fake-streaming';
import { groupNotifications, Notifications } from './notifications';

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

  describe('groupNotifications', () => {
    function notif(
      id: string,
      type: string,
      accountId: string,
      statusId?: string,
    ): MastodonNotification {
      const n = makeNotification(id, type);
      n.account = { ...n.account, id: accountId, username: `u${accountId}` };
      if (statusId) {
        n.status = { id: statusId, content: '', media_attachments: [] } as unknown as Status;
      }
      return n;
    }

    it('leaves buckets at or under the threshold expanded', () => {
      const rows = groupNotifications([
        notif('1', 'favourite', 'a', 's1'),
        notif('2', 'favourite', 'b', 's1'),
        notif('3', 'favourite', 'c', 's1'),
      ]);
      expect(rows.map((r) => r.kind)).toEqual(['single', 'single', 'single']);
    });

    it('collapses 4+ same-status notifications into one group at the newest position', () => {
      const rows = groupNotifications([
        notif('0', 'follow', 'z'),
        notif('1', 'reblog', 'a', 's1'),
        notif('2', 'reblog', 'b', 's1'),
        notif('3', 'reblog', 'c', 's1'),
        notif('4', 'reblog', 'd', 's1'),
        notif('5', 'follow', 'y'),
      ]);
      expect(rows.map((r) => r.kind)).toEqual(['single', 'group', 'single']);
      const group = rows[1] as Extract<(typeof rows)[number], { kind: 'group' }>;
      expect(group.count).toBe(4);
      expect(group.sample.map((n) => n.account.id)).toEqual(['a', 'b', 'c']);
      expect(group.status.id).toBe('s1');
    });

    it('groups per (type, status): favourites and reblogs of one post stay apart', () => {
      const rows = groupNotifications([
        ...['a', 'b', 'c', 'd'].map((who, i) => notif(`f${i}`, 'favourite', who, 's1')),
        ...['a', 'b', 'c', 'd'].map((who, i) => notif(`r${i}`, 'reblog', who, 's1')),
      ]);
      expect(rows.map((r) => r.kind)).toEqual(['group', 'group']);
    });

    it('never groups mentions', () => {
      const rows = groupNotifications(
        ['a', 'b', 'c', 'd', 'e'].map((who, i) => notif(`${i}`, 'mention', who, 's1')),
      );
      expect(rows.every((r) => r.kind === 'single')).toBe(true);
    });

    it('counts each account once, so repeats do not trip the threshold', () => {
      const rows = groupNotifications([
        notif('1', 'favourite', 'a', 's1'),
        notif('2', 'favourite', 'a', 's1'),
        notif('3', 'favourite', 'b', 's1'),
        notif('4', 'favourite', 'c', 's1'),
      ]);
      expect(rows.every((r) => r.kind === 'single')).toBe(true);
    });
  });

  it('toggling live off closes the stream', () => {
    const fixture = setUp();
    internals(fixture).toggleLive();
    internals(fixture).toggleLive();

    expect(internals(fixture).live()).toBe(false);
    expect(fakeStreaming.closed).toBe(true);
  });
});
