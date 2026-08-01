import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '../auth';
import { SHIPPED_STARTER_KITS } from '../starter-kits';
import { StarterKitPost } from './starter-kit-post';

describe('StarterKitPost', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function render(anonymous: boolean) {
    if (anonymous) {
      TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    }
    const fixture = TestBed.createComponent(StarterKitPost);
    fixture.componentRef.setInput('kit', SHIPPED_STARTER_KITS[0]);
    fixture.detectChanges();
    return fixture;
  }

  it('shows every member and keeps the canonical collection as a secondary link', () => {
    const fixture = render(true);
    const el = fixture.nativeElement as HTMLElement;
    const kit = SHIPPED_STARTER_KITS[0];

    // Members open in-app for anonymous viewers too. They used to be off-site
    // anchors, which dropped a first-time visitor onto someone else's web UI at
    // the moment they were deciding whether to stay here.
    expect(el.querySelectorAll('button.kit-member')).toHaveLength(kit.itemCount);
    expect(el.querySelectorAll('.kit-member[href]')).toHaveLength(0);
    expect(el.querySelectorAll('app-account-hover-card')).toHaveLength(kit.itemCount);
    expect(el.querySelector('app-account-hover-card button')).toBeNull();
    expect((el.querySelector('.kit-link') as HTMLAnchorElement).getAttribute('href')).toBe(
      `/collections/preview/${kit.id}`,
    );
    expect((el.querySelector('.kit-home-link') as HTMLAnchorElement).href).toBe(kit.url);
    httpMock.expectNone((request) => request.url.includes('/api/v2/search'));
  });

  it('resolves a signed-in profile through the active server before opening it', async () => {
    const fixture = render(false);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const account = SHIPPED_STARTER_KITS[0].accounts[0];
    const button = fixture.nativeElement.querySelector('.kit-member') as HTMLButtonElement;

    button.click();
    const request = httpMock.expectOne(
      `/api/v2/search?q=${account.acct}&type=accounts&resolve=true&limit=5`,
    );
    request.flush({ accounts: [{ ...account, id: 'local-42' }], statuses: [], hashtags: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/accounts', 'local-42']);
    expect(fixture.nativeElement.querySelector('app-account-hover-card button')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Follow all');
  });
});
