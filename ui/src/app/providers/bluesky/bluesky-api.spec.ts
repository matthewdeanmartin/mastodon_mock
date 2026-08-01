import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlueskyApi } from './bluesky-api';
import { BlueskySession, BskySession } from './bluesky-session';
import { bskySessionStored, seedBskySession, storedBskyProfile } from '../../testing/seed-storage';

const SERVICE = 'https://bsky.social';

function storedSession(): BskySession {
  return {
    service: SERVICE,
    handle: 'me.bsky.social',
    did: 'did:plc:me',
    accessJwt: 'access-1',
    refreshJwt: 'refresh-1',
  };
}

describe('BlueskySession', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('login creates a session, captures the profile, and persists', () => {
    const session = TestBed.inject(BlueskySession);
    let done = false;
    session.login('me.bsky.social', 'app-pass').subscribe(() => (done = true));

    const create = httpMock.expectOne(`${SERVICE}/xrpc/com.atproto.server.createSession`);
    expect(create.request.body).toEqual({ identifier: 'me.bsky.social', password: 'app-pass' });
    create.flush({
      did: 'did:plc:me',
      handle: 'me.bsky.social',
      accessJwt: 'a1',
      refreshJwt: 'r1',
    });

    const profile = httpMock.expectOne((req) => req.url.includes('app.bsky.actor.getProfile'));
    expect(profile.request.headers.get('Authorization')).toBe('Bearer a1');
    profile.flush({ displayName: 'Me', avatar: 'https://cdn/me.jpg' });

    expect(done).toBe(true);
    expect(session.linked()).toBe(true);
    expect(session.session()?.displayName).toBe('Me');
    expect(storedBskyProfile()!['did']).toBe('did:plc:me');
  });

  it('unlink drops the session and storage', () => {
    seedBskySession(storedSession());
    const session = TestBed.inject(BlueskySession);
    expect(session.linked()).toBe(true);

    session.unlink();
    expect(session.linked()).toBe(false);
    expect(bskySessionStored()).toBe(false);
  });
});

describe('BlueskyApi', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    seedBskySession(storedSession());
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sends the access token and pages the timeline', () => {
    const api = TestBed.inject(BlueskyApi);
    api.getTimeline('cur-1').subscribe();

    const req = httpMock.expectOne(
      (r) =>
        r.url === `${SERVICE}/xrpc/app.bsky.feed.getTimeline` && r.params.get('cursor') === 'cur-1',
    );
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-1');
    req.flush({ feed: [], cursor: undefined });
  });

  it('pages one actor feed and applies the filter server-side', () => {
    const api = TestBed.inject(BlueskyApi);
    api.getAuthorFeed('did:plc:alice', 'cur-2', 'posts_with_replies').subscribe();

    const req = httpMock.expectOne((r) => r.url === `${SERVICE}/xrpc/app.bsky.feed.getAuthorFeed`);
    expect(req.request.params.get('actor')).toBe('did:plc:alice');
    expect(req.request.params.get('cursor')).toBe('cur-2');
    expect(req.request.params.get('filter')).toBe('posts_with_replies');
    req.flush({ feed: [] });
  });

  it('omits the cursor on a first author-feed page', () => {
    const api = TestBed.inject(BlueskyApi);
    api.getAuthorFeed('did:plc:alice', null).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${SERVICE}/xrpc/app.bsky.feed.getAuthorFeed`);
    expect(req.request.params.has('cursor')).toBe(false);
    // Threads by the author read as one post, matching how the profile shows them.
    expect(req.request.params.get('filter')).toBe('posts_and_author_threads');
    req.flush({ feed: [] });
  });

  it('follow writes a graph.follow record into the viewer own repo', () => {
    const api = TestBed.inject(BlueskyApi);
    api.follow('did:plc:them').subscribe();

    const req = httpMock.expectOne(`${SERVICE}/xrpc/com.atproto.repo.createRecord`);
    expect(req.request.body).toMatchObject({
      repo: 'did:plc:me',
      collection: 'app.bsky.graph.follow',
      record: { $type: 'app.bsky.graph.follow', subject: 'did:plc:them' },
    });
    req.flush({ uri: 'at://did:plc:me/app.bsky.graph.follow/1', cid: 'c' });
  });

  it('refreshes an expired token once and retries the call', () => {
    const api = TestBed.inject(BlueskyApi);
    let result: unknown;
    api.like('at://post', 'cid').subscribe((r) => (result = r));

    // First attempt: expired.
    httpMock
      .expectOne(`${SERVICE}/xrpc/com.atproto.repo.createRecord`)
      .flush({ error: 'ExpiredToken' }, { status: 400, statusText: 'Bad Request' });

    // Refresh uses the refresh token.
    const refresh = httpMock.expectOne(`${SERVICE}/xrpc/com.atproto.server.refreshSession`);
    expect(refresh.request.headers.get('Authorization')).toBe('Bearer refresh-1');
    refresh.flush({
      did: 'did:plc:me',
      handle: 'me.bsky.social',
      accessJwt: 'a2',
      refreshJwt: 'r2',
    });

    // Retry carries the fresh token.
    const retry = httpMock.expectOne(`${SERVICE}/xrpc/com.atproto.repo.createRecord`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer a2');
    retry.flush({ uri: 'at://like/1', cid: 'c' });

    expect(result).toEqual({ uri: 'at://like/1', cid: 'c' });
    expect(TestBed.inject(BlueskySession).session()?.accessJwt).toBe('a2');
  });

  it('deleteRecord splits the at-uri into repo/collection/rkey', () => {
    const api = TestBed.inject(BlueskyApi);
    api.deleteRecord('at://did:plc:me/app.bsky.feed.like/3xyz').subscribe();

    const req = httpMock.expectOne(`${SERVICE}/xrpc/com.atproto.repo.deleteRecord`);
    expect(req.request.body).toEqual({
      repo: 'did:plc:me',
      collection: 'app.bsky.feed.like',
      rkey: '3xyz',
    });
    req.flush({});
  });
});
