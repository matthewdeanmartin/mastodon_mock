import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../../models';
import { SettingsFollows } from './settings-follows';

interface SettingsFollowsInternals {
  requests: WritableSignal<Account[]>;
  authorize(acc: Account): void;
  reject(acc: Account): void;
}

function internals(fixture: ComponentFixture<SettingsFollows>): SettingsFollowsInternals {
  return fixture.componentInstance as unknown as SettingsFollowsInternals;
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

describe('SettingsFollows', () => {
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

  function setUp(accounts: Account[]): ComponentFixture<SettingsFollows> {
    const fixture = TestBed.createComponent(SettingsFollows);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/follow_requests').flush(accounts);
    return fixture;
  }

  it('loads pending follow requests', () => {
    const fixture = setUp([makeAccount('1'), makeAccount('2')]);
    expect(internals(fixture).requests().length).toBe(2);
  });

  it('accepting a request removes the row', () => {
    const acc = makeAccount('5');
    const fixture = setUp([acc]);
    internals(fixture).authorize(acc);
    const req = httpMock.expectOne('/api/v1/follow_requests/5/authorize');
    expect(req.request.method).toBe('POST');
    req.flush({});
    expect(internals(fixture).requests()).toEqual([]);
  });
});
