import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../../auth';
import { Account } from '../../models';
import { Server } from '../../server';
import { RightRail } from './right-rail';

interface RightRailInternals {
  homeHost: () => string | null;
  donateServerUrl: () => string;
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
  });

  it('falls back to the connected instance for local accts', () => {
    TestBed.inject(Server).setBaseUrl('https://mastodon.social');
    TestBed.inject(Auth).account.set({ id: '1', acct: 'matt' } as Account);
    const fixture = setUp();

    expect(internals(fixture).homeHost()).toBe('mastodon.social');
    expect(internals(fixture).donateServerUrl()).toBe('https://mastodon.social/about');
  });

  it('renders the donate links and the MIMB house ad', () => {
    TestBed.inject(Auth).account.set({ id: '1', acct: 'matt@elekk.xyz' } as Account);
    const fixture = setUp();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const hrefs = [...el.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('https://elekk.xyz/about');
    expect(hrefs).toContain('https://joinmastodon.org/sponsors');
    expect(hrefs).toContain('https://github.com/matthewdeanmartin/mastodon_is_my_blog/');
    expect(el.querySelector('.ad-card')?.textContent).toContain('blog interface');
  });

  it('no longer hosts the trends widget (moved to the left rail)', () => {
    const fixture = setUp();
    expect((fixture.nativeElement as HTMLElement).querySelector('.trend')).toBeNull();
  });
});
