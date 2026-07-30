import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../../auth';
import { HouseAdStore } from '../../house-ad-store';
import { HOUSE_ADS_SHOWN } from '../../house-ads';
import { Account } from '../../models';
import { Server } from '../../server';
import { RightRail } from './right-rail';

interface RightRailInternals {
  homeHost: () => string | null;
  donateServerUrl: () => string;
  anonymousShareUrl: () => string;
  anonymousShareAbsoluteUrl: () => string;
  shareOpen: () => boolean;
  openShare: () => void;
  closeShare: () => void;
}

function internals(fixture: ComponentFixture<RightRail>): RightRailInternals {
  return fixture.componentInstance as unknown as RightRailInternals;
}

describe('RightRail', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(): ComponentFixture<RightRail> {
    const fixture = TestBed.createComponent(RightRail);
    fixture.detectChanges();
    // Instance info request fires on init; individual tests may flush or ignore it.
    httpMock.match(() => true).forEach((req) => req.flush({}, { status: 404, statusText: 'NF' }));
    return fixture;
  }

  it("infers the donate host from the account's acct domain", () => {
    TestBed.inject(Auth).account.set({ id: '1', acct: 'matt@elekk.xyz' } as Account);
    const fixture = setUp();

    expect(internals(fixture).homeHost()).toBe('elekk.xyz');
    expect(internals(fixture).donateServerUrl()).toBe('https://elekk.xyz/about');
    expect(internals(fixture).anonymousShareUrl()).toBe('/anonymous?elekk.xyz');
  });

  it('exposes an absolute (origin-qualified) share URL for copying, not just a route', () => {
    TestBed.inject(Auth).account.set({ id: '1', acct: 'matt@elekk.xyz' } as Account);
    const fixture = setUp();

    const absolute = internals(fixture).anonymousShareAbsoluteUrl();
    // A real link someone can paste elsewhere: origin + the anonymous route.
    expect(absolute).toBe(`${location.origin}/anonymous?elekk.xyz`);
    expect(absolute.startsWith('http')).toBe(true);
  });

  it('"Share this server" opens a dialog instead of navigating', () => {
    TestBed.inject(Auth).account.set({ id: '1', acct: 'matt@elekk.xyz' } as Account);
    const fixture = setUp();

    expect(internals(fixture).shareOpen()).toBe(false);
    internals(fixture).openShare();
    expect(internals(fixture).shareOpen()).toBe(true);
    internals(fixture).closeShare();
    expect(internals(fixture).shareOpen()).toBe(false);
  });

  it('falls back to the connected instance for local accts', () => {
    TestBed.inject(Server).setBaseUrl('https://mastodon.social');
    TestBed.inject(Auth).account.set({ id: '1', acct: 'matt' } as Account);
    const fixture = setUp();

    expect(internals(fixture).homeHost()).toBe('mastodon.social');
    expect(internals(fixture).donateServerUrl()).toBe('https://mastodon.social/about');
  });

  it('renders the donate links and a rotating pair of house ads', () => {
    TestBed.inject(Auth).account.set({ id: '1', acct: 'matt@elekk.xyz' } as Account);
    const fixture = setUp();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // Donate links are computed from the account/instance, so assert them.
    const hrefs = [...el.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('https://elekk.xyz/about');
    expect(hrefs).toContain('https://joinmastodon.org/sponsors');
    // "Share this server" is a button that opens a copy dialog, NOT an <a> that
    // navigates to the anonymous route — so it must not appear among the hrefs.
    expect(hrefs).not.toContain('/anonymous?elekk.xyz');
    const shareBtn = el.querySelector<HTMLButtonElement>('button.share-server');
    expect(shareBtn?.textContent?.trim()).toBe('Share this server');

    // House-ad *content* is editorial and changes freely — assert structure, not
    // specific URLs: HOUSE_ADS_SHOWN cards, each linking out over https.
    const cards = [...el.querySelectorAll('.spotlight-card')];
    expect(cards).toHaveLength(HOUSE_ADS_SHOWN);
    for (const card of cards) {
      const link = card.querySelector<HTMLAnchorElement>('a[href^="https://"]');
      expect(link).not.toBeNull();
    }
  });

  it('counts a click on an ad locally, without leaving the rail', () => {
    const fixture = setUp();
    fixture.detectChanges();
    const store = TestBed.inject(HouseAdStore);
    const clicked = store.visible()[0];

    const card = (fixture.nativeElement as HTMLElement).querySelector('.spotlight-card')!;
    card.querySelector<HTMLAnchorElement>('a.spotlight-body')!.dispatchEvent(
      // The anchor is a real outbound link; cancel the navigation jsdom would
      // complain about and keep the click itself.
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(store.rows().find((row) => row.ad.id === clicked.id)!.clicks?.count).toBe(1);
  });

  it('dismisses one ad without opening it, and refills the slot', () => {
    const fixture = setUp();
    fixture.detectChanges();
    const store = TestBed.inject(HouseAdStore);
    const dismissed = store.visible()[0];
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('.spotlight-card .spotlight-dismiss')!.click();
    fixture.detectChanges();

    expect(store.visible().map((ad) => ad.id)).not.toContain(dismissed.id);
    // A dismiss is not a click on the advertiser.
    expect(store.totalClicks()).toBe(0);
    expect(el.querySelectorAll('.spotlight-card')).toHaveLength(HOUSE_ADS_SHOWN);
  });

  it('renders no ad cards at all once ads are switched off', () => {
    TestBed.inject(HouseAdStore).setEnabled(false);
    const fixture = setUp();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('.spotlight-card')).toHaveLength(0);
    // The donate block is not an ad and stays regardless.
    expect(
      [...el.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => a.getAttribute('href')),
    ).toContain('https://joinmastodon.org/sponsors');
  });

  it('house-ad markup carries no ad-* classes (ad blockers hide those cosmetically)', () => {
    const fixture = setUp();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('.spotlight-card').length).toBeGreaterThan(0);
    const adClassed = [...el.querySelectorAll('*')].filter((node) =>
      [...node.classList].some((cls) => /^ad[s]?([-_]|$)/i.test(cls)),
    );
    expect(adClassed).toHaveLength(0);
  });

  it('no longer hosts the trends widget (moved to the left rail)', () => {
    const fixture = setUp();
    expect((fixture.nativeElement as HTMLElement).querySelector('.trend')).toBeNull();
  });
});
