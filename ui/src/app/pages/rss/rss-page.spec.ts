import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RssFetch } from '../../providers/rss/rss-fetch';
import { RssSubscriptions } from '../../providers/rss/rss-subscriptions';
import { RssPage } from './rss-page';

describe('RssPage', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: RssFetch, useValue: { fetchFeed: vi.fn() } }],
    });
  });

  function setUp(): ComponentFixture<RssPage> {
    const fixture = TestBed.createComponent(RssPage);
    fixture.detectChanges();
    return fixture;
  }

  it('invites you to add a feed when there are none', () => {
    const fixture = setUp();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No feeds yet');
  });

  it('lists subscribed feeds with host and item count', () => {
    TestBed.inject(RssSubscriptions).add(
      'https://blog.example.com/feed.xml',
      'Example Blog',
      false,
      12,
    );
    const fixture = setUp();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Example Blog');
    expect(text).toContain('blog.example.com');
    expect(text).toContain('12 items');
  });

  it('links a feed row to its feed profile', () => {
    TestBed.inject(RssSubscriptions).add('https://blog.example.com/feed.xml', 'Example Blog');
    const fixture = setUp();

    const href = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLAnchorElement>('a.feed-row-link')
      ?.getAttribute('href');
    expect(href).toBe('/accounts/rss:https:%2F%2Fblog.example.com%2Ffeed.xml');
  });

  it('marks a disabled feed as off', () => {
    const subs = TestBed.inject(RssSubscriptions);
    subs.add('https://blog.example.com/feed.xml', 'Example Blog');
    subs.setEnabled('https://blog.example.com/feed.xml', false);
    const fixture = setUp();

    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain('· off');
  });

  it('opens the add-feed dialog on click, closes it on (closed)', () => {
    const fixture = setUp();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
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
