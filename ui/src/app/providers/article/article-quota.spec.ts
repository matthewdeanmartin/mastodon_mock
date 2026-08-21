import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlusSession } from '../account/plus-session';
import { ARTICLE_QUOTA_KEY, ArticleQuota, FREE_DAILY_ARTICLES } from './article-quota';

/** Enough of PlusSession to answer the one question the quota asks. */
class FakePlusSession {
  tier = signal<'free' | 'plus'>('free');
  isSupporter = () => this.tier() === 'plus';
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
}

function build(): { quota: ArticleQuota; plus: FakePlusSession } {
  const plus = new FakePlusSession();
  TestBed.configureTestingModule({
    providers: [ArticleQuota, { provide: PlusSession, useValue: plus }],
  });
  return { quota: TestBed.inject(ArticleQuota), plus };
}

describe('ArticleQuota', () => {
  beforeEach(() => {
    localStorage.removeItem(ARTICLE_QUOTA_KEY);
    TestBed.resetTestingModule();
  });

  it('starts with the full free allowance', () => {
    const { quota } = build();
    expect(quota.remaining()).toBe(FREE_DAILY_ARTICLES);
    expect(quota.allowed()).toBe(true);
  });

  it('counts down and then refuses', () => {
    const { quota } = build();
    for (let i = 0; i < FREE_DAILY_ARTICLES; i += 1) {
      expect(quota.allowed()).toBe(true);
      quota.consume();
    }
    expect(quota.remaining()).toBe(0);
    expect(quota.allowed()).toBe(false);
  });

  it('resets when the stored day is not today', () => {
    localStorage.setItem(ARTICLE_QUOTA_KEY, JSON.stringify({ day: '2000-01-01', count: 99 }));
    const { quota } = build();
    expect(quota.remaining()).toBe(FREE_DAILY_ARTICLES);
  });

  it('persists the count under today’s date', () => {
    const { quota } = build();
    quota.consume();
    const stored = JSON.parse(localStorage.getItem(ARTICLE_QUOTA_KEY) ?? '{}');
    expect(stored).toEqual({ day: today(), count: 1 });
  });

  it('never limits a supporter', () => {
    const { quota, plus } = build();
    plus.tier.set('plus');
    expect(quota.unlimited()).toBe(true);
    expect(quota.remaining()).toBe(Infinity);
    quota.consume();
    // Nothing was written: a supporter's reading is not counted at all.
    expect(localStorage.getItem(ARTICLE_QUOTA_KEY)).toBeNull();
    expect(quota.allowed()).toBe(true);
  });

  it('treats corrupt stored data as a fresh day', () => {
    localStorage.setItem(ARTICLE_QUOTA_KEY, 'not json');
    const { quota } = build();
    expect(quota.remaining()).toBe(FREE_DAILY_ARTICLES);
  });

  it('re-reads storage on refresh', () => {
    const { quota } = build();
    localStorage.setItem(ARTICLE_QUOTA_KEY, JSON.stringify({ day: today(), count: 2 }));
    quota.refresh();
    expect(quota.remaining()).toBe(0);
  });
});
