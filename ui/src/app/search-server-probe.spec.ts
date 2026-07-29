import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUsableSearchServer, probeSearchServer } from './search-server-probe';

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

  // --- the post canary: the no-Elasticsearch case ---

  it('probes posts separately once account search has proved itself', async () => {
    const types: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        types.push(new URL(url).searchParams.get('type') ?? '');
        return jsonResponse({ accounts: [{ id: '1' }], statuses: [{ id: '9' }] });
      }),
    );

    const result = await probeSearchServer('https://good.example');

    expect(types).toEqual(['accounts', 'statuses']);
    expect(result.statuses).toBe(1);
    expect(isUsableSearchServer(result)).toBe(true);
  });

  it('catches the server that answers account search but has no post index', async () => {
    // The signature of a Mastodon install with no Elasticsearch: accounts fine,
    // statuses an empty 200 forever. Nothing errors, which is what makes it nasty.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new URL(url).searchParams.get('type') === 'accounts'
          ? jsonResponse({ accounts: [{ id: '1' }] })
          : jsonResponse({ statuses: [] }),
      ),
    );

    const result = await probeSearchServer('https://no-es.example');

    expect(result.status).toBe('ok');
    expect(result.accounts).toBe(1);
    expect(result.statuses).toBe(0);
    // Reachable and useful for accounts, but not adoptable as a search server.
    expect(isUsableSearchServer(result)).toBe(false);
  });

  it('spends nothing on a post probe when the server refused account search', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 403));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeSearchServer('https://closed.example');

    expect(result.statuses).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records a refused post probe as zero, not as "never asked"', async () => {
    // The distinction matters: the host answered accounts, so this is a finding
    // about its post search, not missing information.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new URL(url).searchParams.get('type') === 'accounts'
          ? jsonResponse({ accounts: [{ id: '1' }] })
          : jsonResponse({}, 401),
      ),
    );

    expect((await probeSearchServer('https://half.example')).statuses).toBe(0);
  });
});

describe('isUsableSearchServer', () => {
  it('requires both halves of search to work', () => {
    expect(isUsableSearchServer({ status: 'ok', accounts: 3, statuses: 5 })).toBe(true);
    expect(isUsableSearchServer({ status: 'ok', accounts: 3, statuses: 0 })).toBe(false);
    expect(isUsableSearchServer({ status: 'ok', accounts: 0, statuses: 5 })).toBe(false);
    expect(isUsableSearchServer({ status: 'auth-required', accounts: 0, statuses: null })).toBe(
      false,
    );
  });

  it('does not count an unprobed post search as working', () => {
    expect(isUsableSearchServer({ status: 'ok', accounts: 3, statuses: null })).toBe(false);
  });
});
