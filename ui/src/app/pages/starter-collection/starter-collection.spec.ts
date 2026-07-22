import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { StarterCollection } from './starter-collection';

describe('StarterCollection', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('opens a clicked member from the built-in Anonymous account snapshot', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StarterCollection);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      accounts: readonly { name: string; handle: string }[];
      openAccount(item: { name: string; handle: string }): Promise<void>;
    };

    const opening = component.openAccount(component.accounts[0]);
    await opening;

    httpMock.expectNone((candidate) => candidate.url.includes('/api/v2/search'));

    expect(navigate).toHaveBeenCalledWith([
      '/accounts',
      expect.stringMatching(/^anonymous-account\./),
    ]);
  });
});
