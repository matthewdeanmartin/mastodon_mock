import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClientPrefs, isPostNoun } from './client-prefs';
import { Terminology } from './terminology';

describe('Terminology', () => {
  let words: Terminology['words'];
  let prefs: ClientPrefs;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    prefs = TestBed.inject(ClientPrefs);
    words = TestBed.inject(Terminology).words;
  });

  it('defaults to the fediverse vocabulary', () => {
    expect(words().Posts).toBe('Posts');
    expect(words().Boosts).toBe('Boosts');
  });

  it('swaps to tweets', () => {
    prefs.setPostNoun('tweet');
    expect(words().Posts).toBe('Tweets');
    expect(words().BoostedBy).toBe('Retweeted by');
  });

  it('swaps to florps, verb and all', () => {
    prefs.setPostNoun('florp');
    expect(words().post).toBe('florp');
    expect(words().Posts).toBe('Florps');
    expect(words().boost).toBe('reflorp');
    expect(words().Boosts).toBe('Reflorps');
    expect(words().BoostedBy).toBe('Reflorped by');
    expect(words().PostAll).toBe('Florp all');
  });

  it('rejects a noun it does not ship, leaving the current one alone', () => {
    prefs.setPostNoun('florp');
    prefs.setPostNoun('skeet' as never);
    // Not 'post': the setter refuses the unknown value rather than resetting.
    expect(words().Posts).toBe('Florps');
  });

  it('recognises exactly the shipped nouns', () => {
    expect(isPostNoun('post')).toBe(true);
    expect(isPostNoun('tweet')).toBe(true);
    expect(isPostNoun('florp')).toBe(true);
    // A value from a future build, or junk in localStorage, must not throw —
    // it falls back to posts, which is what an unrecognised setting means.
    expect(isPostNoun('skeet')).toBe(false);
    expect(isPostNoun(undefined)).toBe(false);
  });
});
