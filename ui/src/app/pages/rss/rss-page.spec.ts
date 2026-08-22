import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParsedFeed } from '../../providers/rss/rss-parser';
import { RssFetch } from '../../providers/rss/rss-fetch';
import { RssSubscriptions } from '../../providers/rss/rss-subscriptions';
import { RssPage } from './rss-page';
import { StatusCard } from '../../status-card/status-card';
import { Status } from '../../models';

/**
 * Stands in for `app-status-card`, rendering just the item title.
 *
 * The real card is not exercised here on purpose: this page's job is deciding
 * *which* statuses belong in the pane, and the card has its own spec for how one
 * is drawn. Rendering the real thing also drags in NgOptimizedImage, which
 * throws in dev mode on the RSS adapter's `data:` avatar (a pre-existing issue
 * unrelated to what these tests are about).
 */
@Component({ selector: 'app-status-card', template: '{{ status().content }}' })
class StatusCardStub {
  readonly status = input.required<Status>();
  readonly filterContext = input<string>();
}

/** A minimal parseable feed with one dated item, enough for the adapter. */
function feed(title: string, itemTitle: string, publishedAt: string): ParsedFeed {
  return {
    title,
    link: null,
    items: [
      {
        guid: `${title}-${itemTitle}`,
        title: itemTitle,
        link: null,
        publishedAt,
        html: '<p>body</p>',
        isFullContent: true,
        enclosures: [],
        categories: [],
        author: null,
        commentsFeedUrl: null,
        commentCount: null,
      },
    ],
  };
}

describe('RssPage', () => {
  /** Feed URL → what fetching it returns. Unlisted URLs fail, like a dead feed. */
  let feeds: Map<string, ParsedFeed>;

  beforeEach(() => {
    localStorage.clear();
    feeds = new Map();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'rss', component: RssPage }]),
        {
          provide: RssFetch,
          useValue: {
            fetchFeed: vi.fn((url: string) => {
              const parsed = feeds.get(url);
              return parsed ? of(parsed) : throwError(() => new Error('nope'));
            }),
          },
        },
      ],
    });
    // Before any inject(): TestBed refuses an override once instantiated.
    TestBed.overrideComponent(RssPage, {
      remove: { imports: [StatusCard] },
      add: { imports: [StatusCardStub] },
    });
  });

  function setUp(): ComponentFixture<RssPage> {
    const fixture = TestBed.createComponent(RssPage);
    fixture.detectChanges();
    return fixture;
  }

  function textOf(fixture: ComponentFixture<RssPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /** Every rail row's trimmed label, in order. */
  function railRows(fixture: ComponentFixture<RssPage>): string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('.rail-row')].map(
      (el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
  }

  it('invites you to add a feed when there are none', () => {
    expect(textOf(setUp())).toContain('No feeds yet');
  });

  it('lists subscribed feeds with host and item count', () => {
    TestBed.inject(RssSubscriptions).add(
      'https://blog.example.com/feed.xml',
      'Example Blog',
      false,
      12,
    );
    const text = textOf(setUp());
    expect(text).toContain('Example Blog');
    expect(text).toContain('blog.example.com');
    expect(text).toContain('12 items');
  });

  it('marks a disabled feed as off', () => {
    const subs = TestBed.inject(RssSubscriptions);
    subs.add('https://blog.example.com/feed.xml', 'Example Blog');
    subs.setEnabled('https://blog.example.com/feed.xml', false);
    expect(textOf(setUp())).toContain('· off');
  });

  it('groups feeds under their folder, unfiled first', () => {
    const subs = TestBed.inject(RssSubscriptions);
    subs.add('https://a.example.com/feed.xml', 'Loose Feed');
    subs.add('https://b.example.com/feed.xml', 'Tech Feed', false, undefined, 'Tech');
    subs.add('https://c.example.com/feed.xml', 'News Feed', false, undefined, 'News');

    const rows = railRows(setUp());
    expect(rows[0]).toContain('All items');
    // Unfiled group leads, then folders alphabetically (News before Tech).
    expect(rows.slice(1)).toEqual([
      expect.stringContaining('Unsorted'),
      expect.stringContaining('Loose Feed'),
      expect.stringContaining('News'),
      expect.stringContaining('News Feed'),
      expect.stringContaining('Tech'),
      expect.stringContaining('Tech Feed'),
    ]);
  });

  it('shows no folder headers at all when nothing is filed', () => {
    TestBed.inject(RssSubscriptions).add('https://a.example.com/feed.xml', 'Loose Feed');
    const rows = railRows(setUp());
    expect(rows).toEqual([
      expect.stringContaining('All items'),
      expect.stringContaining('Loose Feed'),
    ]);
  });

  it('selecting a feed puts it in the URL and loads it into the pane', async () => {
    const url = 'https://blog.example.com/feed.xml';
    feeds.set(url, feed('Example Blog', 'Hello world', '2026-08-20T10:00:00Z'));
    TestBed.inject(RssSubscriptions).add(url, 'Example Blog');

    const fixture = setUp();
    fixture.componentInstance['selectFeed'](url);
    await fixture.whenStable();
    fixture.detectChanges();

    // Angular leaves `:` literal in a query value and escapes only the slashes.
    expect(TestBed.inject(Router).url).toContain('feed=https:%2F%2Fblog.example.com%2Ffeed.xml');
    expect(textOf(fixture)).toContain('Hello world');
  });

  it('restores the same pane when loaded directly on a ?feed= URL', async () => {
    const url = 'https://blog.example.com/feed.xml';
    feeds.set(url, feed('Example Blog', 'Deep linked', '2026-08-20T10:00:00Z'));
    TestBed.inject(RssSubscriptions).add(url, 'Example Blog');

    await TestBed.inject(Router).navigate(['/rss'], { queryParams: { feed: url } });
    const fixture = setUp();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('Deep linked');
    expect(textOf(fixture)).toContain('Open as profile');
  });

  it('merges every feed in a folder, newest first', async () => {
    const subs = TestBed.inject(RssSubscriptions);
    feeds.set('https://a.example.com/f.xml', feed('A', 'Older item', '2026-08-01T00:00:00Z'));
    feeds.set('https://b.example.com/f.xml', feed('B', 'Newer item', '2026-08-20T00:00:00Z'));
    feeds.set('https://c.example.com/f.xml', feed('C', 'Other folder', '2026-08-21T00:00:00Z'));
    subs.add('https://a.example.com/f.xml', 'A', false, undefined, 'Tech');
    subs.add('https://b.example.com/f.xml', 'B', false, undefined, 'Tech');
    subs.add('https://c.example.com/f.xml', 'C', false, undefined, 'News');

    const fixture = setUp();
    fixture.componentInstance['selectFolder']('Tech');
    await fixture.whenStable();
    fixture.detectChanges();

    const text = textOf(fixture);
    expect(text).toContain('Newer item');
    expect(text).toContain('Older item');
    // The other folder's feed must not leak into this pane.
    expect(text).not.toContain('Other folder');
    expect(text.indexOf('Newer item')).toBeLessThan(text.indexOf('Older item'));
  });

  it('shows the rest of a folder when one feed in it fails', async () => {
    const subs = TestBed.inject(RssSubscriptions);
    feeds.set('https://ok.example.com/f.xml', feed('OK', 'Survived', '2026-08-20T00:00:00Z'));
    subs.add('https://ok.example.com/f.xml', 'OK Feed', false, undefined, 'Tech');
    // Deliberately not in `feeds`, so fetching it throws.
    subs.add('https://dead.example.com/f.xml', 'Dead Feed', false, undefined, 'Tech');

    const fixture = setUp();
    fixture.componentInstance['selectFolder']('Tech');
    await fixture.whenStable();
    fixture.detectChanges();

    const text = textOf(fixture);
    expect(text).toContain('Survived');
    expect(text).toContain("Couldn't load Dead Feed");
  });

  it('opens the add-feed dialog on click, closes it on (closed)', () => {
    const fixture = setUp();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      '.rss-rail-head button',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('app-add-feed-dialog'),
    ).not.toBeNull();

    (fixture.componentInstance as unknown as { closeAddDialog(): void }).closeAddDialog();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-add-feed-dialog')).toBeNull();
  });
});
