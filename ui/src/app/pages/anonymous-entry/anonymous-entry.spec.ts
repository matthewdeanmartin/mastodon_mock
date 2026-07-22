import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { AnonymousEntry } from './anonymous-entry';

describe('AnonymousEntry', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('activates Anonymous and replaces the share URL with Home when the default is reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ title: 'Mastodon' }) }),
    );
    const auth = TestBed.inject(Auth);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(AnonymousEntry).detectChanges();

    await vi.waitFor(() => expect(auth.isAnonymous).toBe(true));
    expect(navigate).toHaveBeenCalledWith('/home', { replaceUrl: true });
  });

  it('sends a fresh browser to login when the default server is blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blocked')));
    const auth = TestBed.inject(Auth);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(AnonymousEntry).detectChanges();

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true }));
    expect(auth.isAuthenticated).toBe(false);
  });
});
