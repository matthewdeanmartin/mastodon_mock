import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderCore } from './reader-core';
import { ReaderLibrary } from '../../../providers/read/reader-library';
import { ClientPrefs } from '../../../client-prefs';
import { Status } from '../../../models';

/**
 * A host, because `ReaderCore` takes a required input and the interesting
 * behaviour is what happens when that input *changes* — a reader moving from
 * one document to the next.
 */
@Component({
  imports: [ReaderCore],
  template: `<app-reader-core [chain]="chain()" [layout]="layout()" />`,
})
class Host {
  readonly chain = signal<Status[]>([]);
  readonly layout = signal<'page' | 'pane'>('page');
}

/** `n` characters of prose, so the document-length rule can be exercised. */
function prose(n: number): string {
  return `<p>${'word '.repeat(Math.ceil(n / 5)).slice(0, n)}</p>`;
}

function post(id: string, chars: number, over: Partial<Status> = {}): Status {
  return {
    id,
    content: prose(chars),
    url: `https://example.com/${id}`,
    in_reply_to_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    account: { id: 'a', username: 'ann', acct: 'ann', display_name: 'Ann' },
    media_attachments: [],
    favourites_count: 0,
    reblogs_count: 0,
    replies_count: 0,
    ...over,
  } as unknown as Status;
}

describe('ReaderCore and the library', () => {
  let fixture: ComponentFixture<Host>;
  let library: ReaderLibrary;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(Host);
    library = TestBed.inject(ReaderLibrary);
  });

  function show(chain: Status[], layout: 'page' | 'pane' = 'page'): void {
    fixture.componentInstance.layout.set(layout);
    fixture.componentInstance.chain.set(chain);
    fixture.detectChanges();
  }

  it('shelves a long post as a document being read', () => {
    show([post('1', 900)]);
    expect(library.get('1')?.shelf).toBe('reading');
  });

  it('does not shelve a short post', () => {
    // The operator's rule: short or never-viewed tweets are never tracked.
    show([post('1', 120)]);
    expect(library.has('1')).toBe(false);
  });

  it('shelves a storm of short posts, because it was written as one thing', () => {
    show([post('1', 80), post('2', 80, { in_reply_to_id: '1' })]);
    expect(library.has('1')).toBe(true);
  });

  it('shelves an RSS item however short its teaser', () => {
    show([post('rss:f::g', 40, { provider: 'rss' })]);
    expect(library.has('rss:f::g')).toBe(true);
  });

  it('titles a document with no headline from its first sentence', () => {
    const content = '<p>The thing about ducks. And then a second sentence entirely.</p>';
    show([post('1', 900, { content: content + prose(900) })]);
    expect(library.get('1')?.title).toBe('The thing about ducks.');
  });

  it('shelves from the RSS pane too — reading an article there is reading it', () => {
    show([post('rss:f::g', 900, { provider: 'rss' })], 'pane');
    expect(library.has('rss:f::g')).toBe(true);
  });

  it('moving to a second document shelves that one as well', () => {
    show([post('1', 900)]);
    show([post('2', 900)]);
    expect(library.has('1')).toBe(true);
    expect(library.has('2')).toBe(true);
  });

  /**
   * The feed reader widget is a different component with no library access at
   * all — Home imports `reader-toolbar` (typography) and never `ReaderCore`.
   * Asserted here rather than in `home.spec.ts`, where it could only be a test
   * that nothing happened, which passes for the wrong reasons forever.
   */
  it('only shelves through the reader core, which the feed widget does not use', () => {
    show([post('1', 900)]);
    expect(library.total()).toBe(1);
    // Every entry came from a core render; there is no other writer.
    expect(Object.keys(library.snapshot())).toEqual(['1']);
  });

  it('re-rendering the same document does not re-shelve it', () => {
    const open = vi.spyOn(library, 'open');
    show([post('1', 900)]);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('ReaderCore position saving', () => {
  let fixture: ComponentFixture<Host>;
  let library: ReaderLibrary;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(Host);
    library = TestBed.inject(ReaderLibrary);
    TestBed.inject(ClientPrefs).setReaderPageFlip(true);
  });

  // Fake timers are global. Leaving them installed makes every later spec file
  // in the run see a clock that never advances — which surfaces as an unrelated
  // timing test failing for no visible reason.
  afterEach(() => {
    vi.useRealTimers();
  });

  function core(): ReaderCore {
    return fixture.debugElement.query((node) => node.componentInstance instanceof ReaderCore)
      .componentInstance as ReaderCore;
  }

  it('does not write to storage on every page turn', () => {
    // A localStorage write per arrow press is a synchronous serialization of
    // the whole library on the main thread, and paging is a held-down key.
    fixture.componentInstance.chain.set([post('1', 900)]);
    fixture.detectChanges();
    const record = vi.spyOn(library, 'recordPosition');

    core().nextPage();
    core().nextPage();
    core().nextPage();

    expect(record).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('flushes an unsaved position on destroy', () => {
    // A reader who closes the tab mid-article must not lose their place, which
    // is the one thing this feature promises.
    fixture.componentInstance.chain.set([post('1', 900)]);
    fixture.detectChanges();
    const record = vi.spyOn(library, 'recordPosition');

    core().nextPage();
    fixture.destroy();

    expect(record).toHaveBeenCalled();
  });

  it('does not save a position from the RSS pane', () => {
    // The pane shelves the document but is a preview strip beside a list, not
    // the surface that owns a position.
    fixture.componentInstance.layout.set('pane');
    fixture.componentInstance.chain.set([post('1', 900)]);
    fixture.detectChanges();
    const record = vi.spyOn(library, 'recordPosition');

    core().nextPage();
    vi.runAllTimers();

    expect(record).not.toHaveBeenCalled();
  });
});
