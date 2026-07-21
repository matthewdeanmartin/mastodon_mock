import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Server } from '../server';
import { Auth } from '../auth';
import { FailWhale } from './fail-whale';

describe('FailWhale', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [FailWhale],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(FailWhale);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the generic title and no status link against the mock', () => {
    const el = render();
    expect(el.querySelector('h1')!.textContent).toContain("Can't reach the server");
    expect(el.querySelector('a')).toBeNull();
  });

  it('names the instance and links its official status page when registered', () => {
    TestBed.inject(Server).setBaseUrl('https://mastodon.social');
    const el = render();
    expect(el.querySelector('h1')!.textContent).toContain(
      'mastodon.social appears to be unavailable',
    );
    const link = el.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://status.mastodon.social/');
    expect(link.textContent).toContain('Check instance status');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('offers the labelled third-party fallback for unregistered instances', () => {
    TestBed.inject(Server).setBaseUrl('https://example.social');
    const el = render();
    httpMock.expectOne('/api/v1/instance/extended_description').flush({ content: '' });
    const link = el.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://fediverse.observer/example.social');
    expect(link.textContent).toContain('View third-party uptime information');
  });

  // ---------------------------------------------------------------- change server (anonymous)

  it('does not offer the instance picker to a non-anonymous session', () => {
    const el = render();
    expect(el.querySelector('app-server-picker')).toBeNull();
    expect(el.querySelector('.change-server')).toBeNull();
  });

  it('offers the instance picker to an anonymous session', () => {
    TestBed.inject(Auth).enterAnonymous('https://mastodon.social');
    const el = render();
    expect(el.querySelector('app-server-picker')).not.toBeNull();
    expect(el.querySelector('.change-server')!.textContent).toContain('browse a different instance');
  });

  it('picking a server moves the anonymous identity and reloads', () => {
    const auth = TestBed.inject(Auth);
    auth.enterAnonymous('https://mastodon.social');
    const fixture: ComponentFixture<FailWhale> = TestBed.createComponent(FailWhale);
    fixture.detectChanges();

    const enterSpy = vi.spyOn(auth, 'enterAnonymous');
    // Stub the reload seam so the test runner isn't navigated.
    const reloadSpy = vi
      .spyOn(fixture.componentInstance as unknown as { reload: () => void }, 'reload')
      .mockImplementation(() => undefined);

    fixture.componentInstance.onServerPicked('https://mstdn.social');

    expect(enterSpy).toHaveBeenCalledWith('https://mstdn.social');
    expect(reloadSpy).toHaveBeenCalled();
  });
});
