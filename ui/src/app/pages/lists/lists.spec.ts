import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserList } from '../../models';
import { Lists } from './lists';

/** Exposes Lists' protected signals for white-box testing. */
interface ListsInternals {
  lists: WritableSignal<UserList[]>;
  loading: WritableSignal<boolean>;
  newTitle: WritableSignal<string>;
  load(): void;
  create(): void;
  remove(list: UserList, event: Event): void;
}

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
   * Creates the component and settles the collections side of ngOnInit.
   * By default the auth snapshot is empty, so loadCollections() first calls
   * verify_credentials; erroring it short-circuits the collection fetches.
   */
  function setUp(): ComponentFixture<Lists> {
    const fixture = TestBed.createComponent(Lists);
    fixture.detectChanges();
    httpMock
      .expectOne('/api/v1/accounts/verify_credentials')
      .error(new ProgressEvent('error'));
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

    const fakeEvent = {
      stopPropagation: () => {
        /* noop */
      },
      preventDefault: () => {
        /* noop */
      },
    } as unknown as Event;
    internals(fixture).remove(l1, fakeEvent);

    httpMock.expectOne('/api/v1/lists/1').flush({});

    expect(internals(fixture).lists()).toEqual([l2]);
  });

  it('remove() only removes the targeted list', () => {
    const fixture = setUp();
    const l1 = makeList('1');
    const l2 = makeList('2');
    const l3 = makeList('3');
    httpMock.expectOne('/api/v1/lists').flush([l1, l2, l3]);

    const fakeEvent = {
      stopPropagation: () => {
        /* noop */
      },
      preventDefault: () => {
        /* noop */
      },
    } as unknown as Event;
    internals(fixture).remove(l2, fakeEvent);

    httpMock.expectOne('/api/v1/lists/2').flush({});

    expect(internals(fixture).lists()).toEqual([l1, l3]);
  });

  it('loads collections once credentials are verified', () => {
    const fixture = TestBed.createComponent(Lists);
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/accounts/verify_credentials')
      .flush({ id: '9', username: 'me', acct: 'me' });
    httpMock.expectOne('/api/v1/lists').flush([]);
    httpMock.expectOne('/api/v1/9/collections').flush([]);
    httpMock.expectOne('/api/v1/9/in_collections').flush([]);

    const c = fixture.componentInstance as unknown as {
      collectionsLoading: WritableSignal<boolean>;
      collectionsSupported: WritableSignal<boolean>;
    };
    expect(c.collectionsLoading()).toBe(false);
    expect(c.collectionsSupported()).toBe(true);
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
