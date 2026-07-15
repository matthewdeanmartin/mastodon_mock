import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../auth';
import { Account, Collection, UserList } from '../models';
import { ListDialog } from './list-dialog';

interface BulkResult {
  handle: string;
  status: string;
}

interface DialogInternals {
  rows: WritableSignal<{ list: UserList; member: boolean }[]>;
  loading: WritableSignal<boolean>;
  collectionRows: WritableSignal<{ collection: Collection; member: boolean; itemId: string }[]>;
  collectionsSupported: WritableSignal<boolean>;
  bulkTarget: WritableSignal<string>;
  bulkKind: WritableSignal<'list' | 'collection'>;
  bulkHandles: WritableSignal<string>;
  bulkBusy: WritableSignal<boolean>;
  bulkResults: WritableSignal<BulkResult[]>;
  parseHandles(raw: string): string[];
  bulkCount(): number;
  bulkAdd(): void;
  toggleCollection(row: { collection: Collection; member: boolean; itemId: string }): void;
}

function internals(fixture: ComponentFixture<ListDialog>): DialogInternals {
  return fixture.componentInstance as unknown as DialogInternals;
}

function makeAccount(id: string): Account {
  return { id, username: `u${id}`, acct: `u${id}`, display_name: `User ${id}` } as Account;
}

function makeCollection(id: string, name = `Col ${id}`): Collection {
  return {
    id,
    account_id: 'ME',
    name,
    description: '',
    discoverable: false,
    sensitive: false,
    local: true,
    item_count: 0,
    items: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    uri: `https://x/collections/${id}`,
  };
}

describe('ListDialog', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    // Viewer is logged in as ME so the collections section loads.
    TestBed.inject(Auth).account.set(makeAccount('ME'));
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.inject(Auth).account.set(null);
  });

  /** Create the dialog for a target account and settle ngOnInit's fetches. */
  function setUp(
    opts: { lists?: UserList[]; myCols?: Collection[]; featuring?: Collection[] } = {},
  ) {
    const fixture = TestBed.createComponent(ListDialog);
    fixture.componentRef.setInput('username', 'target');
    fixture.componentRef.setInput('accountId', 'T');
    fixture.detectChanges();

    // Lists side of load(): GET /lists, then one /accounts per list.
    const lists = opts.lists ?? [];
    httpMock.expectOne('/api/v1/lists').flush(lists);
    for (const l of lists) {
      httpMock.expectOne(`/api/v1/lists/${l.id}/accounts`).flush([]);
    }
    // Collections side: my collections + target's in_collections.
    httpMock.expectOne('/api/v1/accounts/ME/collections').flush({ collections: opts.myCols ?? [] });
    httpMock
      .expectOne('/api/v1/accounts/T/in_collections')
      .flush({ collections: opts.featuring ?? [] });
    return fixture;
  }

  // ----------------------------------------------------------------- rendering

  it('loads lists and collections; marks collection membership from in_collections', () => {
    const fixture = setUp({
      lists: [{ id: '1', title: 'Friends' }],
      myCols: [makeCollection('C1'), makeCollection('C2')],
      featuring: [makeCollection('C2')], // target is in C2 only
    });

    expect(internals(fixture).loading()).toBe(false);
    expect(
      internals(fixture)
        .rows()
        .map((r) => r.list.title),
    ).toEqual(['Friends']);
    const cols = internals(fixture).collectionRows();
    expect(cols.map((c) => c.collection.id)).toEqual(['C1', 'C2']);
    expect(cols.find((c) => c.collection.id === 'C2')?.member).toBe(true);
    expect(cols.find((c) => c.collection.id === 'C1')?.member).toBe(false);
  });

  it('flips collectionsSupported=false when my-collections 404s', () => {
    const fixture = TestBed.createComponent(ListDialog);
    fixture.componentRef.setInput('username', 'target');
    fixture.componentRef.setInput('accountId', 'T');
    fixture.detectChanges();

    httpMock.expectOne('/api/v1/lists').flush([]);
    httpMock
      .expectOne('/api/v1/accounts/ME/collections')
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock.expectOne('/api/v1/accounts/T/in_collections').flush({ collections: [] });

    expect(internals(fixture).collectionsSupported()).toBe(false);
  });

  // ----------------------------------------------------------------- collection toggle

  it('toggleCollection adds via POST /items and records the returned item id', () => {
    const fixture = setUp({ myCols: [makeCollection('C1')] });
    const row = internals(fixture).collectionRows()[0];

    internals(fixture).toggleCollection(row);
    const post = httpMock.expectOne('/api/v1/collections/C1/items');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ account_id: 'T' });
    post.flush({ collection_item: { id: 'IT1', account_id: 'T', state: 'accepted' } });

    const updated = internals(fixture).collectionRows()[0];
    expect(updated.member).toBe(true);
    expect(updated.itemId).toBe('IT1');
  });

  it('toggleCollection removes a member, fetching the item id when unknown', () => {
    const fixture = setUp({
      myCols: [makeCollection('C1')],
      featuring: [makeCollection('C1')], // already a member, itemId unknown
    });
    const row = internals(fixture).collectionRows()[0];
    expect(row.member).toBe(true);
    expect(row.itemId).toBe('');

    internals(fixture).toggleCollection(row);
    // No known item id → fetch the full collection to find it.
    httpMock.expectOne('/api/v1/collections/C1').flush({
      collection: {
        ...makeCollection('C1'),
        items: [{ id: 'IT9', account_id: 'T', state: 'accepted' }],
      },
      accounts: [makeAccount('T')],
    });
    const del = httpMock.expectOne('/api/v1/collections/C1/items/IT9');
    expect(del.request.method).toBe('DELETE');
    del.flush({});

    expect(internals(fixture).collectionRows()[0].member).toBe(false);
  });

  // ----------------------------------------------------------------- parseHandles

  it('parseHandles splits on commas, newlines, and whitespace and strips @', () => {
    const fixture = setUp();
    const parsed = internals(fixture).parseHandles(' @alice, @bob@x.social\n@carol  @dave ');
    expect(parsed).toEqual(['alice', 'bob@x.social', 'carol', 'dave']);
    expect(internals(fixture).bulkCount()).toBe(0); // handles signal untouched
  });

  // ----------------------------------------------------------------- bulk add

  it('bulkAdd resolves each handle and adds sequentially to an existing list', () => {
    const fixture = setUp({ lists: [{ id: 'L1', title: 'Devs' }] });

    internals(fixture).bulkTarget.set('Devs');
    internals(fixture).bulkKind.set('list');
    internals(fixture).bulkHandles.set('@alice, @bob');
    internals(fixture).bulkAdd();

    // ensureList → GET /lists finds "Devs" (case-insensitive).
    httpMock.expectOne('/api/v1/lists').flush([{ id: 'L1', title: 'Devs' }]);

    // First handle: search → add.
    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('A')], statuses: [], hashtags: [] });
    httpMock.expectOne('/api/v1/lists/L1/accounts').flush({});

    // Second handle (concatMap → only after the first completes).
    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('B')], statuses: [], hashtags: [] });
    httpMock.expectOne('/api/v1/lists/L1/accounts').flush({});

    // Completion refreshes the sections.
    httpMock.expectOne('/api/v1/lists').flush([{ id: 'L1', title: 'Devs' }]);
    httpMock.expectOne('/api/v1/lists/L1/accounts').flush([]);
    httpMock.expectOne('/api/v1/accounts/ME/collections').flush({ collections: [] });
    httpMock.expectOne('/api/v1/accounts/T/in_collections').flush({ collections: [] });

    expect(
      internals(fixture)
        .bulkResults()
        .map((r) => r.status),
    ).toEqual(['added', 'added']);
    expect(internals(fixture).bulkBusy()).toBe(false);
  });

  it('bulkAdd marks a handle notfound when search returns nothing, without stopping', () => {
    const fixture = setUp({ lists: [{ id: 'L1', title: 'Devs' }] });

    internals(fixture).bulkTarget.set('Devs');
    internals(fixture).bulkHandles.set('@ghost, @real');
    internals(fixture).bulkAdd();

    httpMock.expectOne('/api/v1/lists').flush([{ id: 'L1', title: 'Devs' }]);

    // ghost → no accounts
    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [], statuses: [], hashtags: [] });
    // real → resolves and adds
    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('R')], statuses: [], hashtags: [] });
    httpMock.expectOne('/api/v1/lists/L1/accounts').flush({});

    // completion refresh
    httpMock.expectOne('/api/v1/lists').flush([{ id: 'L1', title: 'Devs' }]);
    httpMock.expectOne('/api/v1/lists/L1/accounts').flush([]);
    httpMock.expectOne('/api/v1/accounts/ME/collections').flush({ collections: [] });
    httpMock.expectOne('/api/v1/accounts/T/in_collections').flush({ collections: [] });

    expect(
      internals(fixture)
        .bulkResults()
        .map((r) => r.status),
    ).toEqual(['notfound', 'added']);
  });

  it('bulkAdd creates the list when the named target does not exist', () => {
    const fixture = setUp();

    internals(fixture).bulkTarget.set('Brand New');
    internals(fixture).bulkHandles.set('@solo');
    internals(fixture).bulkAdd();

    // ensureList: GET /lists (empty) → POST /lists to create.
    httpMock.expectOne('/api/v1/lists').flush([]);
    const create = httpMock.expectOne('/api/v1/lists');
    expect(create.request.method).toBe('POST');
    create.flush({ id: 'NEW', title: 'Brand New' });

    httpMock
      .expectOne((r) => r.url === '/api/v2/search')
      .flush({ accounts: [makeAccount('S')], statuses: [], hashtags: [] });
    httpMock.expectOne('/api/v1/lists/NEW/accounts').flush({});

    // completion refresh
    httpMock.expectOne('/api/v1/lists').flush([{ id: 'NEW', title: 'Brand New' }]);
    httpMock.expectOne('/api/v1/lists/NEW/accounts').flush([]);
    httpMock.expectOne('/api/v1/accounts/ME/collections').flush({ collections: [] });
    httpMock.expectOne('/api/v1/accounts/T/in_collections').flush({ collections: [] });

    expect(internals(fixture).bulkResults()).toEqual([{ handle: 'solo', status: 'added' }]);
  });
});
