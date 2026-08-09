import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from './auth';
import { FollowState, RELATIONSHIP_BATCH } from './follow-state';
import { Relationship } from './models';

function relationship(id: string, overrides: Partial<Relationship> = {}): Relationship {
  return {
    id,
    following: false,
    followed_by: false,
    requested: false,
    blocking: false,
    muting: false,
    ...overrides,
  };
}

describe('FollowState', () => {
  let follows: FollowState;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    follows = TestBed.inject(FollowState);
    http = TestBed.inject(HttpTestingController);
  });

  /**
   * `Auth.isAnonymous` is `mode() === 'anonymous'`, so a bare TestBed is
   * already "signed in" as far as this service is concerned — the default
   * `mode` is null. Only the anonymous case needs arranging.
   */
  function goAnonymous(): void {
    const auth = TestBed.inject(Auth);
    Object.defineProperty(auth, 'isAnonymous', { get: () => true, configurable: true });
  }

  const RELATIONSHIPS = '/api/v1/accounts/relationships';

  it('reports unknown before anything is resolved', () => {
    expect(follows.status('1')).toBe('unknown');
  });

  it('batches at 40, which is Mastodon’s documented cap', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => String(i + 1));
    const done = follows.resolve(ids);

    // 41 ids must be two requests. Asking for all 41 at once returns the first
    // 40 and silently drops the rest, which reads as "not followed".
    const reqs = http.match((r) => r.url === RELATIONSHIPS);
    expect(reqs.length).toBe(2);
    expect(reqs[0].request.params.getAll('id[]')?.length).toBe(RELATIONSHIP_BATCH);
    expect(reqs[1].request.params.getAll('id[]')?.length).toBe(1);

    reqs[0].flush(ids.slice(0, 40).map((id) => relationship(id, { following: true })));
    reqs[1].flush([relationship('41')]);
    await done;

    expect(follows.status('1')).toBe('following');
    expect(follows.status('41')).toBe('not-following');
  });

  it('makes no request for an anonymous viewer', async () => {
    goAnonymous();
    await follows.resolve(['1', '2']);
    http.expectNone(RELATIONSHIPS);
    expect(follows.status('1')).toBe('unknown');
  });

  it('does not re-request ids it already knows', async () => {
    const first = follows.resolve(['1']);
    http.expectOne((r) => r.url === RELATIONSHIPS).flush([relationship('1')]);
    await first;

    await follows.resolve(['1']);
    http.expectNone(RELATIONSHIPS);
  });

  it('reports a locked account as requested, not following', async () => {
    const resolved = follows.resolve(['7']);
    http.expectOne((r) => r.url === RELATIONSHIPS).flush([relationship('7')]);
    await resolved;

    const toggled = follows.toggle('7');
    // The server's answer decides: a locked account answers `requested`, and
    // telling someone they are following when they are waiting is just wrong.
    http
      .expectOne('/api/v1/accounts/7/follow')
      .flush(relationship('7', { following: false, requested: true }));
    expect(await toggled).toBe(true);
    expect(follows.status('7')).toBe('requested');
  });

  it('rolls back an optimistic follow when the write fails', async () => {
    const resolved = follows.resolve(['9']);
    http.expectOne((r) => r.url === RELATIONSHIPS).flush([relationship('9')]);
    await resolved;

    const toggled = follows.toggle('9');
    http
      .expectOne('/api/v1/accounts/9/follow')
      .flush('no', { status: 500, statusText: 'Server Error' });

    expect(await toggled).toBe(false);
    // A failed follow that keeps claiming "Following" is a lie the user acts on.
    expect(follows.status('9')).toBe('not-following');
  });

  it('unfollows an account it currently follows', async () => {
    const resolved = follows.resolve(['3']);
    http
      .expectOne((r) => r.url === RELATIONSHIPS)
      .flush([relationship('3', { following: true })]);
    await resolved;

    const toggled = follows.toggle('3');
    http.expectOne('/api/v1/accounts/3/unfollow').flush(relationship('3'));
    expect(await toggled).toBe(true);
    expect(follows.status('3')).toBe('not-following');
  });

  it('forgets everything on reset', async () => {
    const resolved = follows.resolve(['1']);
    http
      .expectOne((r) => r.url === RELATIONSHIPS)
      .flush([relationship('1', { following: true })]);
    await resolved;

    follows.reset();
    expect(follows.status('1')).toBe('unknown');
  });
});
