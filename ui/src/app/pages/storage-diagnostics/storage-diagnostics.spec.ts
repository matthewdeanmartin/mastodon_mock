import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageDiagnostics } from './storage-diagnostics';

describe('StorageDiagnostics', () => {
  let fixture: ComponentFixture<StorageDiagnostics>;

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('mockingbird_rss_feeds', JSON.stringify(['a', 'b']));
    localStorage.setItem('mastodon_mock_token', 'alan_token');
    TestBed.configureTestingModule({
      imports: [StorageDiagnostics],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(StorageDiagnostics);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('lists every localStorage key with its size', () => {
    expect(text()).toContain('mockingbird_rss_feeds');
    expect(text()).toContain('mastodon_mock_token');
  });

  it('labels known keys, so the list is not just opaque slugs', () => {
    const component = fixture.componentInstance;
    expect(component.keyNote('mockingbird_api_metrics:https%3A%2F%2Fx.test')).toBe('API metrics');
    expect(component.keyNote('mockingbird_route_log')).toBe('route log');
    expect(component.keyNote('mastodon_mock_token')).toBe('session');
    expect(component.keyNote('something_else')).toBe('');
  });

  it('deletes a key only after the confirmation is accepted', () => {
    const component = fixture.componentInstance;
    const entry = { key: 'mockingbird_rss_feeds', bytes: 10, valueChars: 10 };

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    component.deleteKey(entry);
    expect(localStorage.getItem('mockingbird_rss_feeds')).not.toBeNull();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    component.deleteKey(entry);
    expect(localStorage.getItem('mockingbird_rss_feeds')).toBeNull();
  });

  it('re-scans on refresh, so a key deleted elsewhere disappears', () => {
    const component = fixture.componentInstance;
    const before = component['storage']().entries.length;
    localStorage.removeItem('mastodon_mock_token');
    component.refreshStorage();
    expect(component['storage']().entries.length).toBe(before - 1);
  });

  it('links back to Observability', () => {
    const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
      'a[href="/observability"]',
    );
    expect(link).not.toBeNull();
  });
});
