import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { Login } from './login';

const OAUTH_APP_KEY = 'mastodon_mock_oauth_app';

function buildRoute(queryParams: Record<string, string>): Partial<ActivatedRoute> {
  return {
    snapshot: { queryParamMap: convertToParamMap(queryParams) } as ActivatedRoute['snapshot'],
  };
}

describe('Login', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function setUp(queryParams: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: buildRoute(queryParams) },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Login);
    return fixture;
  }

  it('on init with no ?code, lists dev users and does not touch oauth/token', () => {
    const fixture = setUp();
    fixture.detectChanges();

    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);
    httpMock.expectNone('/oauth/token');
  });

  it('startOAuth registers an app, stores it, and redirects to /oauth/authorize', () => {
    const fixture = setUp();
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);

    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        set href(v: string) {
          hrefSetter(v);
        },
      },
      writable: true,
    });

    fixture.componentInstance.startOAuth();

    const req = httpMock.expectOne('/api/v1/apps');
    expect(req.request.method).toBe('POST');
    req.flush({
      id: '1',
      name: 'mastodon_mock UI',
      website: null,
      redirect_uri: 'http://localhost/login',
      redirect_uris: ['http://localhost/login'],
      client_id: 'client-abc',
      client_secret: 'secret-xyz',
      vapid_key: 'vapid',
      scopes: ['read', 'write'],
    });

    expect(hrefSetter).toHaveBeenCalledTimes(1);
    const redirectedTo = hrefSetter.mock.calls[0][0] as string;
    expect(redirectedTo).toContain('/oauth/authorize?');
    expect(redirectedTo).toContain('client_id=client-abc');
    expect(redirectedTo).toContain('response_type=code');

    const stored = JSON.parse(sessionStorage.getItem(OAUTH_APP_KEY)!);
    expect(stored).toEqual({
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      redirectUri: stored.redirectUri,
    });
  });

  it('startOAuth surfaces an error if app registration fails', () => {
    const fixture = setUp();
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);

    fixture.componentInstance.startOAuth();
    httpMock.expectOne('/api/v1/apps').flush('boom', { status: 500, statusText: 'Server Error' });

    expect((fixture.componentInstance as any).oauthError()).toBe('Could not register the app.');
    expect((fixture.componentInstance as any).oauthWorking()).toBe(false);
  });

  it('on init with ?code but no stored app, does not attempt exchange', () => {
    const fixture = setUp({ code: 'mockcode_alan' });
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);
    httpMock.expectNone('/oauth/token');
  });

  it('on init with ?code and a stored app, exchanges the code and signs in', () => {
    sessionStorage.setItem(
      OAUTH_APP_KEY,
      JSON.stringify({
        clientId: 'client-abc',
        clientSecret: 'secret-xyz',
        redirectUri: 'http://localhost/_ui/login',
      }),
    );
    const fixture = setUp({ code: 'mockcode_alan' });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const navigateByUrlSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture.detectChanges();
    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);

    const tokenReq = httpMock.expectOne('/oauth/token');
    expect(tokenReq.request.method).toBe('POST');
    const body = tokenReq.request.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('mockcode_alan');
    expect(body.get('client_id')).toBe('client-abc');
    tokenReq.flush({
      access_token: 'fresh-token',
      token_type: 'Bearer',
      scope: 'read write',
      created_at: 0,
    });

    // submit() fires verify_credentials with the freshly exchanged token.
    const verifyReq = httpMock.expectOne('/api/v1/accounts/verify_credentials');
    verifyReq.flush({ id: '1', username: 'alan', display_name: 'Alan Turing' } as never);

    expect(sessionStorage.getItem(OAUTH_APP_KEY)).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith([], { queryParams: {} });
    expect(navigateByUrlSpy).toHaveBeenCalledWith('/home');
    expect(TestBed.inject(Auth).token()).toBe('fresh-token');
  });

  it('on init with ?code, surfaces an error if the exchange fails', () => {
    sessionStorage.setItem(
      OAUTH_APP_KEY,
      JSON.stringify({
        clientId: 'client-abc',
        clientSecret: 'secret-xyz',
        redirectUri: 'http://localhost/_ui/login',
      }),
    );
    const fixture = setUp({ code: 'bad-code' });
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);

    const tokenReq = httpMock.expectOne('/oauth/token');
    tokenReq.flush('invalid_grant', { status: 400, statusText: 'Bad Request' });

    expect((fixture.componentInstance as any).oauthError()).toBe('Code exchange failed.');
    expect((fixture.componentInstance as any).oauthWorking()).toBe(false);
  });

  it('submit() rejects an empty token without calling the API', () => {
    const fixture = setUp();
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);

    fixture.componentInstance.submit();
    httpMock.expectNone('/api/v1/accounts/verify_credentials');
  });

  it('continues anonymously without verifying credentials', () => {
    const fixture = setUp();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);

    fixture.componentInstance.continueAnonymously();

    const auth = TestBed.inject(Auth);
    expect(auth.isAnonymous).toBe(true);
    expect(auth.token()).toBeNull();
    expect(auth.sessions()).toEqual([]);
    expect(navigateSpy).toHaveBeenCalledWith('/home');
    httpMock.expectNone('/api/v1/accounts/verify_credentials');
  });

  it('loginAs() mints a fresh token via _mock/login and signs in', () => {
    const fixture = setUp();
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/_mock/dev_users').flush([]);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture.componentInstance.loginAs({
      id: '1',
      username: 'alan',
      display_name: 'Alan Turing',
      role: 'user',
      access_token: 'stale_token',
    });

    const loginReq = httpMock.expectOne('/api/v1/_mock/login');
    expect(loginReq.request.method).toBe('POST');
    expect(loginReq.request.body).toEqual({ username: 'alan' });
    loginReq.flush({
      access_token: 'fresh_token',
      token_type: 'Bearer',
      scope: 'read write',
      created_at: 0,
    });

    const verifyReq = httpMock.expectOne('/api/v1/accounts/verify_credentials');
    verifyReq.flush({ id: '1', username: 'alan', display_name: 'Alan Turing' } as never);

    expect(TestBed.inject(Auth).token()).toBe('fresh_token');
  });
});
