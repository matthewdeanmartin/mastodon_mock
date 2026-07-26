import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeSearchServer } from './search-server-probe';

/** Minimal stand-in for the bits of Response the probe reads. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('probeSearchServer', () => {
  it('reports ok when the canary search returns accounts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ accounts: [{ id: '1' }, { id: '2' }] })),
    );

    const result = await probeSearchServer('https://mastodon.social');

    expect(result.status).toBe('ok');
    expect(result.accounts).toBe(2);
  });

  it('hits the search endpoint anonymously on the given base URL', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return jsonResponse({ accounts: [{ id: '1' }] });
      }),
    );

    await probeSearchServer('https://example.social');

    expect(urls[0]).toContain('https://example.social/api/v2/search');
    expect(urls[0]).toContain('type=accounts');
  });

  it('reports auth-required when the server refuses anonymous search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)),
    );

    expect((await probeSearchServer('https://closed.example')).status).toBe('auth-required');
  });

  it('treats 422 as auth-required (some builds use it for token-only endpoints)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 422)),
    );

    expect((await probeSearchServer('https://closed.example')).status).toBe('auth-required');
  });

  it('reports no-results when a reachable server has an empty index', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accounts: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeSearchServer('https://empty.example');

    expect(result.status).toBe('no-results');
    // A second canary is tried before giving up, so one unlucky query isn't fatal.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts a server whose second canary query is the one that hits', async () => {
    const pages = [jsonResponse({ accounts: [] }), jsonResponse({ accounts: [{ id: '7' }] })];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => pages[call++]),
    );

    expect((await probeSearchServer('https://partial.example')).status).toBe('ok');
  });

  it('reports unreachable when the request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );

    expect((await probeSearchServer('https://nope.example')).status).toBe('unreachable');
  });
});
