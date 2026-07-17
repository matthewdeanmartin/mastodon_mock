import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DraftSnapshot, Drafts, draftHasContent } from './drafts';

function snapshot(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    segments: ['hello'],
    spoilerText: '',
    sensitive: false,
    visibility: 'public',
    poll: null,
    ...overrides,
  };
}

describe('Drafts', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('saves a draft and lists it newest-first', () => {
    const drafts = TestBed.inject(Drafts);
    drafts.save(snapshot({ segments: ['older'] }));
    const id = drafts.save(snapshot({ segments: ['newer'] }));

    expect(drafts.drafts()).toHaveLength(2);
    expect(drafts.drafts()[0].id).toBe(id);
    expect(drafts.get(id)?.segments).toEqual(['newer']);
  });

  it('persists drafts across service instances (localStorage)', () => {
    const first = TestBed.inject(Drafts);
    const id = first.save(snapshot());

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const second = TestBed.inject(Drafts);
    expect(second.get(id)?.segments).toEqual(['hello']);
  });

  it('remove() deletes a draft', () => {
    const drafts = TestBed.inject(Drafts);
    const id = drafts.save(snapshot());
    drafts.remove(id);
    expect(drafts.drafts()).toEqual([]);
  });

  it('autosave slots are per-context and round-trip', () => {
    const drafts = TestBed.inject(Drafts);
    drafts.autosave('new', snapshot({ segments: ['top-level'] }));
    drafts.autosave('reply:9', snapshot({ segments: ['a reply'] }));

    expect(drafts.loadAutosave('new')?.segments).toEqual(['top-level']);
    expect(drafts.loadAutosave('reply:9')?.segments).toEqual(['a reply']);
    expect(drafts.loadAutosave('reply:8')).toBeNull();
  });

  it('autosaving an empty snapshot clears the slot', () => {
    const drafts = TestBed.inject(Drafts);
    drafts.autosave('new', snapshot());
    drafts.autosave('new', snapshot({ segments: [''] }));
    expect(drafts.loadAutosave('new')).toBeNull();
  });

  it('clearAutosave() empties only the given context', () => {
    const drafts = TestBed.inject(Drafts);
    drafts.autosave('new', snapshot());
    drafts.autosave('reply:9', snapshot());
    drafts.clearAutosave('new');
    expect(drafts.loadAutosave('new')).toBeNull();
    expect(drafts.loadAutosave('reply:9')).not.toBeNull();
  });

  it('draftHasContent() is true for text, CW or poll — not blank segments', () => {
    expect(draftHasContent(snapshot())).toBe(true);
    expect(draftHasContent(snapshot({ segments: ['', ' '] }))).toBe(false);
    expect(draftHasContent(snapshot({ segments: [''], spoilerText: 'cw' }))).toBe(true);
    expect(
      draftHasContent(
        snapshot({
          segments: [''],
          poll: { options: ['a', 'b'], multiple: false, expiresIn: 300 },
        }),
      ),
    ).toBe(true);
  });
});
