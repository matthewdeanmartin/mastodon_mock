import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlusSession } from '../account/plus-session';
import { PLUS_BENEFITS } from '../../plus-benefits';
import { PageDiagnostics } from '../../page-diagnostics';
import { ARTICLE_QUOTA_KEY, ArticleQuota, FREE_DAILY_ARTICLES } from './article-quota';

/** Enough of PlusSession to answer the one question the quota asks. */
class FakePlusSession {
  tier = signal<'free' | 'plus'>('free');
  isSupporter = () => this.tier() === 'plus';
  token = vi.fn().mockResolvedValue(null);
  refresh = vi.fn(async () => {
    await this.token();
  });
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
}

function build(plus = new FakePlusSession()) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ArticleQuota,
      { provide: PlusSession, useValue: plus },
      { provide: PageDiagnostics, useValue: log },
    ],
  });
  return { quota: TestBed.inject(ArticleQuota), plus, log };
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

  it('keeps the subscription page aligned with the enforced article benefit', () => {
    const benefit = PLUS_BENEFITS.find((row) => row.id === 'article-reader');

    expect(benefit?.free).toContain(String(FREE_DAILY_ARTICLES));
    expect(benefit?.plus).toContain('Unlimited');
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
    expect(stored).toEqual({
      day: today(),
      count: 1,
      freeFetches: 0,
      plusFetches: 0,
    });
  });

  it('records free and Plus fetch actions separately without spending quota', () => {
    const { quota, plus } = build();

    quota.recordFetch();
    quota.recordFetch();
    plus.tier.set('plus');
    quota.recordFetch();

    expect(quota.freeFetches()).toBe(2);
    expect(quota.plusFetches()).toBe(1);
    expect(quota.freeRemaining()).toBe(FREE_DAILY_ARTICLES);
    expect(quota.remaining()).toBe(Infinity);
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

  it('unlocks an exhausted subscriber without making them visit Settings', async () => {
    localStorage.setItem(
      ARTICLE_QUOTA_KEY,
      JSON.stringify({ day: today(), count: FREE_DAILY_ARTICLES }),
    );
    const plus = new FakePlusSession();
    let answerEntitlement!: () => void;
    plus.token.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          answerEntitlement = () => {
            plus.tier.set('plus');
            resolve(null);
          };
        }),
    );

    const { quota } = build(plus);

    // The stale local counter must not disable the only control that can cause
    // the account lookup. This was the production deadlock.
    expect(plus.refresh).toHaveBeenCalledOnce();
    expect(plus.token).toHaveBeenCalledOnce();
    expect(quota.checkingEntitlement()).toBe(true);
    expect(quota.allowed()).toBe(true);

    answerEntitlement();
    await expect(quota.authorize()).resolves.toBe(true);

    expect(quota.checkingEntitlement()).toBe(false);
    expect(quota.unlimited()).toBe(true);
    expect(quota.remaining()).toBe(Infinity);
    expect(quota.allowed()).toBe(true);
    expect(plus.refresh).toHaveBeenCalledOnce();
    expect(plus.token).toHaveBeenCalledOnce();
  });

  it('still enforces an exhausted counter after a free entitlement answer', async () => {
    localStorage.setItem(
      ARTICLE_QUOTA_KEY,
      JSON.stringify({ day: today(), count: FREE_DAILY_ARTICLES }),
    );
    const { quota, plus, log } = build();

    await expect(quota.authorize()).resolves.toBe(false);

    expect(plus.refresh).toHaveBeenCalledOnce();
    expect(plus.token).toHaveBeenCalledOnce();
    expect(quota.checkingEntitlement()).toBe(false);
    expect(quota.allowed()).toBe(false);
    expect(log.info).toHaveBeenCalledWith(
      'ArticleEntitlement',
      'check:complete',
      expect.objectContaining({ tier: 'free', failed: false, remaining: 0 }),
    );
    expect(log.info).toHaveBeenCalledWith(
      'ArticleEntitlement',
      'decision',
      expect.objectContaining({ tier: 'free', allowed: false, remaining: 0 }),
    );
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
