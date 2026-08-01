import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { Account } from '../../../models';
import { SettingsAccountList } from './settings-account-list';

interface SettingsAccountListInternals {
  kind: WritableSignal<'mutes' | 'blocks'>;
  accounts: WritableSignal<Account[]>;
  undo(acc: Account): void;
  amnestyAction(): string;
  amnestyLabel(): string;
  asking: WritableSignal<boolean>;
  askAmnesty(): void;
  page: WritableSignal<number>;
  lastPage(): number | null;
  canNext(): boolean;
  canPrev(): boolean;
  next(): void;
  prev(): void;
  last(): void;
  first(): void;
  isAlsoOther(id: string): boolean;
  alsoApply(acc: Account): void;
  convert(acc: Account): void;
}

function internals(fixture: ComponentFixture<SettingsAccountList>): SettingsAccountListInternals {
  return fixture.componentInstance as unknown as SettingsAccountListInternals;
}

function makeAccount(id: string): Account {
  return {
    id,
    username: `user${id}`,
    acct: `user${id}`,
    display_name: `User ${id}`,
    note: '',
    url: '',
    avatar: '',
    avatar_static: '',
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: 0,
    bot: false,
    locked: false,
    fields: [],
  };
}

describe('SettingsAccountList', () => {
  let httpMock: HttpTestingController;

  function configure(kind: 'mutes' | 'blocks'): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { data: of({ kind }) } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    httpMock.verify();
  });

  /**
   * Settle one page fetch and the `/relationships` lookup that follows it.
   *
   * Every page asks, in one call for the whole page, which of these accounts is
   * on the *other* list too — that is what the row badge reads. `nextMaxId` adds
   * the `Link` header the pager walks; omitting it means "this is the last page".
   */
  function flushPage(
    accounts: Account[],
    nextMaxId?: string,
    alsoOther: string[] = [],
    options: { expectRelationships?: boolean } = {},
  ): void {
    const req = httpMock.expectOne((r) => r.url === '/api/v1/mutes' || r.url === '/api/v1/blocks');
    req.flush(
      accounts,
      nextMaxId
        ? { headers: { Link: `</api/v1/mutes?max_id=${nextMaxId}>; rel="next"` } }
        : undefined,
    );
    // Pages walked past on the way to "Last" are never displayed, so they ask
    // nothing about relationships — only the page that lands does.
    if (!accounts.length || options.expectRelationships === false) {
      return;
    }
    httpMock
      .expectOne((r) => r.url === '/api/v1/accounts/relationships')
      .flush(
        accounts.map((a) => ({
          id: a.id,
          muting: alsoOther.includes(a.id),
          blocking: alsoOther.includes(a.id),
        })),
      );
  }

  it('loads muted accounts for kind=mutes', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    flushPage([makeAccount('1')]);
    expect(internals(fixture).accounts().length).toBe(1);
  });

  it('offers the amnesty matching the list it is showing', () => {
    configure('blocks');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    flushPage([makeAccount('1')]);

    expect(internals(fixture).amnestyAction()).toBe('block-amnesty');
    expect(internals(fixture).amnestyLabel()).toBe('Unblock everyone');
  });

  it('asks before running an amnesty, and issues no request until confirmed', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    flushPage([makeAccount('1')]);

    internals(fixture).askAmnesty();
    fixture.detectChanges();

    expect(internals(fixture).asking()).toBe(true);
    // The point of the dialog: opening it changes nothing. Any reads the
    // preview makes are fine; a write would not be.
    expect(httpMock.match((r) => r.method === 'POST')).toEqual([]);
    for (const read of httpMock.match(() => true)) {
      read.flush([]);
    }
  });

  it('unblocks and removes the row for kind=blocks', () => {
    configure('blocks');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    const acc = makeAccount('9');
    flushPage([acc]);

    internals(fixture).undo(acc);
    const req = httpMock.expectOne('/api/v1/accounts/9/unblock');
    expect(req.request.method).toBe('POST');
    req.flush({});
    expect(internals(fixture).accounts()).toEqual([]);
  });

  // ------------------------------------------------------------------ paging
  // The bug this replaced: the page rendered whatever the first unpaginated read
  // returned (40) while amnesty walked every page and reported 280. Accounts 41
  // onward were unreachable.

  it('pages forward with the Link cursor and stops when it runs out', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    flushPage([makeAccount('1')], 'rel-40');

    // A `rel="next"` means there is more, so Next is live and the end is unknown.
    expect(internals(fixture).canNext()).toBe(true);
    expect(internals(fixture).lastPage()).toBeNull();

    internals(fixture).next();
    flushPage([makeAccount('2')]);

    expect(internals(fixture).page()).toBe(1);
    expect(internals(fixture).accounts().map((a) => a.id)).toEqual(['2']);
    // No Link on that page: this is the end, and Next must go dead.
    expect(internals(fixture).lastPage()).toBe(1);
    expect(internals(fixture).canNext()).toBe(false);
  });

  it('serves an already-seen page from cache instead of re-fetching', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    flushPage([makeAccount('1')], 'rel-40');
    internals(fixture).next();
    flushPage([makeAccount('2')]);

    internals(fixture).prev();

    // Page 1 came back with no request at all — the microcache doing its job,
    // which is what keeps clicking through a 280-entry list from pounding the
    // server on every Prev.
    expect(internals(fixture).page()).toBe(0);
    expect(internals(fixture).accounts().map((a) => a.id)).toEqual(['1']);
    httpMock.verify();
  });

  it('walks to the end for Last, because Link pagination has no random access', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    flushPage([makeAccount('1')], 'rel-40');

    internals(fixture).last();
    // Page 2 is fetched on the way past — walked over, never shown, so it asks
    // nothing about relationships. Page 3 ends the walk and is the one displayed.
    flushPage([makeAccount('2')], 'rel-80', [], { expectRelationships: false });
    flushPage([makeAccount('3')]);

    expect(internals(fixture).page()).toBe(2);
    expect(internals(fixture).accounts().map((a) => a.id)).toEqual(['3']);
  });

  // ------------------------------------------------- convert / also-apply
  // Converting a mute to a block is a decision you cannot make without knowing
  // whether the block already exists, so the row carries both the badge and the
  // two escalations.

  it('flags rows that are on the other list too', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    flushPage([makeAccount('1'), makeAccount('2')], undefined, ['2']);

    expect(internals(fixture).isAlsoOther('1')).toBe(false);
    expect(internals(fixture).isAlsoOther('2')).toBe(true);
  });

  it('also-block keeps the mute, so the row stays put and gains the badge', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    const acc = makeAccount('7');
    flushPage([acc]);

    internals(fixture).alsoApply(acc);
    httpMock.expectOne('/api/v1/accounts/7/block').flush({});

    // No unmute: "block them as well" means both restrictions, not a swap.
    expect(internals(fixture).accounts().map((a) => a.id)).toEqual(['7']);
    expect(internals(fixture).isAlsoOther('7')).toBe(true);
  });

  it('convert blocks first and only then unmutes, so a failure leaves them restricted', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    const acc = makeAccount('7');
    flushPage([acc]);

    internals(fixture).convert(acc);

    // Block goes out first and the mute is still in place until it succeeds.
    httpMock.expectOne('/api/v1/accounts/7/block').flush({});
    expect(internals(fixture).accounts().map((a) => a.id)).toEqual(['7']);

    httpMock.expectOne('/api/v1/accounts/7/unmute').flush({});
    expect(internals(fixture).accounts()).toEqual([]);
  });

  it('convert skips the block when they are already blocked', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    const acc = makeAccount('7');
    flushPage([acc], undefined, ['7']);

    internals(fixture).convert(acc);

    // Nothing to add — only the mute needs lifting.
    httpMock.expectOne('/api/v1/accounts/7/unmute').flush({});
    expect(internals(fixture).accounts()).toEqual([]);
  });
});
