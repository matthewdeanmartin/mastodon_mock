import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AnonymousAccount } from './anonymous-account';

describe('AnonymousAccount', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [AnonymousAccount] });
  });

  it('creates one local identity for the selected home instance', () => {
    const anonymous = TestBed.inject(AnonymousAccount);

    anonymous.activate('https://mastodon.art/');

    expect(anonymous.server()).toBe('https://mastodon.art');
    expect(anonymous.account().display_name).toBe('Anonymous');
    expect(anonymous.account().username).toBe('mastodon.art');
    expect(anonymous.account().id).toBe('anonymous');
  });

  it('retains customized identity fields when its home instance changes', () => {
    const anonymous = TestBed.inject(AnonymousAccount);
    anonymous.activate('https://mastodon.social');
    anonymous.updateAccount({ ...anonymous.account(), display_name: 'Incognito Reader' });

    anonymous.activate('https://hachyderm.io');

    expect(anonymous.server()).toBe('https://hachyderm.io');
    expect(anonymous.account().display_name).toBe('Incognito Reader');
    expect(anonymous.account().username).toBe('hachyderm.io');
  });

  it('recovers from malformed persisted state', () => {
    localStorage.setItem('mockingbird_anonymous_account', '{bad json');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [AnonymousAccount] });

    const anonymous = TestBed.inject(AnonymousAccount);

    expect(anonymous.account().display_name).toBe('Anonymous');
    expect(anonymous.server()).toBe('https://mastodon.social');
  });
});
