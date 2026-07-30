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

  it('loads muted accounts for kind=mutes', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/mutes').flush([makeAccount('1')]);
    expect(internals(fixture).accounts().length).toBe(1);
  });

  it('offers the amnesty matching the list it is showing', () => {
    configure('blocks');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/blocks').flush([makeAccount('1')]);

    expect(internals(fixture).amnestyAction()).toBe('block-amnesty');
    expect(internals(fixture).amnestyLabel()).toBe('Unblock everyone');
  });

  it('asks before running an amnesty, and issues no request until confirmed', () => {
    configure('mutes');
    const fixture = TestBed.createComponent(SettingsAccountList);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/mutes').flush([makeAccount('1')]);

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
    httpMock.expectOne('/api/v1/blocks').flush([acc]);

    internals(fixture).undo(acc);
    const req = httpMock.expectOne('/api/v1/accounts/9/unblock');
    expect(req.request.method).toBe('POST');
    req.flush({});
    expect(internals(fixture).accounts()).toEqual([]);
  });
});
