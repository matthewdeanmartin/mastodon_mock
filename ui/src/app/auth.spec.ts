import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from './auth';
import { Server } from './server';

/**
 * Auth session/server linkage. The core account-switching bug was that a token's instance
 * wasn't remembered, so switching accounts left the Server pointed at the previous host and
 * verify_credentials 401'd. These tests pin the capture-on-login / restore-on-switch contract.
 */
describe('Auth + Server linkage', () => {
  let auth: Auth;
  let server: Server;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [Auth, Server] });
    server = TestBed.inject(Server);
    auth = TestBed.inject(Auth);
  });

  it('setToken captures the currently-selected instance into the session', () => {
    server.setBaseUrl('https://mastodon.art');
    auth.setToken('art-token');

    const session = auth.sessions().find((s) => s.token === 'art-token');
    expect(session?.server).toBe('https://mastodon.art');
  });

  it('switchTo restores the session’s instance before activating its token', () => {
    server.setBaseUrl('https://mastodon.art');
    auth.setToken('art-token');

    server.setBaseUrl('https://mastodon.social');
    auth.setToken('social-token');
    expect(server.baseUrl()).toBe('https://mastodon.social');

    // Switching back to the art account must move the server back to mastodon.art.
    expect(auth.switchTo('art-token')).toBe(true);
    expect(server.baseUrl()).toBe('https://mastodon.art');
    expect(auth.token()).toBe('art-token');
  });

  it('backfills server for a legacy session that predates the field', () => {
    // Simulate a session saved before `server` existed (no server key).
    localStorage.setItem(
      'mastodon_mock_sessions',
      JSON.stringify([{ token: 'legacy', account: null }]),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [Auth, Server] });
    server = TestBed.inject(Server);
    auth = TestBed.inject(Auth);

    server.setBaseUrl('https://mastodon.social');
    auth.setToken('legacy');

    const session = auth.sessions().find((s) => s.token === 'legacy');
    expect(session?.server).toBe('https://mastodon.social');
  });

  it('enters Anonymous without removing authenticated sessions', () => {
    server.setBaseUrl('https://mastodon.art');
    auth.setToken('art-token');

    auth.enterAnonymous('https://hachyderm.io');

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.isAnonymous).toBe(true);
    expect(auth.token()).toBeNull();
    expect(auth.account()?.display_name).toBe('Anonymous');
    expect(server.baseUrl()).toBe('https://hachyderm.io');
    expect(auth.sessions().map((s) => s.token)).toEqual(['art-token']);
  });

  it('offers login prompts only when Anonymous is the only local account', () => {
    const auth = TestBed.inject(Auth);
    auth.enterAnonymous();
    expect(auth.shouldOfferLogin).toBe(true);

    auth.setToken('saved-token');
    auth.enterAnonymous();
    expect(auth.shouldOfferLogin).toBe(false);
  });

  it('exits Anonymous for login without activating or deleting a saved session', () => {
    server.setBaseUrl('https://mastodon.art');
    auth.setToken('art-token');
    auth.enterAnonymous('https://mastodon.social');

    auth.exitAnonymous();

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.isAnonymous).toBe(false);
    expect(auth.sessions().map((session) => session.token)).toEqual(['art-token']);
  });

  it('always offers Anonymous in the switcher and restores a saved login', () => {
    server.setBaseUrl('https://mastodon.art');
    auth.setToken('art-token');

    expect(auth.otherSessions().some((choice) => choice.kind === 'anonymous')).toBe(true);

    auth.enterAnonymous();
    const saved = auth.otherSessions().find((choice) => choice.kind === 'mastodon')!;
    expect(auth.switchAccount(saved)).toBe(true);

    expect(auth.isAnonymous).toBe(false);
    expect(auth.token()).toBe('art-token');
    expect(server.baseUrl()).toBe('https://mastodon.art');
  });
});
