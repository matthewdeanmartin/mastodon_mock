import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PastepileProvider } from './pastepile-provider';

describe('PastepileProvider', () => {
  let provider: PastepileProvider;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    provider = TestBed.inject(PastepileProvider);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a paste and preserves the one-shot edit key', () => {
    let result: { editKey: string; rawUrl: string } | undefined;
    provider
      .create({
        title: 'Example',
        content: 'hello',
        language: 'plaintext',
        expiry: '10m',
        visibility: 'public',
      })
      .subscribe((created) => (result = created));

    const request = http.expectOne('https://pastepile.com/api/public/pastes');
    expect(request.request.body.visibility).toBe('public');
    request.flush({
      slug: 'abc',
      url: 'https://pastepile.com/p/abc',
      raw_url: 'https://pastepile.com/raw/abc',
      edit_key: 'edit-secret',
    });

    expect(result).toEqual({
      slug: 'abc',
      url: 'https://pastepile.com/p/abc',
      rawUrl: 'https://pastepile.com/raw/abc',
      editKey: 'edit-secret',
    });
  });

  it('updates and deletes with the edit key', () => {
    provider
      .update('abc', 'secret', { title: 'Changed', content: 'new', language: 'python' })
      .subscribe();
    const update = http.expectOne('https://pastepile.com/api/public/pastes/abc');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body.edit_key).toBe('secret');
    update.flush({ ok: true });

    provider.delete('abc', 'secret').subscribe();
    const remove = http.expectOne('https://pastepile.com/api/public/pastes/abc');
    expect(remove.request.method).toBe('DELETE');
    expect(remove.request.headers.get('X-Edit-Key')).toBe('secret');
    remove.flush({ ok: true });
  });

  it('adapts recent pastes to shared read-only statuses', () => {
    let providerId: string | undefined;
    provider.recent().subscribe((items) => (providerId = provider.status(items[0]).provider));
    http.expectOne('https://pastepile.com/api/public/pastes?limit=50').flush({
      items: [
        {
          slug: 'abc',
          title: 'Title',
          language: 'python',
          preview: '<unsafe>',
          created_at: '2026-07-24T01:00:00Z',
          url: 'https://pastepile.com/p/abc',
          raw_url: 'https://pastepile.com/raw/abc',
        },
      ],
    });

    expect(providerId).toBe('paste');
  });
});
