import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RssFetch } from '../../../providers/rss/rss-fetch';
import { RssSubscriptions } from '../../../providers/rss/rss-subscriptions';
import { SettingsConnections } from './settings-connections';

/** Expose the protected url signal — ngModel writes are async in specs. */
interface ConnectionsInternals {
  feedUrl: WritableSignal<string>;
}

describe('SettingsConnections', () => {
  let fetchFeed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchFeed = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: RssFetch, useValue: { fetchFeed } }],
    });
  });

  function setUp(): ComponentFixture<SettingsConnections> {
    const fixture = TestBed.createComponent(SettingsConnections);
    fixture.detectChanges();
    return fixture;
  }

  function typeUrl(fixture: ComponentFixture<SettingsConnections>, url: string): void {
    (fixture.componentInstance as unknown as ConnectionsInternals).feedUrl.set(url);
    fixture.detectChanges();
  }

  function submit(fixture: ComponentFixture<SettingsConnections>): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('validates a feed by fetching it and stores it with the discovered title', () => {
    fetchFeed.mockReturnValue(of({ title: 'My Blog', link: null, items: [] }));
    const fixture = setUp();

    typeUrl(fixture, 'https://blog.example.com/feed.xml');
    submit(fixture);

    const subs = TestBed.inject(RssSubscriptions);
    expect(subs.feeds()).toEqual([
      { url: 'https://blog.example.com/feed.xml', title: 'My Blog', enabled: true },
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
