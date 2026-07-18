import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgoFeed, AlgoPost, AlgoSource } from '../../algo-feed';
import { ClientPrefs } from '../../client-prefs';
import { Status } from '../../models';
import { Algo } from './algo';

function makeStatus(id: string, content = `<p>${id}</p>`): Status {
  return {
    id,
    created_at: '2026-07-01T00:00:00.000Z',
    edited_at: null,
    content,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: { id: 'a', username: 'a', acct: 'a', display_name: 'A' } as never,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
  };
}

function makePost(id: string, source: AlgoSource, friend: boolean, content?: string): AlgoPost {
  return { status: makeStatus(id, content), source, friend, score: 1 };
}

interface FakeFeed {
  posts: ReturnType<typeof signal<AlgoPost[]>>;
  loading: ReturnType<typeof signal<boolean>>;
  error: ReturnType<typeof signal<boolean>>;
  builtAt: ReturnType<typeof signal<number | null>>;
  callsUsed: ReturnType<typeof signal<number>>;
  hashtag: ReturnType<typeof signal<string | null>>;
  ensureBuilt: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  shufflePosts: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  removeStatus: ReturnType<typeof vi.fn>;
}

describe('Algo page', () => {
  let feed: FakeFeed;
  let fixture: ComponentFixture<Algo>;

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function chip(label: string): HTMLButtonElement {
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    const found = buttons.find((b) => b.textContent?.includes(label));
    if (!found) {
      throw new Error(`no chip labeled ${label}`);
    }
    return found;
  }

  beforeEach(() => {
    localStorage.clear();
    feed = {
      posts: signal<AlgoPost[]>([]),
      loading: signal(false),
      error: signal(false),
      builtAt: signal<number | null>(Date.now()),
      callsUsed: signal(7),
      hashtag: signal<string | null>('cats'),
      ensureBuilt: vi.fn(),
      refresh: vi.fn(),
      shufflePosts: vi.fn(),
      updateStatus: vi.fn(),
      removeStatus: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AlgoFeed, useValue: feed },
      ],
    });
    fixture = TestBed.createComponent(Algo);
  });

  it('asks the feed to build on init and shows the build meta', () => {
    feed.posts.set([makePost('p1', 'mutual', true)]);
    fixture.detectChanges();
    expect(feed.ensureBuilt).toHaveBeenCalled();
    expect(text()).toContain('1 posts from 7 API calls');
    expect(text()).toContain('#cats');
    expect(text()).toContain('Top post from a mutual');
  });

  it('Friends shows only posts authored by follows — no boosts, no hashtag finds', () => {
    feed.posts.set([
      makePost('authored', 'original', true),
      makePost('mutualpost', 'mutual', true),
      makePost('boosted', 'boost', true),
      makePost('tagfind', 'hashtag', false),
    ]);
    fixture.detectChanges();
    expect(text()).toContain('authored');
    expect(text()).toContain('boosted');
    expect(text()).toContain('tagfind');

    chip('Friends').click();
    fixture.detectChanges();
    expect(text()).toContain('authored');
    expect(text()).toContain('mutualpost');
    expect(text()).not.toContain('boosted');
    expect(text()).not.toContain('tagfind');

    chip('All').click();
    fixture.detectChanges();
    expect(text()).toContain('boosted');
    expect(text()).toContain('tagfind');
  });

  it('Tags chip toggles hashtag posts in and out (only offered in All mode)', () => {
    feed.posts.set([makePost('authored', 'original', true), makePost('tagfind', 'hashtag', false)]);
    fixture.detectChanges();
    expect(text()).toContain('tagfind');

    chip('Tags').click(); // toggle off
    fixture.detectChanges();
    expect(text()).toContain('authored');
    expect(text()).not.toContain('tagfind');
    expect(TestBed.inject(ClientPrefs).algoTags()).toBe(false);

    chip('Tags').click(); // back on
    fixture.detectChanges();
    expect(text()).toContain('tagfind');

    // In Friends mode the Tags chip disappears — it has nothing to govern.
    chip('Friends').click();
    fixture.detectChanges();
    expect(() => chip('Tags')).toThrow();
  });

  it('shuffle button re-deals via the service', () => {
    fixture.detectChanges();
    chip('Shuffle').click();
    expect(feed.shufflePosts).toHaveBeenCalled();
  });

  it('calm mode hides heated posts and reports how many', () => {
    feed.posts.set([
      makePost('nice', 'original', true, '<p>lovely garden update</p>'),
      makePost('angry', 'original', true, '<p>you disgusting corrupt liars!!!</p>'),
    ]);
    fixture.detectChanges();
    expect(text()).toContain('you disgusting');

    chip('Calm').click();
    fixture.detectChanges();
    expect(text()).not.toContain('you disgusting');
    expect(text()).toContain('lovely garden');
    expect(text()).toContain('calm mode hid 1');
    expect(TestBed.inject(ClientPrefs).algoCalm()).toBe(true);
  });

  it('calm mode also hides ratioed posts and quote-dunks', () => {
    // Politely worded, but 40 replies over 2 favs: a pile-on, not a hit.
    const ratioed = makePost('ratioed', 'original', true, '<p>my measured hot take</p>');
    ratioed.status.replies_count = 40;
    ratioed.status.favourites_count = 2;
    // Mildly negative ("dumb" scores 1, below the heated threshold) — but on a
    // quote it's a dunk, so only the dunk rule can be what hides it.
    const dunk = makePost('dunk', 'original', true, '<p>what a dumb take</p>');
    dunk.status.quote = { state: 'accepted', quoted_status: null };
    feed.posts.set([
      makePost('nice', 'original', true, '<p>lovely garden update</p>'),
      ratioed,
      dunk,
    ]);
    TestBed.inject(ClientPrefs).setAlgoCalm(true);
    fixture.detectChanges();

    expect(text()).toContain('lovely garden');
    expect(text()).not.toContain('measured hot take');
    expect(text()).not.toContain('dumb take');
    expect(text()).toContain('calm mode hid 2');
  });

  it('refresh button rebuilds; loading and error states render', () => {
    fixture.detectChanges();
    chip('Refresh').click();
    expect(feed.refresh).toHaveBeenCalled();

    feed.loading.set(true);
    fixture.detectChanges();
    expect(text()).toContain('Gathering the good stuff');

    feed.loading.set(false);
    feed.error.set(true);
    fixture.detectChanges();
    expect(text()).toContain('Couldn’t build your Algo feed');
  });

  it('empty state nudges toward follows and hashtags', () => {
    fixture.detectChanges();
    expect(text()).toContain('follow some people and hashtags');
  });
});
