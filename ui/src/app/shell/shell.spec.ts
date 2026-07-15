import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../auth';
import { Server } from '../server';
import { serverInterceptor } from '../server.interceptor';
import { Shell } from './shell';

describe('Shell account switching', () => {
  let httpMock: HttpTestingController;
  let auth: Auth;
  let server: Server;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        // Register the real serverInterceptor so requests are prefixed with the active
        // instance — the whole point of this bug.
        provideHttpClient(withInterceptors([serverInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
    server = TestBed.inject(Server);

    // Two saved sessions on different instances; "art" is active.
    server.setBaseUrl('https://mastodon.art');
    auth.setToken('art-token');
    server.setBaseUrl('https://mastodon.social');
    auth.setToken('social-token');
    auth.switchTo('art-token');
  });

  afterEach(() => httpMock.verify());

  function createShell() {
    const fixture = TestBed.createComponent(Shell);
    // ngOnInit verifies the active account; satisfy that request first.
    fixture.detectChanges();
    httpMock
      .expectOne('https://mastodon.art/api/v1/accounts/verify_credentials')
      .flush({ id: '1', username: 'arty' } as never);
    drainRailRequests();
    return fixture;
  }

  /** The rendered rails fetch trends/instance metadata; account for those requests. */
  function drainRailRequests() {
    httpMock.match((r) => r.url.includes('/api/v1/trends/') || r.url.includes('/api/v2/instance'));
  }

  // Rendering the full Shell (rails and all) can exceed the default 5s timeout
  // on a loaded machine; the work is synchronous, just heavy.
  it('switching restores the target instance and verifies against it', { timeout: 20_000 }, () => {
    const fixture = createShell();
    const social = auth.sessions().find((s) => s.token === 'social-token')!;

    fixture.componentInstance.switchTo(social);

    // Must hit mastodon.social — not the previously-active mastodon.art.
    const req = httpMock.expectOne('https://mastodon.social/api/v1/accounts/verify_credentials');
    req.flush({ id: '2', username: 'socialite' } as never);

    expect(auth.token()).toBe('social-token');
    expect(server.baseUrl()).toBe('https://mastodon.social');
  });

  it(
    'a failed switch reverts to the previous account and toasts (keeps the session)',
    { timeout: 20_000 },
    () => {
      const fixture = createShell();
      const cmp = fixture.componentInstance as any;
      const social = auth.sessions().find((s) => s.token === 'social-token')!;

      cmp.switchTo(social);
      httpMock
        .expectOne('https://mastodon.social/api/v1/accounts/verify_credentials')
        .flush('nope', { status: 401, statusText: 'Unauthorized' });

      // Reverted, not logged out: still on the art account and server.
      expect(auth.token()).toBe('art-token');
      expect(server.baseUrl()).toBe('https://mastodon.art');
      // The rejected session is NOT deleted.
      expect(auth.sessions().some((s) => s.token === 'social-token')).toBe(true);
      // And the user is told, non-blockingly.
      expect(cmp.toast()).toContain("Couldn't switch");
    },
  );
});
