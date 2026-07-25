import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { IsgdProvider } from './isgd-provider';
import { PasteCreated } from './paste-provider';

const INPUT = {
  title: '',
  content: 'why did the chicken cross the road?',
  language: 'plaintext',
  expiry: 'never',
  visibility: 'unlisted',
} as const;

describe('IsgdProvider', () => {
  function setup(): [IsgdProvider, HttpTestingController] {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return [TestBed.inject(IsgdProvider), TestBed.inject(HttpTestingController)];
  }

  it('shortens the message URL via is.gd and returns the short link', () => {
    const [provider, http] = setup();
    let result: PasteCreated | undefined;

    provider.create(INPUT).subscribe((created) => (result = created));

    const request = http.expectOne((r) => r.url === 'https://is.gd/create.php');
    expect(request.request.params.get('format')).toBe('json');
    const target = request.request.params.get('url')!;
    expect(target).toContain('/message/');
    // The message body survives the round-trip through the target URL's params.
    expect(new URL(target).searchParams.get('m')).toBe('why did the chicken cross the road?');
    request.flush({ shorturl: 'https://is.gd/q7x9eD' });

    expect(result?.url).toBe('https://is.gd/q7x9eD');
    expect(result?.slug).toBe('q7x9eD');
    expect(result?.rawUrl).toContain('/message/');
    expect(result?.editKey).toBe('');
    http.verify();
  });

  it('falls back to v.gd when is.gd fails', () => {
    const [provider, http] = setup();
    let result: PasteCreated | undefined;

    provider.create(INPUT).subscribe((created) => (result = created));

    // is.gd returns an API error (HTTP 200 but no shorturl) -> should retry v.gd.
    http
      .expectOne((r) => r.url === 'https://is.gd/create.php')
      .flush({ errorcode: 1, errormessage: 'Error, database insert failed' });

    const fallback = http.expectOne((r) => r.url === 'https://v.gd/create.php');
    fallback.flush({ shorturl: 'https://v.gd/abc123' });

    expect(result?.url).toBe('https://v.gd/abc123');
    expect(result?.slug).toBe('abc123');
    http.verify();
  });

  it('errors when both services fail', () => {
    const [provider, http] = setup();
    let message = '';

    provider.create(INPUT).subscribe({ error: (e: Error) => (message = e.message) });

    http
      .expectOne((r) => r.url === 'https://is.gd/create.php')
      .flush({ errormessage: 'throttled' });
    http.expectOne((r) => r.url === 'https://v.gd/create.php').flush({ errormessage: 'throttled' });

    expect(message).toBe('throttled');
    http.verify();
  });

  it('rejects edit and delete as unsupported', () => {
    const [provider, http] = setup();
    let editError = '';
    let deleteError = '';

    provider
      .update('x', '', { title: '', content: 'y', language: 'plaintext' })
      .subscribe({ error: (e: Error) => (editError = e.message) });
    provider.delete('x', '').subscribe({ error: (e: Error) => (deleteError = e.message) });

    expect(editError).toContain('cannot be edited');
    expect(deleteError).toContain('cannot be deleted');
    http.verify();
  });
});
