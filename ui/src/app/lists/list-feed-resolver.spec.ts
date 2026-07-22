import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Account, Status } from '../models';
import { ListFeedResolver, MERGE_MEMBER_CAP } from './list-feed-resolver';
import { authorsOf } from './list-source';

function makeStatus(id: string, accountId: string, createdAt: string): Status {
  return {
    id,
    created_at: createdAt,
    account: { id: accountId, acct: `u${accountId}` } as Account,
  } as Status;
}

describe('ListFeedResolver.mergeMemberTimelines', () => {
  let resolver: ListFeedResolver;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    resolver = TestBed.inject(ListFeedResolver);
    http = TestBed.inject(HttpTestingController);
  });

  it('merges member statuses newest-first', () => {
    let result: Status[] = [];
    resolver.mergeMemberTimelines(['a', 'b']).subscribe((m) => (result = m.statuses));

    http
      .expectOne((r) => r.url === '/api/v1/accounts/a/statuses')
      .flush([makeStatus('1', 'a', '2026-01-01T00:00:00Z')]);
    http
      .expectOne((r) => r.url === '/api/v1/accounts/b/statuses')
      .flush([makeStatus('2', 'b', '2026-02-01T00:00:00Z')]);

    expect(result.map((s) => s.id)).toEqual(['2', '1']);
    http.verify();
  });

  it('degrades a failing member to an empty contribution', () => {
    let result: Status[] = [];
    resolver.mergeMemberTimelines(['a', 'b']).subscribe((m) => (result = m.statuses));

    http
      .expectOne((r) => r.url === '/api/v1/accounts/a/statuses')
      .flush([makeStatus('1', 'a', '2026-01-01T00:00:00Z')]);
    http
      .expectOne((r) => r.url === '/api/v1/accounts/b/statuses')
      .error(new ProgressEvent('fail'));

    expect(result.map((s) => s.id)).toEqual(['1']);
    http.verify();
  });

  it('caps member fan-out and reports the original count', () => {
    const ids = Array.from({ length: MERGE_MEMBER_CAP + 5 }, (_, i) => `a${i}`);
    let capped = false;
    let cappedFrom = 0;
    resolver.mergeMemberTimelines(ids).subscribe((m) => {
      capped = m.capped;
      cappedFrom = m.cappedFrom;
    });

    const reqs = http.match((r) => r.url.startsWith('/api/v1/accounts/'));
    expect(reqs.length).toBe(MERGE_MEMBER_CAP);
    reqs.forEach((r) => r.flush([]));

    expect(capped).toBe(true);
    expect(cappedFrom).toBe(MERGE_MEMBER_CAP + 5);
    http.verify();
  });

  it('makes no request for an empty member list', () => {
    let emitted = false;
    resolver.mergeMemberTimelines([]).subscribe((m) => {
      emitted = true;
      expect(m.statuses).toEqual([]);
    });
    expect(emitted).toBe(true);
    http.verify();
  });
});

describe('authorsOf', () => {
  it('returns distinct authors first-seen, attributing boosts to the original author', () => {
    const boosted = makeStatus('3', 'x', '2026-03-01T00:00:00Z');
    const reblog = { ...makeStatus('4', 'y', '2026-04-01T00:00:00Z'), reblog: boosted } as Status;
    const authors = authorsOf([
      makeStatus('1', 'a', '2026-01-01T00:00:00Z'),
      makeStatus('2', 'a', '2026-02-01T00:00:00Z'),
      reblog,
    ]);
    expect(authors.map((a) => a.id)).toEqual(['a', 'x']);
  });
});
