import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RssFetch } from '../../../providers/rss/rss-fetch';
import { RssSubscriptions } from '../../../providers/rss/rss-subscriptions';
import { SettingsRss } from './settings-rss';

/** Expose the protected signal — ngModel writes are async in specs. */
interface RssInternals {
  feedUrl: WritableSignal<string>;
}

describe('SettingsRss', () => {
  let fetchFeed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchFeed = vi.fn();
    TestBed.configureTestingModule({
      // The page links to the CORS proxy settings, so it needs a router.
      providers: [provideRouter([]), { provide: RssFetch, useValue: { fetchFeed } }],
    });
  });

  function setUp(): ComponentFixture<SettingsRss> {
    const fixture = TestBed.createComponent(SettingsRss);
    fixture.detectChanges();
    return fixture;
  }

  function typeUrl(fixture: ComponentFixture<SettingsRss>, url: string): void {
    (fixture.componentInstance as unknown as RssInternals).feedUrl.set(url);
    fixture.detectChanges();
  }

  function submit(fixture: ComponentFixture<SettingsRss>): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('validates a feed by fetching it and stores it with the discovered title', () => {
    fetchFeed.mockReturnValue(
      of({ title: 'My Blog', link: null, items: [{ guid: 'a' }, { guid: 'b' }] }),
    );
    const fixture = setUp();

    typeUrl(fixture, 'https://blog.example.com/feed.xml');
    submit(fixture);

    const subs = TestBed.inject(RssSubscriptions);
    // itemCount is banked at add time so the Feeds page can show "· 2 items"
    // without re-fetching every subscription to render one hub page.
    expect(subs.feeds()).toEqual([
      {
        url: 'https://blog.example.com/feed.xml',
        title: 'My Blog',
        enabled: true,
        itemCount: 2,
      },
    ]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('My Blog');
  });

  it('surfaces fetch errors (CORS and friends) without storing the feed', () => {
    fetchFeed.mockReturnValue(throwError(() => new Error("Couldn't reach this feed")));
    const fixture = setUp();

    typeUrl(fixture, 'https://nocors.example.com/feed');
    submit(fixture);

    expect(TestBed.inject(RssSubscriptions).feeds()).toEqual([]);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.feed-error')?.textContent,
    ).toContain("Couldn't reach this feed");
  });

  it('rejects non-http URLs and duplicates without fetching', () => {
    const fixture = setUp();
    typeUrl(fixture, 'not-a-url');
    submit(fixture);
    expect(fetchFeed).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('.feed-error')).toBeTruthy();

    TestBed.inject(RssSubscriptions).add('https://a.example/feed', 'A');
    typeUrl(fixture, 'https://a.example/feed');
    submit(fixture);
    expect(fetchFeed).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('already subscribed');
  });

  it('toggles and removes stored feeds', () => {
    const subs = TestBed.inject(RssSubscriptions);
    subs.add('https://a.example/feed', 'Feed A');
    const fixture = setUp();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLInputElement>('.feed-row input[type="checkbox"]')!.click();
    fixture.detectChanges();
    expect(subs.feeds()[0].enabled).toBe(false);

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Remove'))!.click();
    fixture.detectChanges();
    expect(subs.feeds()).toEqual([]);
    expect(el.textContent).toContain('No feeds yet');
  });
});
