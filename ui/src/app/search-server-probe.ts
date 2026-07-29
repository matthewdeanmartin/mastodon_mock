/**
 * Does this server actually answer anonymous search?
 *
 * A server can be perfectly reachable and still be useless as a search server:
 * many instances require a token for `/api/v2/search`, and some answer 200 with an
 * empty payload. So reachability alone proves nothing — the only honest test is to
 * run a real anonymous search for something every federated server has heard of and
 * see whether results come back.
 *
 * Two canaries, not one, because account search and post search fail *separately*:
 * a Mastodon server running without Elasticsearch answers `type=accounts` correctly
 * and returns `[]` for `type=statuses` permanently, with no error. That is the most
 * common broken configuration there is, and a single "search works here" flag would
 * be wrong about it every time. See `sprint/anonymous-great-1-search-truth.md`.
 */

/** Accounts big enough that any server with a populated index knows them. */
const CANARY_QUERIES = ['Gargron', 'mastodon'];

/**
 * The post canary.
 *
 * Deliberately not a stop word like "the": some configurations strip those, so an
 * empty result would say more about the analyzer than the index. A word that is
 * both ubiquitous on Mastodon and a real term is the honest test.
 */
const POST_CANARY = 'mastodon';

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
  /**
   * How many posts the full-text canary matched, or null when it was never run.
   *
   * Null rather than 0: "we didn't ask" and "asked, and this server has no post
   * index" are the two facts this whole module exists to keep apart.
   */
  statuses: number | null;
}

interface SearchPayload {
  accounts?: unknown[];
  statuses?: unknown[];
  hashtags?: unknown[];
}

/**
 * Is this server usable as a *search server*?
 *
 * Both halves must work. Hashtag search is explicitly not evidence — every server
 * answers it, including ones with no index at all — which is why the TODO asked for
 * "a search endpoint other than tags, enabled and returning results".
 */
export function isUsableSearchServer(probe: SearchServerProbe): boolean {
  return probe.status === 'ok' && probe.accounts > 0 && (probe.statuses ?? 0) > 0;
}

/**
 * Run one anonymous canary search against `baseUrl`. Tries a second canary only if
 * the first returns zero results, so a merely-unlucky query isn't mistaken for a
 * disabled index.
 *
 * The post canary runs only once account search has proved the server answers at
 * all: there is nothing to learn from a post probe against a host that 401s.
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
    const result = await runCanary(baseUrl, query, 'accounts', signal);
    if (result.refused) {
      return { status: 'auth-required', accounts: 0, statuses: null };
    }
    if (result.count === null) {
      lastStatus = 'unreachable';
      continue;
    }
    if (result.count > 0) {
      // Account search works. Only now is the post probe worth a request.
      const posts = await runCanary(baseUrl, POST_CANARY, 'statuses', signal);
      return {
        status: 'ok',
        accounts: result.count,
        // A refused or unreachable post probe is reported as zero, not null: the
        // server answered account search, so "no usable post search" is a finding
        // about this host rather than an absence of information.
        statuses: posts.count ?? 0,
      };
    }
    lastStatus = 'no-results';
  }
  return { status: lastStatus, accounts: 0, statuses: null };
}

/** One search request. `count: null` means the request itself did not answer. */
async function runCanary(
  baseUrl: string,
  query: string,
  type: 'accounts' | 'statuses',
  signal: AbortSignal,
): Promise<{ count: number | null; refused: boolean }> {
  const url = `${baseUrl}/api/v2/search?q=${encodeURIComponent(query)}&type=${type}&limit=5`;
  try {
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (response.status === 401 || response.status === 403 || response.status === 422) {
      // Mastodon uses 422 for "this endpoint needs a token" on some builds.
      return { count: null, refused: true };
    }
    if (!response.ok) {
      return { count: null, refused: false };
    }
    const payload = (await response.json()) as SearchPayload;
    const list = type === 'accounts' ? payload.accounts : payload.statuses;
    return { count: list?.length ?? 0, refused: false };
  } catch {
    return { count: null, refused: false };
  }
}
