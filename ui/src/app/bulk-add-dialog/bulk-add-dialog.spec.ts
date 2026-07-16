import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account } from '../models';
import { BulkAddDialog } from './bulk-add-dialog';

interface BulkResult {
  handle: string;
  status: string;
}

interface Internals {
  handles: WritableSignal<string>;
  busy: WritableSignal<boolean>;
  results: WritableSignal<BulkResult[]>;
  parseHandles(raw: string): string[];
  count(): number;
  add(): void;
}

function internals(fixture: ComponentFixture<BulkAddDialog>): Internals {
  return fixture.componentInstance as unknown as Internals;
}

function makeAccount(id: string): Account {
  return { id, username: `u${id}`, acct: `u${id}`, display_name: `User ${id}` } as Account;
}

describe('BulkAddDialog', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function setUp(kind: 'list' | 'collection', id = 'T1'): ComponentFixture<BulkAddDialog> {
    const fixture = TestBed.createComponent(BulkAddDialog);
    fixture.componentRef.setInput('targetId', id);
    fixture.componentRef.setInput('targetKind', kind);
    fixture.detectChanges();
    return fixture;
  }

  it('parseHandles splits on commas, whitespace, and newlines and strips @', () => {
    const fixture = setUp('list');
    expect(internals(fixture).parseHandles(' @a, @b@x\n@c  @d ')).toEqual(['a', 'b@x', 'c', 'd']);
  });

  it('adds each resolved handle to a list sequentially and emits the added count', () => {
    const fixture = setUp('list', 'L9');
    const added = vi.fn();
    fixture.componentInstance.added.subscribe(added);

    internals(fixture).handles.set('@alice, @bob');
    internals(fixture).add();

    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('A')], statuses: [], hashtags: [] });
    httpMock.expectOne('/api/v1/lists/L9/accounts').flush({});
    // Second handle only after the first completes (concatMap).
    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('B')], statuses: [], hashtags: [] });
    httpMock.expectOne('/api/v1/lists/L9/accounts').flush({});

    expect(
      internals(fixture)
        .results()
        .map((r) => r.status),
    ).toEqual(['added', 'added']);
    expect(internals(fixture).busy()).toBe(false);
    expect(added).toHaveBeenCalledWith(2);
  });

  it('adds to a collection via POST /items when targetKind is collection', () => {
    const fixture = setUp('collection', 'C3');
    internals(fixture).handles.set('@solo');
    internals(fixture).add();

    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('S')], statuses: [], hashtags: [] });
    const post = httpMock.expectOne('/api/v1/collections/C3/items');
    expect(post.request.body).toEqual({ account_id: 'S' });
    post.flush({ collection_item: { id: 'I1', account_id: 'S', state: 'pending' } });

    expect(internals(fixture).results()).toEqual([{ handle: 'solo', status: 'added' }]);
  });

  it('marks a handle notfound when search returns nothing, without stopping the rest', () => {
    const fixture = setUp('list', 'L1');
    internals(fixture).handles.set('@ghost @real');
    internals(fixture).add();

    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [], statuses: [], hashtags: [] });
    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('R')], statuses: [], hashtags: [] });
    httpMock.expectOne('/api/v1/lists/L1/accounts').flush({});

    expect(
      internals(fixture)
        .results()
        .map((r) => r.status),
    ).toEqual(['notfound', 'added']);
  });

  it('records an error result when the add call fails', () => {
    const fixture = setUp('list', 'L1');
    internals(fixture).handles.set('@x');
    internals(fixture).add();

    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('X')], statuses: [], hashtags: [] });
    httpMock.expectOne('/api/v1/lists/L1/accounts').flush('', { status: 500, statusText: 'Error' });

    expect(internals(fixture).results()).toEqual([{ handle: 'x', status: 'error' }]);
  });
});
