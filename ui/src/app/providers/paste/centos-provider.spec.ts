import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CentosPasteKey } from './centos-key';
import { CentosProvider } from './centos-provider';
import { PasteRecentItem } from './paste-provider';

const RECENT = 'https://paste.centos.org/api/recent';
const CREATE = 'https://paste.centos.org/api/create';

describe('CentosProvider', () => {
  let provider: CentosProvider;
  let keyStore: CentosPasteKey;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    provider = TestBed.inject(CentosProvider);
    keyStore = TestBed.inject(CentosPasteKey);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('without an API key', () => {
    it('refuses to list recent pastes, and makes no request', () => {
      const out: { error?: Error } = {};
      provider.recent().subscribe({ error: (err: Error) => (out.error = err) });

      // The service rejects anonymous callers outright, so spending a request
      // (and a proxy quota unit) to be told so is pure waste.
      http.expectNone(() => true);
      expect(out.error?.message).toContain('needs an API key');
    });

    it('refuses to create a paste', () => {
      const out: { error?: Error } = {};
      provider
        .create({
          title: 't',
          content: 'c',
          language: 'text',
          expiry: 'never',
          visibility: 'public',
        })
        .subscribe({ error: (err: Error) => (out.error = err) });

      http.expectNone(() => true);
      expect(out.error?.message).toContain('needs an API key');
    });

    it('reports that it needs a key', () => {
      expect(provider.hasKey()).toBe(false);
    });
  });

  describe('with an API key', () => {
    beforeEach(() => keyStore.connect('secret-key'));

    it('sends the key on the recent request', () => {
      let items: PasteRecentItem[] | undefined;
      provider.recent().subscribe((result) => (items = result));

      const request = http.expectOne((r) => r.url.startsWith(RECENT));
      expect(request.request.urlWithParams).toContain('apikey=secret-key');
      request.flush([
        {
          title: 'kickstart',
          name: 'anon',
          created: '1753900000',
          lang: 'bash',
          url: 'https://paste.centos.org/view/abc123',
        },
      ]);

      expect(items).toHaveLength(1);
      expect(items?.[0].slug).toBe('abc123');
      expect(items?.[0].language).toBe('bash');
    });

    it('converts Stikked unix timestamps into ISO dates', () => {
      let items: PasteRecentItem[] | undefined;
      provider.recent().subscribe((result) => (items = result));
      http
        .expectOne((r) => r.url.startsWith(RECENT))
        .flush([{ created: 1753900000, url: 'https://paste.centos.org/view/abc' }]);

      expect(items?.[0].createdAt).toBe(new Date(1753900000 * 1000).toISOString());
    });

    it('never emits an invalid date for an unparseable timestamp', () => {
      // A NaN date sorts unpredictably and would scatter the feed through the
      // timeline; falling back to "now" keeps the ordering sane.
      let items: PasteRecentItem[] | undefined;
      provider.recent().subscribe((result) => (items = result));
      http
        .expectOne((r) => r.url.startsWith(RECENT))
        .flush([{ created: 'not-a-date', url: 'https://paste.centos.org/view/abc' }]);

      expect(Number.isNaN(Date.parse(items![0].createdAt))).toBe(false);
    });

    it('treats a non-array body as a rejected key', () => {
      // Stikked answers "Invalid API key" with a 200, so the status code alone
      // cannot distinguish success from refusal.
      const out: { error?: Error } = {};
      provider.recent().subscribe({ error: (err: Error) => (out.error = err) });
      http.expectOne((r) => r.url.startsWith(RECENT)).flush('Invalid API key');

      expect(out.error?.message).toContain('API key may be wrong');
    });

    it('posts a form-encoded create with the key and expiry in minutes', () => {
      let created: { slug: string; url: string } | undefined;
      provider
        .create({
          title: 'my paste',
          content: 'hello',
          language: 'python',
          expiry: '1h',
          visibility: 'public',
        })
        .subscribe((result) => (created = result));

      const request = http.expectOne(CREATE);
      const body = request.request.body as string;
      expect(body).toContain('apikey=secret-key');
      expect(body).toContain('lang=python');
      expect(body).toContain('expire=60');
      request.flush('https://paste.centos.org/view/xyz789');

      expect(created?.slug).toBe('xyz789');
      expect(created?.url).toBe('https://paste.centos.org/view/xyz789');
    });

    it('marks an unlisted paste private', () => {
      provider
        .create({
          title: '',
          content: 'hello',
          language: 'text',
          expiry: 'never',
          visibility: 'unlisted',
        })
        .subscribe({ error: () => undefined });

      const request = http.expectOne(CREATE);
      expect(request.request.body as string).toContain('private=1');
      request.flush('https://paste.centos.org/view/xyz');
    });

    it('treats a 200 that is not a URL as a failure', () => {
      const out: { error?: Error } = {};
      provider
        .create({
          title: '',
          content: '',
          language: 'text',
          expiry: 'never',
          visibility: 'public',
        })
        .subscribe({ error: (err: Error) => (out.error = err) });

      http.expectOne(CREATE).flush('Error: Missing paste text');

      expect(out.error?.message).toBe('Error: Missing paste text');
    });

    it('reports having a key', () => {
      expect(provider.hasKey()).toBe(true);
    });
  });
});
