import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../../auth';
import { Account } from '../../models';
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

  it('resolves a clicked member and opens its internal Anonymous profile', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StarterCollection);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      accounts: readonly { name: string; handle: string }[];
      openAccount(item: { name: string; handle: string }): Promise<void>;
    };

    const opening = component.openAccount(component.accounts[0]);
    const request = httpMock.expectOne(
      (candidate) => candidate.url === 'https://mastodon.social/api/v2/search',
    );
    expect(request.request.params.get('q')).toBe('Gargron');
    expect(request.request.params.get('type')).toBe('accounts');
    request.flush({
      accounts: [
        {
          id: '1',
          username: 'Gargron',
          acct: 'Gargron',
          url: 'https://mastodon.social/@Gargron',
        } as Account,
      ],
      statuses: [],
      hashtags: [],
    });
    await opening;

    expect(navigate).toHaveBeenCalledWith([
      '/accounts',
      expect.stringMatching(/^anonymous-account\./),
    ]);
  });
});
