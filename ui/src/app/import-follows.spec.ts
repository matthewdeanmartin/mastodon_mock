import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { ImportFollows, normalizeHandle, parseHandles } from './import-follows';
import { Account } from './models';

function acct(id: string, acctName: string): Account {
  return { id, acct: acctName, username: acctName.split('@')[0] } as Account;
}

describe('parseHandles', () => {
  it('parses a Mastodon following_accounts.csv export', () => {
    const csv = [
      'Account address,Show boosts,Notify on new posts,Languages',
      'alice@mastodon.social,true,false,',
      'bob@fosstodon.org,true,false,',
    ].join('\n');
    expect(parseHandles(csv)).toEqual(['alice@mastodon.social', 'bob@fosstodon.org']);
  });

  it('parses pasted handles, URLs and bare names, deduping case-insensitively', () => {
    const text = [
      '@alice@mastodon.social',
      'https://fosstodon.org/@bob',
      'https://example.org/users/carol',
      'dave',
      'ALICE@mastodon.social',
      '',
      'not a handle at all!!!',
    ].join('\n');
    expect(parseHandles(text)).toEqual([
      'alice@mastodon.social',
      'bob@fosstodon.org',
      'carol@example.org',
      'dave',
    ]);
  });
});

describe('normalizeHandle', () => {
  it('handles the supported shapes', () => {
    expect(normalizeHandle('@a@b.social')).toBe('a@b.social');
    expect(normalizeHandle('a@b.social')).toBe('a@b.social');
    expect(normalizeHandle('https://b.social/@a')).toBe('a@b.social');
    expect(normalizeHandle('https://b.social/users/a/')).toBe('a@b.social');
    expect(normalizeHandle('a')).toBe('a');
    expect(normalizeHandle('')).toBeNull();
    expect(normalizeHandle('¯\\_(ツ)_/¯')).toBeNull();
  });
});

describe('ImportFollows', () => {
  function setUp(api: Partial<Api>) {
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const importer = TestBed.inject(ImportFollows);
    importer.delayMs = 0;
    importer.maxWaitMs = 1;
    return importer;
  }

  it('resolves and follows each handle sequentially, preferring exact acct matches', async () => {
    const search = vi
      .fn()
      .mockReturnValueOnce(
        of({ accounts: [acct('2', 'alice.impostor@evil.example'), acct('1', 'alice@b.social')] }),
      )
      .mockReturnValueOnce(of({ accounts: [] }));
    const follow = vi.fn().mockReturnValue(of({ id: '1', following: true }));
    const importer = setUp({ search, follow } as unknown as Api);

    importer.load(['alice@b.social', 'ghost@nowhere.example']);
    await importer.start();

    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith('1');
    expect(importer.rows().map((r) => r.status)).toEqual(['followed', 'not_found']);
    expect(importer.running()).toBe(false);
  });

  it('retries the same handle after a 429 and marks other errors failed', async () => {
    const rateLimited = new HttpErrorResponse({ status: 429, headers: new HttpHeaders() });
    const search = vi
      .fn()
      .mockReturnValueOnce(throwError(() => rateLimited))
      .mockReturnValueOnce(of({ accounts: [acct('1', 'alice@b.social')] }))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    const follow = vi.fn().mockReturnValue(of({ id: '1', following: true }));
    const importer = setUp({ search, follow } as unknown as Api);

    importer.load(['alice@b.social', 'bob@c.social']);
    await importer.start();

    expect(search).toHaveBeenCalledTimes(3);
    expect(importer.rows()[0].status).toBe('followed');
    expect(importer.rows()[1].status).toBe('failed');
  });

  it('stop() halts the run, leaving the rest pending', async () => {
    const search = vi.fn().mockImplementation(() => {
      importer.stop();
      return of({ accounts: [acct('1', 'alice@b.social')] });
    });
    const follow = vi.fn().mockReturnValue(of({ id: '1', following: true }));
    const importer = setUp({ search, follow } as unknown as Api);

    importer.load(['alice@b.social', 'bob@c.social']);
    await importer.start();

    expect(importer.rows()[0].status).toBe('followed');
    expect(importer.rows()[1].status).toBe('pending');
  });
});
