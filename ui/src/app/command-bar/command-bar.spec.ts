import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientPrefs } from '../client-prefs';
import { RssSubscriptions } from '../providers/rss/rss-subscriptions';
import { CommandBar } from './command-bar';

describe('CommandBar', () => {
  beforeEach(() => {
    localStorage.clear();
    // The provider registry (filter chips) reaches HttpClient via RssFetch.
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function setUp(providerChips = false) {
    const fixture = TestBed.createComponent(CommandBar);
    fixture.componentRef.setInput('providerChips', providerChips);
    fixture.detectChanges();
    return fixture;
  }

  it('toggles feed reader mode via ClientPrefs (stamped on <html>)', () => {
    const fixture = setUp();
    const prefs = TestBed.inject(ClientPrefs);
    const readerBtn = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Reader'),
    )!;

    readerBtn.click();
    fixture.detectChanges();

    expect(prefs.feedReader()).toBe(true);
    expect(document.documentElement.getAttribute('data-feed-reader')).toBe('on');
  });

  it('toggles images off and shows A−/A+ only in reader mode', () => {
    const fixture = setUp();
    const prefs = TestBed.inject(ClientPrefs);
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).not.toContain('A+');
    const imagesBtn = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Images'),
    )!;
    imagesBtn.click();
    fixture.detectChanges();
    expect(prefs.showImages()).toBe(false);
    expect(document.documentElement.getAttribute('data-images')).toBe('off');

    prefs.setFeedReader(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('A+');
  });

  it('shows provider filter chips only on provider pages with a linked provider', () => {
    // No chips without the input, even with feeds configured.
    TestBed.inject(RssSubscriptions).add('https://a.example/feed', 'A');
    let el = setUp(false).nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Fedi');

    // Chips with the input and a linked provider.
    el = setUp(true).nativeElement as HTMLElement;
    expect(el.textContent).toContain('🦣 Fedi');
    expect(el.textContent).toContain('📡 RSS');
  });

  it('hides the chips when no provider is linked', () => {
    const el = setUp(true).nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Fedi');
    expect(el.textContent).not.toContain('RSS');
  });

  it('chips toggle provider visibility in ClientPrefs', () => {
    TestBed.inject(RssSubscriptions).add('https://a.example/feed', 'A');
    const fixture = setUp(true);
    const prefs = TestBed.inject(ClientPrefs);
    const rssChip = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.includes('RSS'),
    )!;
    const changed = vi.fn();
    fixture.componentInstance.providerVisibilityChanged.subscribe(changed);

    expect(prefs.isProviderVisible('rss')).toBe(true);
    rssChip.click();
    fixture.detectChanges();
    expect(prefs.isProviderVisible('rss')).toBe(false);
    rssChip.click();
    expect(prefs.isProviderVisible('rss')).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('emits toggleLive without owning the live state', () => {
    const fixture = setUp();
    const spy = vi.fn();
    fixture.componentInstance.toggleLive.subscribe(spy);

    const liveBtn = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Go live'),
    )!;
    liveBtn.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
