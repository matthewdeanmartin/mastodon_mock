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

  it('gives Anonymous users static profile previews and the canonical collection', () => {
    const fixture = render(true);
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('.kit-member[href]')).toHaveLength(5);
    expect(el.querySelectorAll('app-account-hover-card')).toHaveLength(5);
    expect(el.querySelector('app-account-hover-card button')).toBeNull();
    expect(el.textContent).not.toContain('Follow first 5');
    expect((el.querySelector('.kit-link') as HTMLAnchorElement).href).toBe(
      SHIPPED_STARTER_KITS[0].url,
    );
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
    expect(fixture.nativeElement.textContent).toContain('Follow first 5');
  });
});
