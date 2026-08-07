import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorsProxy, CorsProxyRefusal } from '../cors-proxy/cors-proxy';
import { WebmentionSend } from './webmention-send';

const TARGET = 'https://blog.example/posts/hello/';
const SOURCE = 'https://mistersql.github.io/mistersql/interactions/2026-08-06-1/';
const MASTODON = 'https://mastodon.social/@alice/109876';

/** A proxy that passes URLs straight through, so specs assert on real targets. */
function passthroughProxy(): void {
  TestBed.overrideProvider(CorsProxy, {
    useValue: {
      proxyRequest: (url: string) => ({ url, headers: { keys: () => [], get: () => null } }),
    },
  });
}

/** A browser with no proxy configured at all. */
function refusingProxy(): void {
  TestBed.overrideProvider(CorsProxy, {
    useValue: {
      proxyRequest: () => {
        throw new CorsProxyRefusal('No CORS proxy is configured.');
      },
    },
  });
}

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

/** GETs answer discovery; POSTs answer delivery. */
function route(onGet: () => Response, onPost: () => Response | Promise<never>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' ? Promise.resolve(onPost() as Response) : Promise.resolve(onGet()),
  );
}

function posts(): { url: string; init: RequestInit }[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
    .map((call) => ({ url: String(call[0]), init: call[1] as RequestInit }));
}

describe('WebmentionSend', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('discovers an endpoint and posts source and target to it', async () => {
    passthroughProxy();
    route(
      () => html('<link rel="webmention" href="https://wm.example/e">'),
      () => new Response('', { status: 202 }),
    );

    const result = await TestBed.inject(WebmentionSend).send(TARGET, SOURCE);

    expect(result.state).toBe('delivered');
    expect(result.endpoint).toBe('https://wm.example/e');
    const [sent] = posts();
    expect(sent.url).toBe('https://wm.example/e');
    expect(sent.init.body).toBe(
      `source=${encodeURIComponent(SOURCE)}&target=${encodeURIComponent(TARGET)}`,
    );
  });

  it('treats 202 as accepted, not verified, and says so', async () => {
    passthroughProxy();
    route(
      () => html('<link rel="webmention" href="https://wm.example/e">'),
      () => new Response('', { status: 202 }),
    );

    const result = await TestBed.inject(WebmentionSend).send(TARGET, SOURCE);

    // Most endpoints verify asynchronously, so promising more would be a lie.
    expect(result.message).toContain('will verify');
  });

  it('reports no-endpoint for a Mastodon post, with nothing resembling an error', async () => {
    passthroughProxy();
    route(
      () => html('<html><body>a toot</body></html>'),
      () => new Response('', { status: 202 }),
    );

    const result = await TestBed.inject(WebmentionSend).send(MASTODON, SOURCE);

    // The expected outcome for every Mastodon target. It must never be dressed
    // up as success, and must never read as a failure.
    expect(result.state).toBe('no-endpoint');
    expect(result.message).toContain('does not accept webmentions');
    expect(result.message).toContain('published');
    expect(posts()).toHaveLength(0);
  });

  it('reports a refusal from a real endpoint as failed', async () => {
    passthroughProxy();
    route(
      () => html('<link rel="webmention" href="https://wm.example/e">'),
      () => new Response('bad source', { status: 400 }),
    );

    const result = await TestBed.inject(WebmentionSend).send(TARGET, SOURCE);

    expect(result.state).toBe('failed');
    expect(result.message).toContain('400');
  });

  it('blames the proxy, not the target, when the POST cannot be made', async () => {
    passthroughProxy();
    route(
      () => html('<link rel="webmention" href="https://wm.example/e">'),
      () => Promise.reject(new TypeError('Failed to fetch')),
    );

    const result = await TestBed.inject(WebmentionSend).send(TARGET, SOURCE);

    // AllOrigins cannot forward a POST. That is a configuration limit, and
    // calling it `failed` would blame the wrong party.
    expect(result.state).toBe('unsupported');
    expect(result.message).toContain('proxy');
  });

  it('reports unsupported when no proxy is configured at all', async () => {
    refusingProxy();
    vi.spyOn(globalThis, 'fetch');

    const result = await TestBed.inject(WebmentionSend).send(TARGET, SOURCE);

    expect(result.state).toBe('unsupported');
    expect(result.message).toContain('CORS proxy');
    // And it says the durable half already happened.
    expect(result.message).toContain('published');
  });

  it('does not claim a failure when the target page cannot be read', async () => {
    passthroughProxy();
    route(
      () => new Response('nope', { status: 500 }),
      () => new Response('', { status: 202 }),
    );

    const result = await TestBed.inject(WebmentionSend).send(TARGET, SOURCE);

    // We genuinely do not know whether it accepts webmentions.
    expect(result.state).toBe('no-endpoint');
    expect(result.message).toContain('Could not check');
  });

  it('discovers each host once per batch', async () => {
    passthroughProxy();
    route(
      () => html('<link rel="webmention" href="https://wm.example/e">'),
      () => new Response('', { status: 202 }),
    );
    const sender = TestBed.inject(WebmentionSend);

    await sender.send(TARGET, SOURCE);
    await sender.send(TARGET, SOURCE);

    const gets = vi
      .mocked(fetch)
      .mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method !== 'POST');
    expect(gets).toHaveLength(1);
    expect(posts()).toHaveLength(2);
  });

  it('forgets endpoints between batches, so a new one is noticed', async () => {
    passthroughProxy();
    route(
      () => html('<html><body>no endpoint yet</body></html>'),
      () => new Response('', { status: 202 }),
    );
    const sender = TestBed.inject(WebmentionSend);
    await sender.send(TARGET, SOURCE);

    sender.resetCache();
    await sender.send(TARGET, SOURCE);

    // Persisting "this site has no endpoint" would outlive the day they add one.
    const gets = vi
      .mocked(fetch)
      .mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method !== 'POST');
    expect(gets).toHaveLength(2);
  });
});
