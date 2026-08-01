import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RSS_SUBSCRIPTION_LIMIT,
  RSS_SUBSCRIPTION_LIMIT_MAX,
  RssSubscriptions,
} from './rss-subscriptions';

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

  it('rejects subscriptions beyond the limit, and says where to change it', () => {
    const subs = TestBed.inject(RssSubscriptions);
    for (let index = 0; index < RSS_SUBSCRIPTION_LIMIT; index += 1) {
      expect(subs.add(`https://${index}.example/feed`, `Feed ${index}`)).toBeNull();
    }
    const error = subs.add('https://overflow.example/feed', 'Overflow');
    expect(error).toContain('limit of 10');
    expect(error).toContain('settings page');
    expect(subs.feeds()).toHaveLength(RSS_SUBSCRIPTION_LIMIT);
  });

  it('lets the reader set their own ceiling, and remembers it', () => {
    const subs = TestBed.inject(RssSubscriptions);

    subs.setLimit(40);
    for (let index = 0; index < 12; index += 1) {
      expect(subs.add(`https://${index}.example/feed`, `Feed ${index}`)).toBeNull();
    }

    expect(subs.feeds()).toHaveLength(12);
    expect(subs.remaining()).toBe(28);
    expect(localStorage.getItem('mockingbird_rss_feed_limit')).toBe('40');
  });

  it('clamps a nonsense limit rather than accepting it', () => {
    const subs = TestBed.inject(RssSubscriptions);

    subs.setLimit(0);
    expect(subs.limit()).toBe(RSS_SUBSCRIPTION_LIMIT);

    subs.setLimit(Number.NaN);
    expect(subs.limit()).toBe(RSS_SUBSCRIPTION_LIMIT);

    subs.setLimit(10_000);
    expect(subs.limit()).toBe(RSS_SUBSCRIPTION_LIMIT_MAX);
  });

  it('never deletes feeds when the limit is lowered under the current count', () => {
    // Moving a number down is not a request to throw away subscriptions.
    const subs = TestBed.inject(RssSubscriptions);
    subs.setLimit(20);
    for (let index = 0; index < 15; index += 1) {
      subs.add(`https://${index}.example/feed`, `Feed ${index}`);
    }

    subs.setLimit(5);

    expect(subs.feeds()).toHaveLength(15);
    expect(subs.remaining()).toBe(0);
    expect(subs.add('https://new.example/feed', 'New')).toContain('limit of 5');
  });
});
