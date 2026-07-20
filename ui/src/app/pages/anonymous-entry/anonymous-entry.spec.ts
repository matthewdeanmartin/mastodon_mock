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

  it('activates Anonymous and replaces the share URL with Home', () => {
    const auth = TestBed.inject(Auth);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(AnonymousEntry).detectChanges();

    expect(auth.isAnonymous).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/home', { replaceUrl: true });
  });
});
