import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountPageUrl,
  displayName,
  WORKOS_CLIENT_ID,
  WORKOS_CREATE_CLIENT,
  WorkosSession,
} from './workos-session';

/**
 * The fake `createClient` for the test currently running.
 *
 * Provided through {@link WORKOS_CREATE_CLIENT} rather than installed with
 * `vi.mock`. The builder runs with `isolate: false`, so spec files share one
 * module registry and a module-level mock only applies if the mocking file
 * wins the load race — which made this file fail on about half of full-suite
 * runs while passing alone. An injection token is unambiguous.
 */
let createClientSpy = vi.fn();
const createClientMock = () => createClientSpy;

/** A signed-in WorkOS user, with only the fields this app reads. */
function userFixture(overrides: Record<string, unknown> = {}) {
  return {
    object: 'user',
    id: 'user_01',
    email: 'reader@example.com',
    emailVerified: true,
    profilePictureUrl: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    lastSignInAt: null,
    externalId: undefined,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** A stub AuthKit client. `getUser` returns null unless a user is supplied. */
function clientStub(user: unknown = null) {
  return {
    getUser: vi.fn().mockReturnValue(user),
    getAccessToken: vi.fn().mockResolvedValue('access-token'),
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * A fresh session for one test.
 *
 * `WorkosSession` is `providedIn: 'root'` and caches its `createClient`
 * promise, so the module is reset immediately before configuring rather than
 * relying on `beforeEach` alone — a leaked instance would short-circuit
 * `connect()` and the test would silently assert against a previous stub.
 */
function sessionWith(clientId: string): WorkosSession {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: WORKOS_CLIENT_ID, useValue: clientId },
      { provide: WORKOS_CREATE_CLIENT, useValue: createClientSpy },
      WorkosSession,
    ],
  });
  return TestBed.inject(WorkosSession);
}

describe('WorkosSession', () => {
  beforeEach(() => {
    // A brand-new spy per test, so nothing carries over.
    createClientSpy = vi.fn();
    TestBed.resetTestingModule();
  });

  it('is unconfigured, and starts nothing, when the build has no client id', async () => {
    const session = sessionWith('   ');

    expect(session.configured).toBe(false);
    await session.ensureReady();
    await session.signIn();

    // The empty-client-id convention must genuinely disable the feature, not
    // merely hide it: the mock-embedded build relies on this.
    expect(createClientMock()).not.toHaveBeenCalled();
    expect(session.ready()).toBe(true);
    expect(session.user()).toBeNull();
  });

  it('exposes the signed-in user once initialisation settles', async () => {
    const user = userFixture();
    createClientMock().mockResolvedValue(clientStub(user) as never);

    const session = sessionWith('client_01');
    await session.ensureReady();

    expect(session.user()).toEqual(user);
    expect(session.ready()).toBe(true);
    expect(session.error()).toBeNull();
  });

  it('treats signed-out as a normal state rather than an error', async () => {
    createClientMock().mockResolvedValue(clientStub(null) as never);

    const session = sessionWith('client_01');
    await session.ensureReady();

    expect(session.user()).toBeNull();
    expect(session.error()).toBeNull();
  });

  it('reports an initialisation failure without throwing into startup', async () => {
    // The realistic cause is a dashboard misconfiguration — an unregistered
    // origin or redirect URI — which must not break the rest of the app.
    createClientMock().mockRejectedValue(new Error('origin not allowed'));

    const session = sessionWith('client_01');
    await expect(session.ensureReady()).resolves.toBeUndefined();

    expect(session.error()).toBe('origin not allowed');
    expect(session.ready()).toBe(true);
    expect(session.user()).toBeNull();
  });

  it('creates the client once across concurrent callers', async () => {
    createClientMock().mockResolvedValue(clientStub(userFixture()) as never);

    const session = sessionWith('client_01');
    await Promise.all([session.ensureReady(), session.ensureReady(), session.signIn()]);

    // `createClient` performs the PKCE code exchange, and the verifier is
    // single-use — a second client would consume it and fail the sign-in.
    expect(createClientMock()).toHaveBeenCalledTimes(1);
  });

  it('never passes a client secret, and redirects back to this deployment', async () => {
    const client = clientStub(null);
    createClientMock().mockResolvedValue(client as never);

    const session = sessionWith('client_01');
    await session.signIn();

    expect(createClientMock()).toHaveBeenCalledWith('client_01', expect.anything());
    const options = createClientMock().mock.calls[0][1] ?? {};
    expect(options.redirectUri).toBe(accountPageUrl());
    // A public client has no secret to send; one appearing here would mean the
    // WorkOS API key had been pulled into the browser bundle.
    expect(JSON.stringify(options)).not.toContain('secret');
    expect(client.signIn).toHaveBeenCalled();
  });

  it('signs out immediately in the UI and returns to this deployment', async () => {
    const client = clientStub(userFixture());
    createClientMock().mockResolvedValue(client as never);

    const session = sessionWith('client_01');
    await session.ensureReady();
    await session.signOut();

    expect(session.user()).toBeNull();
    expect(client.signOut).toHaveBeenCalledWith({
      returnTo: accountPageUrl(),
      navigate: false,
    });
  });

  it('clears the user when the SDK reports a refresh failure', async () => {
    const client = clientStub(userFixture());
    createClientMock().mockResolvedValue(client as never);

    const session = sessionWith('client_01');
    await session.ensureReady();
    expect(session.user()).not.toBeNull();

    // A session that dies overnight must not leave a stale name on screen.
    const options = createClientMock().mock.calls[0][1] ?? {};
    options.onRefreshFailure?.({ signIn: client.signIn as never });

    expect(session.user()).toBeNull();
  });

  it('tracks the user through a background token refresh', async () => {
    const client = clientStub(userFixture());
    createClientMock().mockResolvedValue(client as never);

    const session = sessionWith('client_01');
    await session.ensureReady();

    const renamed = userFixture({ firstName: 'Grace', lastName: 'Hopper' });
    const options = createClientMock().mock.calls[0][1] ?? {};
    options.onRefresh?.({ user: renamed } as never);

    expect(session.user()).toEqual(renamed);
  });

  it('withholds an access token when nobody is signed in', async () => {
    const client = clientStub(null);
    createClientMock().mockResolvedValue(client as never);

    const session = sessionWith('client_01');
    await session.ensureReady();

    await expect(session.accessToken()).resolves.toBeNull();
    expect(client.getAccessToken).not.toHaveBeenCalled();
  });

  it('returns an access token for a signed-in user', async () => {
    createClientMock().mockResolvedValue(clientStub(userFixture()) as never);

    const session = sessionWith('client_01');
    await session.ensureReady();

    await expect(session.accessToken()).resolves.toBe('access-token');
  });

  it('reports a sign-in failure instead of leaving the page silent', async () => {
    const client = clientStub(null);
    client.signIn.mockRejectedValue(new Error('network down'));
    createClientMock().mockResolvedValue(client as never);

    const session = sessionWith('client_01');
    await session.signIn();

    expect(session.error()).toBe('network down');
  });
});

describe('accountPageUrl', () => {
  it('resolves against the base href so canary keeps its own redirect target', () => {
    // Canary and production share an origin and differ only by base href, so a
    // URL built from location.origin would send canary users to production.
    expect(accountPageUrl()).toBe(
      new URL('settings/mawkingbird-plus', document.baseURI).toString(),
    );
  });
});

describe('displayName', () => {
  it('joins the two name parts', () => {
    expect(displayName(userFixture() as never)).toBe('Ada Lovelace');
  });

  it('uses whichever part was supplied', () => {
    expect(displayName(userFixture({ lastName: null }) as never)).toBe('Ada');
    expect(displayName(userFixture({ firstName: null }) as never)).toBe('Lovelace');
  });

  it('is null when the provider supplied no name at all', () => {
    // Email is then the only identifier, which is why the page always shows it.
    expect(displayName(userFixture({ firstName: null, lastName: null }) as never)).toBeNull();
  });
});
