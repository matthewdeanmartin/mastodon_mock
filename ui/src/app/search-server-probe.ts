/**
 * Does this server actually answer anonymous search?
 *
 * A server can be perfectly reachable and still be useless as a search server:
 * many instances require a token for `/api/v2/search`, and some answer 200 with an
 * empty payload. So reachability alone proves nothing — the only honest test is to
 * run a real anonymous search for something every federated server has heard of and
 * see whether results come back.
 */

/** Accounts big enough that any server with a populated index knows them. */
const CANARY_QUERIES = ['Gargron', 'mastodon'];

export type SearchServerStatus =
  | 'idle'
  | 'checking'
  /** Anonymous search works and returned results. */
  | 'ok'
  /** Answered, but with nothing — index is empty or search is quietly restricted. */
  | 'no-results'
  /** Explicitly refused anonymous search (401/403/422). */
  | 'auth-required'
  /** Couldn't be reached at all (DNS, CORS, timeout, 5xx). */
  | 'unreachable';

export interface SearchServerProbe {
  status: SearchServerStatus;
  /** How many accounts the canary query matched (0 unless status is 'ok'). */
  accounts: number;
}

interface SearchPayload {
  accounts?: unknown[];
  statuses?: unknown[];
  hashtags?: unknown[];
}

/**
 * Run one anonymous canary search against `baseUrl`. Tries a second canary only if
 * the first returns zero results, so a merely-unlucky query isn't mistaken for a
 * disabled index.
 */
export async function probeSearchServer(
  baseUrl: string,
  abortSignal?: AbortSignal,
  timeoutMs = 8000,
): Promise<SearchServerProbe> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;

  let lastStatus: SearchServerStatus = 'unreachable';
  for (const query of CANARY_QUERIES) {
    const url = `${baseUrl}/api/v2/search?q=${encodeURIComponent(query)}&type=accounts&limit=5`;
    try {
      const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
      if (response.status === 401 || response.status === 403 || response.status === 422) {
        // Mastodon uses 422 for "this endpoint needs a token" on some builds.
        return { status: 'auth-required', accounts: 0 };
      }
      if (!response.ok) {
        lastStatus = 'unreachable';
        continue;
      }
      const payload = (await response.json()) as SearchPayload;
      const accounts = payload.accounts?.length ?? 0;
      if (accounts > 0) {
        return { status: 'ok', accounts };
      }
      lastStatus = 'no-results';
    } catch {
      lastStatus = 'unreachable';
    }
  }
  return { status: lastStatus, accounts: 0 };
}
