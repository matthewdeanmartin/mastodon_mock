import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server } from '../server';
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
});
