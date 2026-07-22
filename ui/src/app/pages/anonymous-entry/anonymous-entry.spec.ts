import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
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

  it('uses a bare query key as the first anonymous server', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: { keys: ['hachyderm.io'] } } },
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ title: 'Hachyderm' }) });
    vi.stubGlobal('fetch', fetchSpy);
    const auth = TestBed.inject(Auth);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(AnonymousEntry).detectChanges();

    await vi.waitFor(() => expect(auth.isAnonymous).toBe(true));
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hachyderm.io/api/v1/instance',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
