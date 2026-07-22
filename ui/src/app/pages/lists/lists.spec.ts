import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Collection, UserList } from '../../models';
import { Lists } from './lists';

/** Exposes Lists' protected signals for white-box testing. */
interface ListsInternals {
  lists: WritableSignal<UserList[]>;
  loading: WritableSignal<boolean>;
  newTitle: WritableSignal<string>;
  collections: WritableSignal<Collection[]>;
  collectionsSupported: WritableSignal<boolean>;
  newCollectionName: WritableSignal<string>;
  listToDelete: WritableSignal<UserList | null>;
  collectionToDelete: WritableSignal<Collection | null>;
  load(): void;
  create(): void;
  askDeleteList(list: UserList, event: Event): void;
  remove(list: UserList): void;
  createCollection(): void;
  askDeleteCollection(c: Collection, event: Event): void;
  removeCollection(c: Collection): void;
}

function makeCollection(id: string, name = `Collection ${id}`): Collection {
  return {
    id,
    account_id: '9',
    name,
    description: '',
    discoverable: false,
    sensitive: false,
    local: true,
    item_count: 0,
    items: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    uri: `https://example.social/collections/${id}`,
  };
}

const noopEvent = {
  stopPropagation: () => {
    /* noop */
  },
  preventDefault: () => {
    /* noop */
  },
} as unknown as Event;

function internals(fixture: ComponentFixture<Lists>): ListsInternals {
  return fixture.componentInstance as unknown as ListsInternals;
}

function makeList(id: string, title = `List ${id}`): UserList {
  return { id, title };
}

describe('Lists', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /**
   * Server-feed probing (Fediverse/Local) fires two timelines/public GETs in
   * ngOnInit. Tests don't assert on the resulting rows, so we just settle them
   * as empty (which hides both probed feeds).
   */
  function flushServerFeedProbes(): void {
    httpMock
      .match((r) => r.url === '/api/v1/timelines/public')
      .forEach((req) => req.flush([]));
  }

  /**
   * Creates the component and settles the collections side of ngOnInit.
   * By default the auth snapshot is empty, so loadCollections() first calls
   * verify_credentials; erroring it short-circuits the collection fetches.
   */
  function setUp(): ComponentFixture<Lists> {
    const fixture = TestBed.createComponent(Lists);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/accounts/verify_credentials').error(new ProgressEvent('error'));
    flushServerFeedProbes();
    return fixture;
  }

  it('starts with loading=true and an empty lists array', () => {
    const fixture = setUp();
    expect(internals(fixture).loading()).toBe(true);
    expect(internals(fixture).lists()).toEqual([]);
    httpMock.expectOne('/api/v1/lists').flush([]);
  });

  it('populates lists and clears loading on successful fetch', () => {
    const fixture = setUp();
    const l1 = makeList('1');
    const l2 = makeList('2');

    httpMock.expectOne('/api/v1/lists').flush([l1, l2]);

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).lists()).toEqual([l1, l2]);
  });

  it('clears loading on HTTP error', () => {
    const fixture = setUp();

    httpMock.expectOne('/api/v1/lists').error(new ProgressEvent('error'));

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).lists()).toEqual([]);
  });

  it('create() does nothing when newTitle is blank', () => {
    const fixture = setUp();
    httpMock.expectOne('/api/v1/lists').flush([]);

    internals(fixture).newTitle.set('   ');
    internals(fixture).create();

    // No POST should be made
    httpMock.expectNone('/api/v1/lists');
  });

  it('create() POSTs to /api/v1/lists and appends the new list', () => {
    const fixture = setUp();
    httpMock.expectOne('/api/v1/lists').flush([]);

    internals(fixture).newTitle.set('My New List');
    internals(fixture).create();

    const newList = makeList('42', 'My New List');
    httpMock.expectOne('/api/v1/lists').flush(newList);

    expect(internals(fixture).lists()).toEqual([newList]);
    expect(internals(fixture).newTitle()).toBe('');
  });

  it('create() appends to existing lists', () => {
    const fixture = setUp();
    const l1 = makeList('1');
    httpMock.expectOne('/api/v1/lists').flush([l1]);

    internals(fixture).newTitle.set('Second List');
    internals(fixture).create();

    const l2 = makeList('2', 'Second List');
    httpMock.expectOne('/api/v1/lists').flush(l2);

    expect(internals(fixture).lists()).toEqual([l1, l2]);
  });

  it('remove() DELETEs /api/v1/lists/:id and removes it from the list', () => {
    const fixture = setUp();
    const l1 = makeList('1');
    const l2 = makeList('2');
    httpMock.expectOne('/api/v1/lists').flush([l1, l2]);

    internals(fixture).remove(l1);

    httpMock.expectOne('/api/v1/lists/1').flush({});

    expect(internals(fixture).lists()).toEqual([l2]);
  });

  it('remove() only removes the targeted list', () => {
    const fixture = setUp();
    const l1 = makeList('1');
    const l2 = makeList('2');
    const l3 = makeList('3');
    httpMock.expectOne('/api/v1/lists').flush([l1, l2, l3]);

    internals(fixture).remove(l2);

    httpMock.expectOne('/api/v1/lists/2').flush({});

    expect(internals(fixture).lists()).toEqual([l1, l3]);
  });

  it('loads collections once credentials are verified', () => {
    const fixture = TestBed.createComponent(Lists);
    fixture.detectChanges();
    flushServerFeedProbes();

    httpMock
      .expectOne('/api/v1/accounts/verify_credentials')
      .flush({ id: '9', username: 'me', acct: 'me' });
    httpMock.expectOne('/api/v1/lists').flush([]);
    httpMock.expectOne('/api/v1/accounts/9/endorsements').flush([]);
    httpMock.expectOne('/api/v1/accounts/9/collections').flush({ collections: [] });
    httpMock.expectOne('/api/v1/accounts/9/in_collections').flush({ collections: [] });

    const c = fixture.componentInstance as unknown as {
      collectionsLoading: WritableSignal<boolean>;
      collectionsSupported: WritableSignal<boolean>;
    };
    expect(c.collectionsLoading()).toBe(false);
    expect(c.collectionsSupported()).toBe(true);
  });

  /**
   * Settle ngOnInit with a *verified* account (id 9), flushing the lists fetch
   * and both collection GETs. Returns the fixture with collections loaded.
   */
  function setUpVerified(collections: Collection[] = []): ComponentFixture<Lists> {
    const fixture = TestBed.createComponent(Lists);
    fixture.detectChanges();
    flushServerFeedProbes();
    httpMock
      .expectOne('/api/v1/accounts/verify_credentials')
      .flush({ id: '9', username: 'me', acct: 'me' });
    httpMock.expectOne('/api/v1/lists').flush([]);
    httpMock.expectOne('/api/v1/accounts/9/endorsements').flush([]);
    httpMock.expectOne('/api/v1/accounts/9/collections').flush({ collections });
    httpMock.expectOne('/api/v1/accounts/9/in_collections').flush({ collections: [] });
    return fixture;
  }

  it('flips collectionsSupported=false when the collections GET 404s (pre-4.6 server)', () => {
    const fixture = TestBed.createComponent(Lists);
    fixture.detectChanges();
    flushServerFeedProbes();

    httpMock
      .expectOne('/api/v1/accounts/verify_credentials')
      .flush({ id: '9', username: 'me', acct: 'me' });
    httpMock.expectOne('/api/v1/lists').flush([]);
    httpMock.expectOne('/api/v1/accounts/9/endorsements').flush([]);
    httpMock
      .expectOne('/api/v1/accounts/9/collections')
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock.expectOne('/api/v1/accounts/9/in_collections').flush({ collections: [] });

    expect(internals(fixture).collectionsSupported()).toBe(false);
  });

  it('createCollection() POSTs the create body and appends the wrapped collection', () => {
    const fixture = setUpVerified();

    internals(fixture).newCollectionName.set('Besties');
    internals(fixture).createCollection();

    const post = httpMock.expectOne('/api/v1/collections');
    expect(post.request.method).toBe('POST');
    // mastodon.social requires sensitive + discoverable on create (verified live).
    expect(post.request.body).toEqual({ name: 'Besties', sensitive: false, discoverable: false });
    post.flush({ collection: makeCollection('C1', 'Besties') });

    expect(
      internals(fixture)
        .collections()
        .map((c) => c.name),
    ).toEqual(['Besties']);
    expect(internals(fixture).newCollectionName()).toBe('');
  });

  it('createCollection() reloads instead of appending when the stub returns {collection:null}', () => {
    const fixture = setUpVerified();

    internals(fixture).newCollectionName.set('Stub');
    internals(fixture).createCollection();
    httpMock.expectOne('/api/v1/collections').flush({ collection: null });

    // Null payload → loadCollections() re-runs (account already verified).
    httpMock.expectOne('/api/v1/accounts/9/endorsements').flush([]);
    httpMock
      .expectOne('/api/v1/accounts/9/collections')
      .flush({ collections: [makeCollection('C2')] });
    httpMock.expectOne('/api/v1/accounts/9/in_collections').flush({ collections: [] });

    expect(
      internals(fixture)
        .collections()
        .map((c) => c.id),
    ).toEqual(['C2']);
  });

  it('askDeleteList() stages the list for confirmation without deleting', () => {
    const fixture = setUp();
    const l1 = makeList('1');
    httpMock.expectOne('/api/v1/lists').flush([l1]);

    internals(fixture).askDeleteList(l1, noopEvent);

    // No DELETE yet — just staged for the confirm dialog.
    expect(internals(fixture).listToDelete()).toEqual(l1);
    httpMock.expectNone('/api/v1/lists/1');
  });

  it('removeCollection() DELETEs and drops the row', () => {
    const c1 = makeCollection('C1');
    const c2 = makeCollection('C2');
    const fixture = setUpVerified([c1, c2]);

    internals(fixture).removeCollection(c1);
    httpMock.expectOne('/api/v1/collections/C1').flush({});

    expect(
      internals(fixture)
        .collections()
        .map((c) => c.id),
    ).toEqual(['C2']);
  });

  it('load() sets loading=true then fetches fresh data', () => {
    const fixture = setUp();
    httpMock.expectOne('/api/v1/lists').flush([]);

    internals(fixture).load();
    expect(internals(fixture).loading()).toBe(true);

    const l1 = makeList('1');
    httpMock.expectOne('/api/v1/lists').flush([l1]);

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).lists()).toEqual([l1]);
  });
});
