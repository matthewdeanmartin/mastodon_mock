import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CorsProxySettings } from './cors-proxy-settings';
import {
  availableCorsProxies,
  corsProxyEntry,
  headerCapableCorsProxies,
  isDevelopmentOrigin,
} from './cors-proxy-catalog';

describe('CorsProxySettings', () => {
  let settings: CorsProxySettings;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    settings = TestBed.inject(CorsProxySettings);
  });

  it('starts with nothing configured, so feeds are fetched directly', () => {
    expect(settings.currentId()).toBeNull();
    expect(settings.usable()).toBe(false);
    expect(settings.resolve()).toBeNull();
  });

  it('resolves a keyless proxy as soon as it is chosen', () => {
    settings.select('allorigins');
    const config = settings.resolve();
    expect(config?.entry.id).toBe('allorigins');
    expect(config?.header).toBeNull();
    expect(settings.usable()).toBe(true);
  });

  it('refuses to resolve a key-requiring proxy that has no key', () => {
    settings.select('corssh');
    // Unusable rather than half-configured: a request built from this would
    // just be rejected by the proxy, and the failure would look like the feed's.
    expect(settings.resolve()).toBeNull();
    expect(settings.usable()).toBe(false);

    settings.setKey('a-key');
    expect(settings.resolve()?.header).toEqual({ name: 'x-cors-api-key', value: 'a-key' });
  });

  it('stores the key separately from the choice, and never in the config blob', () => {
    settings.select('corssh');
    settings.setKey('super-secret');

    expect(localStorage.getItem('mockingbird_cors_proxy')).not.toContain('super-secret');
    expect(localStorage.getItem('mockingbird_cors_proxy_key')).toContain('super-secret');
  });

  it('stamps the key so the retention policy can expire it', () => {
    settings.select('corssh');
    settings.setKey('k');
    const stored = JSON.parse(localStorage.getItem('mockingbird_cors_proxy_key')!);
    expect(typeof stored.connectedAt).toBe('number');
    expect(settings.expiresAt()).toBeTypeOf('number');
  });

  it('drops a key that has outlived the policy', () => {
    settings.select('corssh');
    settings.setKey('k');
    // Backdate well past the default 90-day window.
    const stored = JSON.parse(localStorage.getItem('mockingbird_cors_proxy_key')!);
    stored.connectedAt = Date.now() - 400 * 24 * 60 * 60 * 1000;
    localStorage.setItem('mockingbird_cors_proxy_key', JSON.stringify(stored));

    const fresh = new CorsProxySettings();
    expect(fresh.hasKey()).toBe(false);
    // The choice survives: the user re-pastes a key, they don't reconfigure.
    expect(fresh.currentId()).toBe('corssh');
  });

  it('clears the key when handed an empty one', () => {
    settings.select('corssh');
    settings.setKey('k');
    settings.setKey('   ');
    expect(settings.hasKey()).toBe(false);
  });

  it('requires {url} in a custom template before it will resolve', () => {
    settings.select('custom', { template: 'https://my-worker.example.com/fetch' });
    expect(settings.resolve()).toBeNull();

    settings.select('custom', { template: 'https://my-worker.example.com/?url={url}' });
    expect(settings.resolve()?.pattern).toContain('{url}');
  });

  it('carries a custom header name alongside the key', () => {
    settings.select('custom', { template: 'https://mine.example.com/?url={url}' });
    settings.setKey('mykey', 'x-my-auth');
    expect(settings.resolve()?.header).toEqual({ name: 'x-my-auth', value: 'mykey' });
  });

  it('forgets everything, key included, when cleared', () => {
    settings.select('corssh');
    settings.setKey('k');
    settings.clear();

    expect(settings.currentId()).toBeNull();
    expect(settings.hasKey()).toBe(false);
    expect(localStorage.getItem('mockingbird_cors_proxy_key')).toBeNull();
  });

  it('ignores a stored id the app no longer ships', () => {
    localStorage.setItem('mockingbird_cors_proxy', JSON.stringify({ id: 'defunct-proxy' }));
    expect(new CorsProxySettings().currentId()).toBeNull();
  });

  it('survives a corrupt config blob', () => {
    localStorage.setItem('mockingbird_cors_proxy', 'not json');
    expect(new CorsProxySettings().currentId()).toBeNull();
  });

  // corsproxy-io, not corsfix: Corsfix stopped being localhost-only once
  // testing showed its free tier is allowlist-based and works from a registered
  // production domain. corsproxy-io is now the genuinely dev-only entry.
  it('drops a localhost-only proxy when the app is deployed', () => {
    settings.select('corsproxy-io');
    expect(settings.dropUnavailableSelection('mockingbird.example.com')).toBe(true);
    expect(settings.currentId()).toBeNull();
  });

  it('keeps a localhost-only proxy while running locally', () => {
    settings.select('corsproxy-io');
    expect(settings.dropUnavailableSelection('localhost')).toBe(false);
    expect(settings.currentId()).toBe('corsproxy-io');
  });

  it('keeps Corsfix selected on a deployed origin', () => {
    // The regression this guards: Corsfix was `devOnly`, so a user who picked it
    // under `ng serve` had the selection silently cleared in production.
    settings.select('corsfix');
    expect(settings.dropUnavailableSelection('mockingbird.example.com')).toBe(false);
    expect(settings.currentId()).toBe('corsfix');
  });
});

describe('availableCorsProxies', () => {
  it('hides localhost-only proxies on a deployed origin', () => {
    const ids = availableCorsProxies('mockingbird.example.com').map((entry) => entry.id);
    expect(ids).toContain('allorigins');
    expect(ids).toContain('custom');
    expect(ids).not.toContain('corsproxy-io');
  });

  it('offers Corsfix in production, because its free tier is allowlisted not localhost-only', () => {
    // It used to be marked devOnly and hidden here. That was wrong: localhost is
    // merely allowed *implicitly*, and a registered domain works from anywhere.
    // Hiding it in production hid the fastest free option there is.
    const ids = availableCorsProxies('mockingbird.example.com').map((entry) => entry.id);
    expect(ids).toContain('corsfix');
  });

  it('offers everything under ng serve', () => {
    const ids = availableCorsProxies('localhost').map((entry) => entry.id);
    expect(ids).toContain('corsfix');
    expect(ids).toContain('corsproxy-io');
  });

  it.each(['localhost', '127.0.0.1', 'app.localhost'])('treats %s as development', (host) => {
    expect(isDevelopmentOrigin(host)).toBe(true);
  });

  it('does not treat a deployed host as development', () => {
    expect(isDevelopmentOrigin('mockingbird.example.com')).toBe(false);
  });
});

describe('headerCapableCorsProxies', () => {
  // The distinction these tests protect is invisible in ordinary RSS use and
  // only bites when an API key must ride along. Measurements behind the values:
  // sprint/twitter-1-transport.md.
  it('excludes a proxy measured to strip custom headers', () => {
    const ids = headerCapableCorsProxies('mockingbird.example.com').map((entry) => entry.id);
    // AllOrigins fetches public feeds fine but drops X-API-Key, so the target
    // answers "no key supplied" and the user blames their own key.
    expect(ids).not.toContain('allorigins');
  });

  it('keeps the proxies verified to forward them', () => {
    const ids = headerCapableCorsProxies('mockingbird.example.com').map((entry) => entry.id);
    expect(ids).toContain('corssh');
    expect(ids).toContain('corsfix');
  });

  it('keeps unproven proxies rather than guessing they fail', () => {
    // `custom` is whatever the user deployed. Excluding it would remove the one
    // option nobody can rate-limit, on a guess.
    const ids = headerCapableCorsProxies('mockingbird.example.com').map((entry) => entry.id);
    expect(ids).toContain('custom');
    expect(corsProxyEntry('custom')!.forwardsCustomHeaders).toBeUndefined();
  });

  it('still honours the development-origin filter', () => {
    const ids = headerCapableCorsProxies('mockingbird.example.com').map((entry) => entry.id);
    expect(ids).not.toContain('corsproxy-io');
  });
});

describe('catalog facts measured against live proxies', () => {
  it('records that AllOrigins cannot carry a key', () => {
    expect(corsProxyEntry('allorigins')!.forwardsCustomHeaders).toBe(false);
  });

  it('records Corsfix as allowlist-based rather than localhost-only', () => {
    const corsfix = corsProxyEntry('corsfix')!;
    expect(corsfix.devOnly).toBeUndefined();
    expect(corsfix.forwardsCustomHeaders).toBe(true);
    // The 403 it returns for an unregistered origin is a setup step, and the UI
    // needs somewhere to send the user.
    expect(corsfix.originAllowlist?.dashboardUrl).toBeTruthy();
  });
});
