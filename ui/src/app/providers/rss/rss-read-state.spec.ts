import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { RssReadState } from './rss-read-state';

const A = 'rss:https://a.example/feed::item-1';
const B = 'rss:https://a.example/feed::item-2';
const C = 'rss:https://b.example/feed::item-1';

describe('RssReadState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with nothing read or starred', () => {
    const store = TestBed.inject(RssReadState);
    expect(store.isRead(A)).toBe(false);
    expect(store.isStarred(A)).toBe(false);
    expect(store.readCount()).toBe(0);
  });

  it('marks read and unread', () => {
    const store = TestBed.inject(RssReadState);
    store.markRead(A);
    expect(store.isRead(A)).toBe(true);
    expect(store.isRead(B)).toBe(false);

    store.markUnread(A);
    expect(store.isRead(A)).toBe(false);
  });

  it('stores a timestamp, for the prune that does not exist yet', () => {
    TestBed.inject(RssReadState).markRead(A, 1234);
    const raw = JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith('mockingbird_rss_read'))!,
      )!,
    );
    expect(raw[A]).toBe(1234);
  });

  it('survives a reload', () => {
    TestBed.inject(RssReadState).markRead(A);
    TestBed.resetTestingModule();
    expect(TestBed.inject(RssReadState).isRead(A)).toBe(true);
  });

  it('marks many read in one go, leaving others alone', () => {
    const store = TestBed.inject(RssReadState);
    store.markManyRead([A, B]);

    expect(store.isRead(A)).toBe(true);
    expect(store.isRead(B)).toBe(true);
    // The whole point of the scoped API: an id nobody passed stays unread.
    expect(store.isRead(C)).toBe(false);
    expect(store.readCount()).toBe(2);
  });

  it('keeps read and starred independent', () => {
    const store = TestBed.inject(RssReadState);
    store.setStarred(A, true);

    // Starred but unread is a legitimate state and must not imply the other.
    expect(store.isStarred(A)).toBe(true);
    expect(store.isRead(A)).toBe(false);

    store.markRead(A);
    expect(store.isStarred(A)).toBe(true);

    store.markUnread(A);
    expect(store.isStarred(A)).toBe(true);
  });

  it('toggles a star', () => {
    const store = TestBed.inject(RssReadState);
    store.toggleStarred(A);
    expect(store.isStarred(A)).toBe(true);
    store.toggleStarred(A);
    expect(store.isStarred(A)).toBe(false);
  });

  it('lists starred ids newest first', () => {
    const store = TestBed.inject(RssReadState);
    store.setStarred(A, true, 100);
    store.setStarred(B, true, 300);
    store.setStarred(C, true, 200);

    expect(store.starredIds()).toEqual([B, C, A]);
  });

  it('clears everything', () => {
    const store = TestBed.inject(RssReadState);
    store.markRead(A);
    store.setStarred(B, true);

    store.clear();

    expect(store.readCount()).toBe(0);
    expect(store.starredCount()).toBe(0);
  });

  it('survives corrupt stored data rather than throwing', () => {
    localStorage.setItem('mockingbird_rss_read', 'not json');
    TestBed.resetTestingModule();
    expect(TestBed.inject(RssReadState).readCount()).toBe(0);
  });

  it('drops non-numeric entries but keeps the rest of the store', () => {
    const key = 'mockingbird_rss_read';
    localStorage.setItem(key, JSON.stringify({ [A]: 5, [B]: 'nope' }));
    TestBed.resetTestingModule();

    const store = TestBed.inject(RssReadState);
    expect(store.isRead(A)).toBe(true);
    expect(store.isRead(B)).toBe(false);
  });
});
