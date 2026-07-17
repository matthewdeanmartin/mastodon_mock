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

  it('friends and platform chips split the feed by the friend flag', () => {
    feed.posts.set([
      makePost('friendly', 'original', true),
      makePost('stranger', 'hashtag', false),
    ]);
    fixture.detectChanges();
    expect(text()).toContain('friendly');
    expect(text()).toContain('stranger');

    chip('Friends').click();
    fixture.detectChanges();
    expect(text()).toContain('friendly');
    expect(text()).not.toContain('stranger');

    chip('Platform').click();
    fixture.detectChanges();
    expect(text()).not.toContain('friendly');
    expect(text()).toContain('stranger');
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
