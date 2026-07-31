import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CorsProxySettings } from '../cors-proxy/cors-proxy-settings';
import { IsgdProvider } from './isgd-provider';
import { ShortenerProxyConsent } from './proxy-consent';
import { LinkProviderError } from './shortener-errors';
import { ShortenerSettings } from './shortener-settings';
import { TinyurlShortenerProvider } from './tinyurl-shortener-provider';

/**
 * The two providers that work without an account, and the consequences that has
 * throughout the stack.
 */
describe('key-less shorteners', () => {
  let httpMock: HttpTestingController;
  let settings: ShortenerSettings;
  let tinyurl: TinyurlShortenerProvider;
  let isgd: IsgdProvider;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(ShortenerSettings);
    tinyurl = TestBed.inject(TinyurlShortenerProvider);
    isgd = TestBed.inject(IsgdProvider);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('ShortenerSettings with no key', () => {
    it('resolves TinyURL and is.gd with no credential at all', () => {
      settings.activate('tinyurl');
      const tinyurlConfig = settings.resolve();
      expect(tinyurlConfig).not.toBeNull();
      expect(tinyurlConfig?.auth).toBeNull();

      settings.activate('isgd');
      expect(settings.resolve()?.auth).toBeNull();
      expect(settings.usable()).toBe(true);
      expect(settings.blockedReason()).toBeNull();
    });

    it('still refuses a required-key provider with no key', () => {
      settings.activate('dub');

      expect(settings.resolve()).toBeNull();
      expect(settings.blockedReason()).toContain('API key');
    });

    it('sends the Rebrandly key in its bespoke apikey header, not Authorization', () => {
      settings.setKey('rebrandly', 'rb-key');
      settings.activate('rebrandly');

      expect(settings.resolve()?.auth).toEqual({ header: 'apikey', value: 'rb-key' });
    });

    it('never authenticates a provider whose key policy is none', () => {
      // Even if a key somehow got stored against is.gd, it must not be sent —
      // there is nothing on the other end that would accept it.
      settings.setKey('isgd', 'stray-value');
      settings.activate('isgd');

      expect(settings.resolve()?.auth).toBeNull();
    });
  });

  describe('TinyURL', () => {
    it('creates anonymously through the legacy endpoint, which returns plain text', async () => {
      settings.activate('tinyurl');
      const promise = firstValueFrom(
        tinyurl.createLink({ destinationUrl: 'https://example.com/a-long-url' }),
      );

      const req = httpMock.expectOne((r) => r.url === 'https://tinyurl.com/api-create.php');
      // No credential is involved in this path at all.
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush('https://tinyurl.com/abc123');

      const link = await promise;
      expect(link.shortUrl).toBe('https://tinyurl.com/abc123');
      expect(link.slug).toBe('abc123');
      expect(link.destinationUrl).toBe('https://example.com/a-long-url');
    });

    it('reports only create as available until a token is added', () => {
      settings.activate('tinyurl');
      const anonymous = tinyurl.capabilities();
      expect(anonymous.list).toBe(false);
      expect(anonymous.update).toBe(false);
      expect(anonymous.delete).toBe(false);
      expect(anonymous.customSlug).toBe(false);

      settings.setKey('tinyurl', 'tinyurl-token');

      // The same provider instance now offers the full surface.
      const withToken = tinyurl.capabilities();
      expect(withToken.list).toBe(true);
      expect(withToken.update).toBe(true);
      expect(withToken.delete).toBe(true);
      expect(withToken.customSlug).toBe(true);
    });

    it('refuses to edit or delete an anonymous link, with an actionable message', async () => {
      settings.activate('tinyurl');

      const error = (await firstValueFrom(tinyurl.deleteLink('abc123')).then(
        () => null,
        (e: unknown) => e,
      )) as LinkProviderError;

      expect(error.code).toBe('UNSUPPORTED_OPERATION');
      expect(error.message).toContain('permanent');
    });

    it('verifies without any request when there is no token', async () => {
      settings.activate('tinyurl');

      await firstValueFrom(tinyurl.verify());

      // Firing a real create to "prove" it works would leave junk behind on
      // every visit to the connector page.
      httpMock.expectNone(() => true);
    });

    it('addresses a link by domain/alias once a token exists', async () => {
      settings.setKey('tinyurl', 'tinyurl-token');
      settings.activate('tinyurl');

      const promise = firstValueFrom(
        tinyurl.createLink({ destinationUrl: 'https://example.com/x', slug: 'mine' }),
      );
      const req = httpMock.expectOne('https://api.tinyurl.com/create');
      expect(req.request.headers.get('Authorization')).toBe('Bearer tinyurl-token');
      req.flush({
        data: {
          domain: 'tinyurl.com',
          alias: 'mine',
          tiny_url: 'https://tinyurl.com/mine',
          url: 'https://example.com/x',
        },
      });

      // providerId is what update and delete address, and for TinyURL that is
      // `domain/alias` rather than an opaque id.
      expect((await promise).providerId).toBe('tinyurl.com/mine');
    });
  });

  describe('is.gd', () => {
    it('offers nothing but create, because it has no accounts', () => {
      const caps = isgd.capabilities();

      expect(caps.list).toBe(false);
      expect(caps.update).toBe(false);
      expect(caps.delete).toBe(false);
      // The one thing it does offer anonymously.
      expect(caps.customSlug).toBe(true);
    });

    it('creates a link and reads the short URL out of the JSON body', async () => {
      settings.activate('isgd');
      const promise = firstValueFrom(isgd.createLink({ destinationUrl: 'https://example.com/x' }));

      const req = httpMock.expectOne((r) => r.url.startsWith('https://is.gd/create.php'));
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({ shorturl: 'https://is.gd/abc123' });

      const link = await promise;
      expect(link.shortUrl).toBe('https://is.gd/abc123');
      expect(link.slug).toBe('abc123');
    });

    it('treats a 200 carrying an error code as a failure', async () => {
      settings.activate('isgd');
      const promise = firstValueFrom(isgd.createLink({ destinationUrl: 'https://example.com/x' }));

      // is.gd answers 200 with an error body rather than an HTTP error status.
      httpMock
        .expectOne((r) => r.url.startsWith('https://is.gd/create.php'))
        .flush({ errorcode: 2, errormessage: 'that alias is taken' });

      const error = (await promise.catch((e: unknown) => e)) as LinkProviderError;
      expect(error.code).toBe('SLUG_CONFLICT');
    });

    it('reports its missing operations as unsupported rather than failing obscurely', async () => {
      const error = (await firstValueFrom(isgd.listLinks()).catch(
        (e: unknown) => e,
      )) as LinkProviderError;

      expect(error.code).toBe('UNSUPPORTED_OPERATION');
    });
  });

  describe('proxying a key-less request', () => {
    it('goes through the ordinary proxy path with no consent prompt', async () => {
      // A request carrying no credential has nothing to disclose, so asking the
      // user to accept the risk of a leak would be a lie.
      TestBed.inject(CorsProxySettings).select('allorigins');
      settings.activate('isgd');
      expect(TestBed.inject(ShortenerProxyConsent).granted('isgd', 'allorigins')).toBe(false);

      const promise = firstValueFrom(isgd.createLink({ destinationUrl: 'https://example.com/x' }));
      httpMock
        .expectOne((r) => r.url.startsWith('https://is.gd/create.php'))
        .error(new ProgressEvent('error'), { status: 0 });

      const proxied = httpMock.expectOne((r) => r.url.startsWith('https://api.allorigins.win/raw'));
      proxied.flush({ shorturl: 'https://is.gd/abc123' });

      expect((await promise).shortUrl).toBe('https://is.gd/abc123');
    });
  });
});
