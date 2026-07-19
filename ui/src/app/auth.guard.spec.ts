import { TestBed } from '@angular/core/testing';
import { provideRouter, UrlTree } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { Auth } from './auth';
import { authGuard } from './auth.guard';
import { Server } from './server';

describe('authGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [Auth, Server, provideRouter([])],
    });
  });

  it('returns true when the user is authenticated', () => {
    const auth = TestBed.inject(Auth);
    auth.setToken('test-token');

    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('returns true for the local Anonymous account', () => {
    const auth = TestBed.inject(Auth);
    auth.enterAnonymous('https://mastodon.social');

    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('returns a UrlTree for /login when not authenticated', () => {
    // Ensure no token is set (localStorage cleared in beforeEach)
    const auth = TestBed.inject(Auth);
    auth.logoutAll();

    const result = TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));

    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).toString()).toBe('/login');
  });
});
