import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ANONYMOUS_TAG_LIMIT, AnonymousTags } from './anonymous-tags';

describe('AnonymousTags', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('normalizes, deduplicates, and persists followed tags', () => {
    const tags = TestBed.inject(AnonymousTags);
    expect(tags.follow('#Cats')).toEqual({ ok: true });
    expect(tags.follow('cats')).toEqual({ ok: true });
    expect(tags.tags()).toEqual(['cats']);
    expect(JSON.parse(localStorage.getItem('mockingbird_anonymous_tags') ?? '{}').tags).toEqual([
      'cats',
    ]);
  });

  it('rejects the sixth followed tag', () => {
    const tags = TestBed.inject(AnonymousTags);
    for (let index = 0; index < ANONYMOUS_TAG_LIMIT; index += 1) tags.follow(`tag${index}`);
    const result = tags.follow('one-too-many');
    expect(result.ok).toBe(false);
    expect(tags.count()).toBe(ANONYMOUS_TAG_LIMIT);
  });
});
