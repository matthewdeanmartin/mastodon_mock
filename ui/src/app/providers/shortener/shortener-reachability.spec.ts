import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CorsProxySettings } from '../cors-proxy/cors-proxy-settings';
import { ShortenerProxyConsent } from './proxy-consent';
import { ShortenerReachability } from './shortener-reachability';
import { ShortenerSettings } from './shortener-settings';

describe('ShortenerReachability', () => {
  let reachability: ShortenerReachability;
  let httpMock: HttpTestingController;
  let settings: ShortenerSettings;
  let proxySettings: CorsProxySettings;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    reachability = TestBed.inject(ShortenerReachability);
    httpMock = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(ShortenerSettings);
    proxySettings = TestBed.inject(CorsProxySettings);
    settings.activate('isgd');
  });

  afterEach(() => {
    httpMock.verify();
  });

  const isgdRequest = () => httpMock.expectOne((r) => r.url.startsWith('https://is.gd/create.php'));

  it('reports a direct success as needing no proxy', async () => {
    const promise = firstValueFrom(reachability.probe('isgd'));
    isgdRequest().flush({ shorturl: 'https://is.gd/abc' });

    const result = await promise;
    expect(result.status).toBe('direct');
    expect(result.message).toContain('No CORS proxy needed');
  });

  it('probes without an Accept header, the same way a real is.gd call goes out', async () => {
    // A probe that took a different route than the feature could pass while the
    // feature fails — which is how the preflight bug went unnoticed.
    const promise = firstValueFrom(reachability.probe('isgd'));
    const req = isgdRequest();
    expect(req.request.headers.has('Accept')).toBe(false);
    req.flush({ shorturl: 'https://is.gd/abc' });

    await promise;
  });

  it('reports that a proxy is needed when direct fails and none is configured', async () => {
    const promise = firstValueFrom(reachability.probe('isgd'));
    isgdRequest().error(new ProgressEvent('error'), { status: 0 });

    const result = await promise;
    expect(result.status).toBe('needs-proxy');
    expect(result.message).toContain('no CORS proxy is configured');
  });

  it('reports the proxy route when direct fails but the proxy carries it', async () => {
    proxySettings.select('allorigins');

    const promise = firstValueFrom(reachability.probe('isgd'));
    isgdRequest().error(new ProgressEvent('error'), { status: 0 });
    // is.gd holds no credential, so the proxy leg needs no consent.
    httpMock
      .expectOne((r) => r.url.startsWith('https://api.allorigins.win/raw'))
      .flush({ shorturl: 'https://is.gd/abc' });

    const result = await promise;
    expect(result.status).toBe('proxy');
    expect(result.message).toContain('AllOrigins');
  });

  it('reports unreachable when the proxy leg fails too', async () => {
    // The AllOrigins-is-500ing case, which is what prompted this probe.
    proxySettings.select('allorigins');

    const promise = firstValueFrom(reachability.probe('isgd'));
    isgdRequest().error(new ProgressEvent('error'), { status: 0 });
    httpMock
      .expectOne((r) => r.url.startsWith('https://api.allorigins.win/raw'))
      .flush('<html>500</html>', { status: 500, statusText: 'Internal Server Error' });

    const result = await promise;
    expect(result.status).toBe('unreachable');
    // Names the proxy, so the user knows which hop to blame.
    expect(result.message).toContain('AllOrigins');
  });

  it('treats a real answer from the service as reachable, whatever it said', async () => {
    // A 401 means the request arrived. That is the question being asked here.
    settings.setKey('dub', 'dub-token');
    settings.activate('dub');

    const promise = firstValueFrom(reachability.probe('dub'));
    httpMock
      .expectOne((r) => r.url.startsWith('https://api.dub.co'))
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    const result = await promise;
    expect(result.status).toBe('direct');
  });

  it('never claims to know why a request failed', async () => {
    // A browser cannot distinguish CORS from DNS from offline, so no verdict may
    // assert a cause. Guarding the copy, since that is where it would creep in.
    const promise = firstValueFrom(reachability.probe('isgd'));
    isgdRequest().error(new ProgressEvent('error'), { status: 0 });

    const result = await promise;
    expect(result.message).not.toMatch(/blocked by CORS|CORS error|is offline/i);
  });
});
