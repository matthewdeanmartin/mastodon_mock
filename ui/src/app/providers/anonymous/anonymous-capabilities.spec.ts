import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from '../../auth';
import { AnonymousCapabilities } from './anonymous-capabilities';

describe('AnonymousCapabilities', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('allows normal Mastodon capabilities outside Anonymous', () => {
    TestBed.inject(Auth).setToken('token');
    const capabilities = TestBed.inject(AnonymousCapabilities);

    expect(capabilities.canCompose).toBe(true);
    expect(capabilities.canManageRelationships).toBe(true);
    expect(capabilities.statusCaps('mastodon')).toEqual({
      reply: true,
      favourite: true,
      reblog: true,
    });
  });

  it('disables identity-dependent and server-mutating actions in Anonymous', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.art');
    const capabilities = TestBed.inject(AnonymousCapabilities);

    expect(capabilities.active).toBe(true);
    expect(capabilities.canCompose).toBe(false);
    expect(capabilities.canManageRelationships).toBe(false);
    expect(capabilities.canUseServerActions).toBe(false);
    expect(capabilities.canBookmark).toBe(false);
    expect(capabilities.canUseBluesky).toBe(false);
    expect(capabilities.statusCaps('mastodon')).toEqual({
      reply: false,
      favourite: false,
      reblog: false,
    });
  });
});
