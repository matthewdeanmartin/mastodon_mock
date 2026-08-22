import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableProxyFlags } from '../../../testing/enable-proxy-flags';
import { FeatureFlags } from '../../../feature-flags';
import { SupporterStatus } from '../../../providers/account/supporter-status';
import { CorsProxySettings } from '../../../providers/cors-proxy/cors-proxy-settings';
import { RssFetch } from '../../../providers/rss/rss-fetch';
import { RssSubscriptions } from '../../../providers/rss/rss-subscriptions';
import { AddFeedDialog } from './add-feed-dialog';

interface DialogInternals {
  feedUrl: WritableSignal<string>;
}

function feed(title: string, itemCount = 3) {
  return {
    title,
    link: null,
    items: Array.from({ length: itemCount }, (_, i) => ({
      guid: `${title}-${i}`,
      title: `${title} ${i}`,
      link: null,
      publishedAt: null,
      html: '<p>x</p>',
      isFullContent: true,
      enclosures: [],
      categories: [],
      author: null,
      commentsFeedUrl: null,
      commentCount: null,
    })),
  };
}

describe('AddFeedDialog', () => {
  let fetchFeed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchFeed = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: RssFetch, useValue: { fetchFeed } }],
    });
  });

  function setUp(): ComponentFixture<AddFeedDialog> {
    const fixture = TestBed.createComponent(AddFeedDialog);
    fixture.detectChanges();
    return fixture;
  }

  function typeUrl(fixture: ComponentFixture<AddFeedDialog>, url: string): void {
    (fixture.componentInstance as unknown as DialogInternals).feedUrl.set(url);
    fixture.detectChanges();
  }

  function submit(fixture: ComponentFixture<AddFeedDialog>): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('subscribes and emits (added) + (closed) on success', () => {
    fetchFeed.mockReturnValue(of(feed('A News', 5)));
    const fixture = setUp();
    const added = vi.fn();
    const closed = vi.fn();
    fixture.componentInstance.added.subscribe(added);
    fixture.componentInstance.closed.subscribe(closed);

    typeUrl(fixture, 'https://a.example/feed');
    submit(fixture);

    expect(TestBed.inject(RssSubscriptions).has('https://a.example/feed')).toBe(true);
    expect(added).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('shows an error and does not emit on a failed fetch', () => {
    fetchFeed.mockReturnValue(throwError(() => new Error('CORS blocked')));
    const fixture = setUp();
    const added = vi.fn();
    fixture.componentInstance.added.subscribe(added);

    typeUrl(fixture, 'https://a.example/feed');
    submit(fixture);

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CORS blocked');
    expect(added).not.toHaveBeenCalled();
    expect(TestBed.inject(RssSubscriptions).has('https://a.example/feed')).toBe(false);
  });

  it('rejects a URL without http(s)', () => {
    const fixture = setUp();
    typeUrl(fixture, 'not-a-url');
    submit(fixture);

    expect(fetchFeed).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('http://');
  });

  it('a Plus subscriber with no proxy configured is adopted onto one and retried silently', () => {
    enableProxyFlags();
    TestBed.inject(FeatureFlags).setState('proxy-mawkingbird-plus', 'production');
    TestBed.inject(SupporterStatus).isSupporter.set(true);
    expect(TestBed.inject(CorsProxySettings).currentId()).toBeNull();

    // First (direct) call fails as CORS typically does; second (proxied) succeeds.
    fetchFeed.mockReturnValueOnce(throwError(() => new Error('CORS blocked')));
    fetchFeed.mockReturnValueOnce(of(feed('Vox', 20)));

    const fixture = setUp();
    const added = vi.fn();
    fixture.componentInstance.added.subscribe(added);

    typeUrl(fixture, 'https://www.vox.com/rss/index.xml');
    submit(fixture);

    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(CorsProxySettings).currentId()).toBe('mawkingbird');
    expect(TestBed.inject(RssSubscriptions).has('https://www.vox.com/rss/index.xml')).toBe(true);
    expect(added).toHaveBeenCalledTimes(1);
    // No manual "try again" prompt shown — the retry already happened.
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Try again via');
  });

  it('emits (closed) on Cancel without subscribing', () => {
    const fixture = setUp();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    const cancel = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement;
    cancel.click();

    expect(closed).toHaveBeenCalledTimes(1);
  });
});
