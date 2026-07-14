import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientPrefs } from '../client-prefs';
import { CommandBar } from './command-bar';

describe('CommandBar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function setUp() {
    const fixture = TestBed.createComponent(CommandBar);
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
