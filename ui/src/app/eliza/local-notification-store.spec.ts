import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalNotificationStore } from './local-notification-store';

describe('LocalNotificationStore', () => {
  let store: LocalNotificationStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(LocalNotificationStore);
  });

  it('starts empty with zero unread', () => {
    expect(store.items()).toEqual([]);
    expect(store.unread()).toBe(0);
  });

  it('push adds an unread notification, newest first', () => {
    store.push('reply', 'first', '/home');
    store.push('message', 'second', '/eliza/chat');
    const items = store.items();
    expect(items.length).toBe(2);
    expect(items[0].text).toBe('second'); // newest first
    expect(store.unread()).toBe(2);
  });

  it('markAllRead clears the unread count but keeps the items', () => {
    store.push('reply', 'hi', '/home');
    store.markAllRead();
    expect(store.unread()).toBe(0);
    expect(store.items().length).toBe(1);
  });

  it('ensureWelcome adds exactly one welcome notification', () => {
    store.ensureWelcome();
    store.ensureWelcome();
    expect(store.items().filter((n) => n.kind === 'welcome').length).toBe(1);
  });

  it('persists across a refresh', () => {
    store.push('message', 'remember', '/eliza/chat');
    const fresh = TestBed.inject(LocalNotificationStore);
    fresh.refresh();
    expect(fresh.items().length).toBe(1);
    expect(fresh.unread()).toBe(1);
  });

  it('clear wipes everything', () => {
    store.push('reply', 'x', '/home');
    store.clear();
    expect(store.items()).toEqual([]);
  });
});
