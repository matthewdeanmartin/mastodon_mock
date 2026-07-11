import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account, AccountField } from '../../models';
import { Settings } from './settings';

type Tab = 'profile' | 'mutes' | 'blocks' | 'requests';

interface SettingsInternals {
  tab: WritableSignal<Tab>;
  displayName: WritableSignal<string>;
  note: WritableSignal<string>;
  locked: WritableSignal<boolean>;
  bot: WritableSignal<boolean>;
  fields: WritableSignal<AccountField[]>;
  saving: WritableSignal<boolean>;
  saved: WritableSignal<boolean>;
  mutes: WritableSignal<Account[]>;
  blocks: WritableSignal<Account[]>;
  requests: WritableSignal<Account[]>;
  listLoading: WritableSignal<boolean>;
  setTab(tab: Tab): void;
  setField(index: number, key: 'name' | 'value', value: string): void;
  addField(): void;
  removeField(index: number): void;
  saveProfile(): void;
  unmute(acc: Account): void;
  unblock(acc: Account): void;
  authorize(acc: Account): void;
  reject(acc: Account): void;
}

function internals(fixture: ComponentFixture<Settings>): SettingsInternals {
  return fixture.componentInstance as unknown as SettingsInternals;
}

function makeAccount(id: string, display_name = `User ${id}`): Account {
  return {
    id, username: `user${id}`, acct: `user${id}`, display_name, note: '', url: '',
    avatar: '', avatar_static: '', header: '', followers_count: 0, following_count: 0,
    statuses_count: 0, bot: false, locked: false, fields: [],
  };
}

function makeCredentials(overrides: Partial<Account> = {}): Account {
  return {
    ...makeAccount('1'),
    display_name: 'Alice',
    note: '<p>Hi</p>',
    locked: false,
    bot: false,
    fields: [{ name: 'Website', value: 'https://alice.example' }],
    source: { privacy: 'public', sensitive: false, language: null, note: 'Hi plain', fields: [{ name: 'Website', value: 'https://alice.example' }] },
    ...overrides,
  };
}

describe('Settings', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function setUp(credentials = makeCredentials()): ComponentFixture<Settings> {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/accounts/verify_credentials').flush(credentials);
    return fixture;
  }

  // ---------------------------------------------------------------- initial load

  it('seeds form fields from verify_credentials on init', () => {
    const fixture = setUp(makeCredentials({ display_name: 'Alice', locked: true, bot: false }));

    expect(internals(fixture).displayName()).toBe('Alice');
    expect(internals(fixture).locked()).toBe(true);
    expect(internals(fixture).bot()).toBe(false);
  });

  it('seeds note from source.note when available', () => {
    const fixture = setUp(makeCredentials({ source: { privacy: 'public', sensitive: false, language: null, note: 'Source note', fields: [] } }));
    expect(internals(fixture).note()).toBe('Source note');
  });

  it('falls back to account.note when source is absent', () => {
    const account = makeCredentials();
    delete (account as { source?: unknown }).source;
    account.note = 'Fallback note';
    const fixture = setUp(account);
    expect(internals(fixture).note()).toBe('Fallback note');
  });

  it('seeds fields from source.fields', () => {
    const fixture = setUp();
    expect(internals(fixture).fields()).toHaveLength(1);
    expect(internals(fixture).fields()[0].name).toBe('Website');
  });

  it('provides an empty field row when no fields exist', () => {
    const acct = makeCredentials({ source: { privacy: 'public', sensitive: false, language: null, note: '', fields: [] } });
    const fixture = setUp(acct);
    // Should provide one empty row.
    expect(internals(fixture).fields()).toEqual([{ name: '', value: '' }]);
  });

  // ---------------------------------------------------------------- setTab / lazy loading

  it('setTab: switches the active tab', () => {
    const fixture = setUp();
    internals(fixture).setTab('mutes');
    expect(internals(fixture).tab()).toBe('mutes');
  });

  it('setTab("mutes"): loads mutes list when not yet loaded', () => {
    const fixture = setUp();
    internals(fixture).setTab('mutes');

    const req = httpMock.expectOne('/api/v1/mutes');
    req.flush([makeAccount('2')]);

    expect(internals(fixture).mutes()).toHaveLength(1);
    expect(internals(fixture).listLoading()).toBe(false);
  });

  it('setTab("mutes"): does NOT reload when mutes are already loaded', () => {
    const fixture = setUp();
    internals(fixture).mutes.set([makeAccount('2')]);
    internals(fixture).setTab('mutes');

    // No request should be made.
    httpMock.expectNone('/api/v1/mutes');
  });

  it('setTab("blocks"): loads blocks list when not yet loaded', () => {
    const fixture = setUp();
    internals(fixture).setTab('blocks');

    const req = httpMock.expectOne('/api/v1/blocks');
    req.flush([makeAccount('3')]);
    expect(internals(fixture).blocks()).toHaveLength(1);
  });

  it('setTab("requests"): loads follow requests when not yet loaded', () => {
    const fixture = setUp();
    internals(fixture).setTab('requests');

    const req = httpMock.expectOne('/api/v1/follow_requests');
    req.flush([makeAccount('4')]);
    expect(internals(fixture).requests()).toHaveLength(1);
  });

  it('listLoading clears on list HTTP error', () => {
    const fixture = setUp();
    internals(fixture).setTab('mutes');
    httpMock.expectOne('/api/v1/mutes').flush('', { status: 500, statusText: 'Error' });
    expect(internals(fixture).listLoading()).toBe(false);
  });

  // ---------------------------------------------------------------- field management

  it('setField: updates name/value at the correct index', () => {
    const fixture = setUp();
    internals(fixture).fields.set([{ name: 'A', value: '1' }, { name: 'B', value: '2' }]);
    internals(fixture).setField(0, 'value', 'updated');
    expect(internals(fixture).fields()[0].value).toBe('updated');
    expect(internals(fixture).fields()[1].value).toBe('2'); // unchanged
  });

  it('addField: appends an empty field', () => {
    const fixture = setUp();
    internals(fixture).fields.set([{ name: 'A', value: '1' }]);
    internals(fixture).addField();
    expect(internals(fixture).fields()).toHaveLength(2);
    expect(internals(fixture).fields()[1]).toEqual({ name: '', value: '' });
  });

  it('addField: does nothing when 4 fields already exist', () => {
    const fixture = setUp();
    internals(fixture).fields.set([
      { name: 'A', value: '1' }, { name: 'B', value: '2' },
      { name: 'C', value: '3' }, { name: 'D', value: '4' },
    ]);
    internals(fixture).addField();
    expect(internals(fixture).fields()).toHaveLength(4);
  });

  it('removeField: removes the field at the given index', () => {
    const fixture = setUp();
    internals(fixture).fields.set([{ name: 'A', value: '1' }, { name: 'B', value: '2' }, { name: 'C', value: '3' }]);
    internals(fixture).removeField(1);
    expect(internals(fixture).fields().map((f) => f.name)).toEqual(['A', 'C']);
  });

  // ---------------------------------------------------------------- saveProfile

  it('saveProfile: PATCHes /api/v1/accounts/update_credentials and sets saved', () => {
    const fixture = setUp();
    internals(fixture).displayName.set('New Name');
    internals(fixture).saveProfile();

    const req = httpMock.expectOne('/api/v1/accounts/update_credentials');
    expect(req.request.method).toBe('PATCH');
    req.flush(makeAccount('1', 'New Name'));

    expect(internals(fixture).saved()).toBe(true);
    expect(internals(fixture).saving()).toBe(false);
  });

  it('saveProfile: does nothing if already saving', () => {
    const fixture = setUp();
    internals(fixture).saving.set(true);
    internals(fixture).saveProfile();
    httpMock.expectNone('/api/v1/accounts/update_credentials');
  });

  it('saveProfile: clears saving on HTTP error', () => {
    const fixture = setUp();
    internals(fixture).saveProfile();
    httpMock.expectOne('/api/v1/accounts/update_credentials').flush('', { status: 422, statusText: 'Unprocessable' });
    expect(internals(fixture).saving()).toBe(false);
  });

  // ---------------------------------------------------------------- unmute / unblock / authorize / reject

  it('unmute: DELETEs and removes the account from mutes list', () => {
    const fixture = setUp();
    const acc = makeAccount('2');
    internals(fixture).mutes.set([acc, makeAccount('3')]);
    internals(fixture).unmute(acc);

    const req = httpMock.expectOne('/api/v1/accounts/2/unmute');
    expect(req.request.method).toBe('POST');
    req.flush({});

    expect(internals(fixture).mutes().map((a) => a.id)).toEqual(['3']);
  });

  it('unblock: POSTs and removes the account from blocks list', () => {
    const fixture = setUp();
    const acc = makeAccount('5');
    internals(fixture).blocks.set([acc]);
    internals(fixture).unblock(acc);

    const req = httpMock.expectOne('/api/v1/accounts/5/unblock');
    req.flush({});

    expect(internals(fixture).blocks()).toEqual([]);
  });

  it('authorize: POSTs and removes from follow requests', () => {
    const fixture = setUp();
    const acc = makeAccount('6');
    internals(fixture).requests.set([acc, makeAccount('7')]);
    internals(fixture).authorize(acc);

    const req = httpMock.expectOne('/api/v1/follow_requests/6/authorize');
    req.flush({});

    expect(internals(fixture).requests().map((a) => a.id)).toEqual(['7']);
  });

  it('reject: POSTs and removes from follow requests', () => {
    const fixture = setUp();
    const acc = makeAccount('8');
    internals(fixture).requests.set([acc]);
    internals(fixture).reject(acc);

    const req = httpMock.expectOne('/api/v1/follow_requests/8/reject');
    req.flush({});

    expect(internals(fixture).requests()).toEqual([]);
  });
});
