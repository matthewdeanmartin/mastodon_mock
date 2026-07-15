import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { RssSubscriptions } from './rss-subscriptions';

describe('RssSubscriptions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds, toggles and removes feeds, persisting to localStorage', () => {
    const subs = TestBed.inject(RssSubscriptions);

    subs.add('https://a.example/feed', 'Feed A');
    subs.add('https://a.example/feed', 'duplicate ignored');
    subs.add('https://b.example/feed', 'Feed B');
    expect(subs.feeds().map((f) => f.title)).toEqual(['Feed A', 'Feed B']);
    expect(subs.enabledFeeds()).toHaveLength(2);

    subs.setEnabled('https://a.example/feed', false);
    expect(subs.enabledFeeds().map((f) => f.title)).toEqual(['Feed B']);

    subs.remove('https://b.example/feed');
    expect(subs.feeds().map((f) => f.title)).toEqual(['Feed A']);

    // A fresh service instance reads the persisted state back.
    const raw = JSON.parse(localStorage.getItem('mockingbird_rss_feeds')!);
    expect(raw).toEqual([{ url: 'https://a.example/feed', title: 'Feed A', enabled: false }]);
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('mockingbird_rss_feeds', '{nonsense');
    const subs = TestBed.inject(RssSubscriptions);
    expect(subs.feeds()).toEqual([]);
  });
});
