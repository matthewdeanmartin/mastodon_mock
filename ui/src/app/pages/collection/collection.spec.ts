import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { Account, CollectionItem, CollectionWithAccounts, Status } from '../../models';
import { CollectionPage } from './collection';

/** Exposes CollectionPage's protected members for white-box testing. */
interface CollectionInternals {
  data: WritableSignal<CollectionWithAccounts | null>;
  loading: WritableSignal<boolean>;
  error: WritableSignal<string>;
  tab: WritableSignal<'feed' | 'members'>;
  feed: WritableSignal<Status[]>;
  query: WritableSignal<string>;
  results: WritableSignal<Account[]>;
  members(): { itemId: string; state: string; account: Account }[];
  curator(): Account | null;
  isOwner(): boolean;
  myItem(): { itemId: string; account: Account } | null;
  setTab(tab: 'feed' | 'members'): void;
  addMember(a: Account): void;
  removeMember(m: { itemId: string }): void;
  revokeSelf(): void;
  remove(): void;
  search(): void;
}

function internals(fixture: ComponentFixture<CollectionPage>): CollectionInternals {
  return fixture.componentInstance as unknown as CollectionInternals;
}

function makeAccount(id: string): Account {
  return { id, username: `u${id}`, acct: `u${id}`, display_name: `User ${id}` } as Account;
}

function makeItem(
  id: string,
  accountId: string | null,
  state: 'pending' | 'accepted',
): CollectionItem {
  return { id, account_id: accountId, state, created_at: '2026-01-01T00:00:00Z' };
}

function makeStatus(id: string, createdAt: string, accountId: string): Status {
  return {
    id,
    created_at: createdAt,
    edited_at: null,
    content: `<p>${id}</p>`,
    spoiler_text: '',
    visibility: 'public',
    url: null,
    account: makeAccount(accountId) as never,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: [],
  } as Status;
}

const OWNER = 'O';
const ACCEPTED = 'A';
const PENDING = 'P';

/**
 * A CollectionWithAccounts fixture: owner O, accepted member A, pending member P.
 * The owner is included in `accounts` (curator lookup) but is not itself an item.
 */
function makeCollection(id = 'C1'): CollectionWithAccounts {
  return {
    collection: {
      id,
      account_id: OWNER,
      name: 'Cool People',
      description: 'A curated set',
      discoverable: true,
      sensitive: false,
      local: true,
      item_count: 2,
      items: [makeItem('I-A', ACCEPTED, 'accepted'), makeItem('I-P', PENDING, 'pending')],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      uri: `https://example.social/collections/${id}`,
    },
    accounts: [makeAccount(OWNER), makeAccount(ACCEPTED), makeAccount(PENDING)],
  };
}

describe('CollectionPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    // Override the route BEFORE any test injects a service (which would
    // instantiate the module and forbid further overrides).
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { paramMap: of(convertToParamMap({ id: 'C1' })) },
    });
  });

  afterEach(() => {
    httpMock.verify();
    // Reset the root Auth signal so cross-test owner state doesn't leak.
    TestBed.inject(Auth).account.set(null);
  });

  /** Create the component (route id 'C1', overridden in beforeEach). */
  function setUp(): ComponentFixture<CollectionPage> {
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CollectionPage);
    fixture.detectChanges();
    return fixture;
  }

  /** Flush the initial GET and the (default feed tab) per-member statuses. */
  function flushLoad(
    fixture: ComponentFixture<CollectionPage>,
    data = makeCollection(),
    statuses: Record<string, Status[]> = {},
  ): void {
    httpMock.expectOne(`/api/v1/collections/${data.collection.id}`).flush(data);
    // Default tab is feed → one statuses request per *accepted* member.
    for (const m of internals(fixture)
      .members()
      .filter((x) => x.state === 'accepted')) {
      httpMock
        .expectOne((r) => r.url === `/api/v1/accounts/${m.account.id}/statuses`)
        .flush(statuses[m.account.id] ?? []);
    }
  }

  // ---------------------------------------------------------------- initial load

  it('loads the collection and clears loading; computes curator and members', () => {
    const fixture = setUp();
    expect(internals(fixture).loading()).toBe(true);

    flushLoad(fixture);

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).curator()?.id).toBe(OWNER);
    const members = internals(fixture).members();
    expect(members.map((m) => m.account.id)).toEqual([ACCEPTED, PENDING]);
    expect(members.find((m) => m.account.id === PENDING)?.state).toBe('pending');
  });

  it('shows a support message and does not crash on 404', () => {
    const fixture = setUp();
    httpMock
      .expectOne('/api/v1/collections/C1')
      .flush('', { status: 404, statusText: 'Not Found' });

    expect(internals(fixture).loading()).toBe(false);
    expect(internals(fixture).error()).toContain('not support collections');
    expect(internals(fixture).data()).toBeNull();
  });

  // ---------------------------------------------------------------- feed synthesis

  it('synthesizes the feed from accepted members only, sorted desc and capped', () => {
    const fixture = setUp();
    const older = makeStatus('s1', '2026-01-01T00:00:00Z', ACCEPTED);
    const newer = makeStatus('s2', '2026-06-01T00:00:00Z', ACCEPTED);
    // Only A is accepted, so exactly one statuses request (not P, not O).
    flushLoad(fixture, makeCollection(), { [ACCEPTED]: [older, newer] });

    const feed = internals(fixture).feed();
    expect(feed.map((s) => s.id)).toEqual(['s2', 's1']); // newest first
  });

  it('a per-member statuses error contributes [] without killing the feed', () => {
    const data = {
      ...makeCollection(),
    };
    // Two accepted members so we can error one and keep the other.
    data.collection = {
      ...data.collection,
      items: [makeItem('I-A', ACCEPTED, 'accepted'), makeItem('I-B', 'B', 'accepted')],
    };
    data.accounts = [makeAccount(OWNER), makeAccount(ACCEPTED), makeAccount('B')];

    const fixture = setUp();
    httpMock.expectOne('/api/v1/collections/C1').flush(data);
    httpMock
      .expectOne((r) => r.url === `/api/v1/accounts/${ACCEPTED}/statuses`)
      .flush([makeStatus('ok', '2026-01-01T00:00:00Z', ACCEPTED)]);
    httpMock
      .expectOne((r) => r.url === '/api/v1/accounts/B/statuses')
      .flush('', { status: 500, statusText: 'Error' });

    expect(
      internals(fixture)
        .feed()
        .map((s) => s.id),
    ).toEqual(['ok']);
  });

  it('does not refetch the feed when switching members -> feed again', () => {
    const fixture = setUp();
    flushLoad(fixture, makeCollection(), { [ACCEPTED]: [] });

    internals(fixture).setTab('members');
    internals(fixture).setTab('feed');

    // No new statuses request for the accepted member (feedLoadedFor guard).
    httpMock.expectNone((r) => r.url === `/api/v1/accounts/${ACCEPTED}/statuses`);
  });

  // ---------------------------------------------------------------- owner actions

  it('isOwner is true for the curator, and remove() DELETEs then navigates to /lists', () => {
    TestBed.inject(Auth).account.set(makeAccount(OWNER));
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = setUp();
    flushLoad(fixture);
    expect(internals(fixture).isOwner()).toBe(true);

    internals(fixture).remove();
    httpMock.expectOne('/api/v1/collections/C1').flush({});

    expect(nav).toHaveBeenCalledWith(['/lists']);
  });

  it('addMember POSTs /items then re-fetches the collection', () => {
    TestBed.inject(Auth).account.set(makeAccount(OWNER));
    const fixture = setUp();
    flushLoad(fixture);

    internals(fixture).addMember(makeAccount('Z'));

    const post = httpMock.expectOne('/api/v1/collections/C1/items');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ account_id: 'Z' });
    post.flush({ collection_item: makeItem('I-Z', 'Z', 'pending') });

    // Re-fetch (load) fires the collection GET + feed again.
    flushLoad(fixture);
    expect(internals(fixture).data()).not.toBeNull();
  });

  it('removeMember DELETEs /items/:itemId then re-fetches', () => {
    TestBed.inject(Auth).account.set(makeAccount(OWNER));
    const fixture = setUp();
    flushLoad(fixture);

    const accepted = internals(fixture)
      .members()
      .find((m) => m.state === 'accepted')!;
    internals(fixture).removeMember(accepted);

    const del = httpMock.expectOne('/api/v1/collections/C1/items/I-A');
    expect(del.request.method).toBe('DELETE');
    del.flush({});

    flushLoad(fixture);
  });

  // ---------------------------------------------------------------- non-owner

  it('a featured non-owner finds myItem and revokeSelf POSTs .../revoke', () => {
    // Log in as the accepted member A (not the owner).
    TestBed.inject(Auth).account.set(makeAccount(ACCEPTED));
    const fixture = setUp();
    flushLoad(fixture);

    expect(internals(fixture).isOwner()).toBe(false);
    expect(internals(fixture).myItem()?.itemId).toBe('I-A');

    internals(fixture).revokeSelf();
    const post = httpMock.expectOne('/api/v1/collections/C1/items/I-A/revoke');
    expect(post.request.method).toBe('POST');
    post.flush({});

    flushLoad(fixture);
  });

  // ---------------------------------------------------------------- add-member search

  it('search() GETs /api/v2/search for accounts', () => {
    TestBed.inject(Auth).account.set(makeAccount(OWNER));
    const fixture = setUp();
    flushLoad(fixture);

    internals(fixture).query.set('alice');
    internals(fixture).search();

    const req = httpMock.expectOne((r) => r.url === '/api/v2/search');
    expect(req.request.params.get('type')).toBe('accounts');
    req.flush({ accounts: [makeAccount('Z')], statuses: [], hashtags: [] });

    expect(
      internals(fixture)
        .results()
        .map((a) => a.id),
    ).toEqual(['Z']);
  });
});
