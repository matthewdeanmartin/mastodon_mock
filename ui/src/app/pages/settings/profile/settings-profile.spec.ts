import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account, AccountField } from '../../../models';
import { Auth } from '../../../auth';
import { SettingsProfile } from './settings-profile';

interface SettingsProfileInternals {
  displayName: WritableSignal<string>;
  username: WritableSignal<string>;
  note: WritableSignal<string>;
  fields: WritableSignal<AccountField[]>;
  saving: WritableSignal<boolean>;
  saved: WritableSignal<boolean>;
  saveProfile(): void;
}

function internals(fixture: ComponentFixture<SettingsProfile>): SettingsProfileInternals {
  return fixture.componentInstance as unknown as SettingsProfileInternals;
}

function makeAccount(): Account {
  return {
    id: '1',
    username: 'alice',
    acct: 'alice',
    display_name: 'Alice',
    note: 'plain note',
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
    source: {
      privacy: 'public',
      sensitive: false,
      language: null,
      note: 'source note',
      fields: [{ name: 'Web', value: 'example.com' }],
    },
  };
}

describe('SettingsProfile', () => {
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

  function setUp(): ComponentFixture<SettingsProfile> {
    const fixture = TestBed.createComponent(SettingsProfile);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/accounts/verify_credentials').flush(makeAccount());
    return fixture;
  }

  it('loads the profile from source fields', () => {
    const fixture = setUp();
    const c = internals(fixture);
    expect(c.displayName()).toBe('Alice');
    expect(c.note()).toBe('source note');
    expect(c.fields()).toEqual([{ name: 'Web', value: 'example.com' }]);
  });

  it('saves via PATCH update_credentials with form data', () => {
    const fixture = setUp();
    const c = internals(fixture);
    c.displayName.set('Alice B.');
    c.saveProfile();

    const req = httpMock.expectOne('/api/v1/accounts/update_credentials');
    expect(req.request.method).toBe('PATCH');
    const body = req.request.body as FormData;
    expect(body.get('display_name')).toBe('Alice B.');
    req.flush(makeAccount());
    expect(c.saved()).toBe(true);
    expect(c.saving()).toBe(false);
  });

  it('loads and saves Anonymous profiles locally without authenticated API calls', async () => {
    const auth = TestBed.inject(Auth);
    auth.enterAnonymous('https://mastodon.art');
    const fixture = TestBed.createComponent(SettingsProfile);
    fixture.detectChanges();
    const c = internals(fixture);

    expect(c.displayName()).toBe('Anonymous');
    expect(c.username()).toBe('mastodon.art');
    c.displayName.set('Demo Demoson');
    c.username.set('demo');
    c.note.set('Local profile');
    c.saveProfile();
    await fixture.whenStable();

    expect(auth.account()?.display_name).toBe('Demo Demoson');
    expect(auth.account()?.username).toBe('demo');
    expect(c.saved()).toBe(true);
    expect(c.saving()).toBe(false);
  });
});
