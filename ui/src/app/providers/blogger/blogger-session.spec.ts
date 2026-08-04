import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOGGER_CLIENT_ID, BloggerSession } from './blogger-session';

describe('BloggerSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  function session(clientId = 'test-client.apps.googleusercontent.com'): BloggerSession {
    TestBed.configureTestingModule({
      providers: [{ provide: BLOGGER_CLIENT_ID, useValue: clientId }],
    });
    return TestBed.inject(BloggerSession);
  }

  it('reports itself unconfigured when the build has no client id', () => {
    const blogger = session('');
    expect(blogger.configured).toBe(false);
  });

  it('refuses to start a flow it cannot finish', async () => {
    await expect(session('').connect()).rejects.toThrow(/not been configured/);
  });

  it('sends a PKCE authorization request with state and the blogger scope', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...location, assign, search: '' });

    await session().connect();

    const url = new URL(assign.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/blogger');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    // Forces the Google account chooser, so a prior grant is never reused silently.
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // The secret must never appear in a browser flow.
    expect(url.searchParams.get('client_secret')).toBeNull();
  });

  it('rejects a callback whose state does not match the one we issued', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...location, assign, search: '' });
    const blogger = session();
    await blogger.connect();

    await expect(
      blogger.finishAuthorization(new URLSearchParams({ code: 'c', state: 'forged' })),
    ).rejects.toThrow(/invalid or expired/);
    expect(blogger.connected()).toBe(false);
  });

  it('exchanges the code without a client secret and stores the token', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...location, assign, search: '' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const blogger = session();
    await blogger.connect();
    const state = new URL(assign.mock.calls[0][0]).searchParams.get('state')!;
    await blogger.finishAuthorization(new URLSearchParams({ code: 'the-code', state }));

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.has('client_secret')).toBe(false);
    expect(blogger.accessToken()).toBe('tok');
    // Connected, but not yet publishable: no blog has been chosen.
    expect(blogger.connected()).toBe(true);
    expect(blogger.ready()).toBe(false);
  });

  it('is only ready to publish once a blog is chosen', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...location, assign, search: '' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
        ),
    );
    const blogger = session();
    await blogger.connect();
    const state = new URL(assign.mock.calls[0][0]).searchParams.get('state')!;
    await blogger.finishAuthorization(new URLSearchParams({ code: 'c', state }));

    blogger.chooseBlog('123', 'My Blog');
    expect(blogger.ready()).toBe(true);
    expect(blogger.blogId()).toBe('123');
    expect(blogger.blogName()).toBe('My Blog');
  });

  it('explains a redirect_uri_mismatch instead of echoing the raw code', async () => {
    await expect(
      session().finishAuthorization(new URLSearchParams({ error: 'redirect_uri_mismatch' })),
    ).rejects.toThrow(/authorized redirect URIs/);
  });

  it('treats an expired token as no token, and disconnects', () => {
    const blogger = session();
    // Write a token that expired an hour ago, as a stale tab would have.
    sessionStorage.setItem(
      'mockingbird_blogger_token',
      JSON.stringify({ accessToken: 'old', expiresAt: Date.now() - 3_600_000, blogId: '1' }),
    );
    TestBed.resetTestingModule();
    const stale = session();
    expect(stale.accessToken()).toBeNull();
    void blogger;
  });
});
