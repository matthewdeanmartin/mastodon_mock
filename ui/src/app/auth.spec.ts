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
});
