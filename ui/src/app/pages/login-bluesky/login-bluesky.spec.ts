import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { Server } from '../../server';
import { LoginBluesky } from './login-bluesky';

const CREATE_SESSION = 'https://bsky.social/xrpc/com.atproto.server.createSession';
const PROFILE_KEY = 'mockingbird_bsky_identity_profile';
const CREDENTIALS_KEY = 'mockingbird_bsky_identity_credentials';
const MODE_KEY = 'mastodon_mock_account_mode';

describe('LoginBluesky', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        Auth,
        Server,
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  /** Drive a successful sign-in, flushing both calls the flow makes. */
  function signIn(handle = 'someone.bsky.social', password = 'app-pass-1234') {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set(handle);
    cmp.appPassword.set(password);
    cmp.submit();

    httpMock.expectOne(CREATE_SESSION).flush({
      did: 'did:plc:abc123',
      handle,
      accessJwt: 'access-jwt-value',
      refreshJwt: 'refresh-jwt-value',
    });
    httpMock
      .expectOne((r) => r.url.includes('app.bsky.actor.getProfile'))
      .flush({ displayName: 'Someone', avatar: 'https://cdn/av.png' });
    return { fixture, cmp };
  }

  it('signs in and lands on Home as a Bluesky-primary account', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    signIn();

    const auth = TestBed.inject(Auth);
    expect(auth.isBlueskyPrimary).toBe(true);
    expect(auth.kind()).toBe('bluesky');
    expect(auth.account()?.acct).toBe('someone.bsky.social');
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('sends the app password to createSession and nowhere else', () => {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set('someone.bsky.social');
    cmp.appPassword.set('app-pass-1234');
    cmp.submit();

    const req = httpMock.expectOne(CREATE_SESSION);
    expect(req.request.body).toEqual({
      identifier: 'someone.bsky.social',
      password: 'app-pass-1234',
    });
  });

  /**
   * The worst bug available on this page. A JWT in an exportable key, or the app
   * password persisted at all, would outlive the browser data it came from.
   */
  it('stores the JWTs in the secret half and the app password nowhere', () => {
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    signIn('someone.bsky.social', 'app-pass-1234');

    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY)!);
    const credentials = JSON.parse(localStorage.getItem(CREDENTIALS_KEY)!);

    // The exportable half names the account and carries no credential.
    expect(profile.handle).toBe('someone.bsky.social');
    expect(profile.did).toBe('did:plc:abc123');
    expect(JSON.stringify(profile)).not.toContain('access-jwt-value');
    expect(JSON.stringify(profile)).not.toContain('refresh-jwt-value');

    // The secret half carries the tokens.
    expect(credentials.accessJwt).toBe('access-jwt-value');
    expect(credentials.refreshJwt).toBe('refresh-jwt-value');

    // The app password is never written anywhere, under any key.
    const everything = Object.keys(localStorage)
      .map((k) => localStorage.getItem(k) ?? '')
      .join('|');
    expect(everything).not.toContain('app-pass-1234');
  });

  /**
   * The identity must land in the *unscoped* keys, not the scoped connector keys.
   * At submit time the active kind is not yet `bluesky`, so a naive write goes to
   * the previous account's namespace — where the next boot never looks.
   */
  it('writes the identity keys, not the scoped connector keys', () => {
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    signIn();

    expect(localStorage.getItem(PROFILE_KEY)).not.toBeNull();
    const connectorKeys = Object.keys(localStorage).filter(
      (k) => k.startsWith('mockingbird_bsky_profile') || k.startsWith('mockingbird_bsky_credentials'),
    );
    expect(connectorKeys).toEqual([]);
  });

  it('does not claim to be signed in when the login fails', () => {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set('someone.bsky.social');
    cmp.appPassword.set('wrong');
    cmp.submit();

    httpMock
      .expectOne(CREATE_SESSION)
      .flush({ error: 'AuthenticationRequired' }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    const auth = TestBed.inject(Auth);
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(localStorage.getItem(PROFILE_KEY)).toBeNull();
    expect(cmp.error()).toContain('rejected');
  });

  /**
   * bsky.social is an entryway and cannot authenticate an account on someone
   * else's PDS. Telling that user "wrong password" sends them to re-check
   * credentials that are correct.
   */
  it('offers the self-hosted hint for a non-bsky.social handle that was rejected', () => {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set('me.example.com');
    cmp.appPassword.set('app-pass');
    cmp.submit();

    httpMock.expectOne(CREATE_SESSION).flush(null, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(cmp.selfHostedHint()).toBe(true);
    expect(fixture.nativeElement.querySelector('.bsky-hint')?.textContent).toContain(
      'host your own PDS',
    );
  });

  /** A custom domain on Bluesky's own PDS is common and works; don't mislead. */
  it('does not offer the self-hosted hint for a bsky.social handle', () => {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set('someone.bsky.social');
    cmp.appPassword.set('wrong');
    cmp.submit();

    httpMock.expectOne(CREATE_SESSION).flush(null, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    expect(cmp.selfHostedHint()).toBe(false);
  });

  it('explains a rate limit rather than blaming the password', () => {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set('someone.bsky.social');
    cmp.appPassword.set('app-pass');
    cmp.submit();

    httpMock
      .expectOne(CREATE_SESSION)
      .flush({ error: 'RateLimitExceeded' }, { status: 429, statusText: 'Too Many Requests' });

    expect(cmp.error()).toContain('rate-limiting');
  });

  it('tolerates a leading @ and surrounding whitespace in the handle', () => {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set('  @someone.bsky.social  ');
    cmp.appPassword.set('app-pass');
    cmp.submit();

    expect(httpMock.expectOne(CREATE_SESSION).request.body.identifier).toBe('someone.bsky.social');
  });

  it('forgets the app password from memory once signed in', () => {
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const { cmp } = signIn();

    expect(cmp.appPassword()).toBe('');
  });

  it('explains a blocked request rather than reporting bad credentials', () => {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set('someone.bsky.social');
    cmp.appPassword.set('app-pass');
    cmp.submit();

    httpMock.expectOne(CREATE_SESSION).error(new ProgressEvent('error'), { status: 0 });

    expect(cmp.error()).toContain('Could not reach Bluesky');
  });

  it('sends an already signed-in visitor to Home', () => {
    TestBed.inject(Auth).setToken('mastodon-token');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(LoginBluesky).detectChanges();

    expect(navigate).toHaveBeenCalledWith('/home', { replaceUrl: true });
  });

  it('requires both fields before it will submit', () => {
    const fixture = TestBed.createComponent(LoginBluesky);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;
    cmp.handle.set('someone.bsky.social');
    cmp.appPassword.set('');
    cmp.submit();

    httpMock.expectNone(CREATE_SESSION);
  });
});
