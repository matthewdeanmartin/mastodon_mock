import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Status } from '../../models';
import { AnonymousHomeFeedCache } from './anonymous-home-feed-cache';

function status(id: string): Status {
  return { id, account: { username: 'alice' } } as Status;
}

describe('AnonymousHomeFeedCache', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('persists a populated snapshot and can invalidate it', () => {
    const cache = TestBed.inject(AnonymousHomeFeedCache);
    cache.store([status('one'), status('two')]);
    expect(cache.populated()).toBe(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const restored = TestBed.inject(AnonymousHomeFeedCache);
    expect(restored.statuses().map((item) => item.id)).toEqual(['one', 'two']);

    restored.invalidate();
    expect(restored.populated()).toBe(false);
    expect(localStorage.getItem('mockingbird_anonymous_home_feed')).toBeNull();
  });
});
