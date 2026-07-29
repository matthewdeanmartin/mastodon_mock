import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';

/**
 * Is search actually turned on where we are searching?
 *
 * The search page used to answer an empty result set with "No results.", which is a
 * different claim from the truth in two of the three cases that produce it:
 *
 *  1. Nobody posted about this. The honest case.
 *  2. The server refuses search without a token — 401/403/422.
 *  3. The server has no Elasticsearch: `type=accounts` works, `type=statuses`
 *     returns `[]` for every query, forever, with no error at all.
 *
 * Case 3 is the common one, and it hits **signed-in users identically** — a token
 * does not conjure a search index. So this probe deliberately goes through
 * {@link Api} rather than raw `fetch`: that inherits the interceptors, which means
 * the bearer token when there is one, the configured search server when there is
 * one, and nothing when anonymous. The answer then describes the request the user's
 * search actually makes, which is the only version of the answer worth having.
 *
 * Compare `search-server-probe.ts`, which asks the *anonymous* question about a
 * stranger's host — that is the right question when shopping for a search server and
 * the wrong one for explaining the empty page in front of you.
 */

/** What we know about one half of search (accounts, or posts) on one host. */
export type SearchAbility =
  | 'unknown'
  | 'checking'
  /** Returned results. Search is on. */
  | 'works'
  /** Answered 200 with nothing. For posts, this is the no-Elasticsearch signature. */
  | 'empty'
  /** Explicitly refused (401/403/422), or the token isn't allowed to search. */
  | 'refused'
  /** Couldn't be reached (network, CORS, 5xx). */
  | 'unreachable';

export interface HostCapability {
  accounts: SearchAbility;
  statuses: SearchAbility;
}

const UNKNOWN: HostCapability = { accounts: 'unknown', statuses: 'unknown' };

/**
 * Canaries, matching `search-server-probe.ts`.
 *
 * Not a stop word: some configurations strip those, so an empty result would say
 * more about the analyzer than about the index.
 */
const ACCOUNT_CANARY = 'Gargron';
const POST_CANARY = 'mastodon';

/** Only ever asked whether anything came back, so one result is plenty. */
const PROBE_LIMIT = 1;

@Injectable({ providedIn: 'root' })
export class SearchCapability {
  private api = inject(Api);

  /**
   * What we know, per host. In-memory for the session only, deliberately **not**
   * localStorage: a cached "search is broken here" that outlives the server fixing
   * its index would be a worse bug than the one this fixes. (The rejected-server
   * list *is* persisted, but that is a different job — skipping duds while hunting
   * — and it comes with a Clear button.)
   */
  private known = signal<Record<string, HostCapability>>({});

  /** In-flight probes, so N callers for one host make one request. */
  private pending = new Map<string, Promise<HostCapability>>();

  /** What we currently know about `host` without asking. */
  peek(host: string): HostCapability {
    return this.known()[host] ?? UNKNOWN;
  }

  /**
   * Probe `host` unless we already know, or are already asking.
   *
   * Called from the zero-result branch of a search and nowhere else: zero is the one
   * outcome where the answer changes what we display, and probing eagerly would
   * spend a request on every visit to answer a question that is almost always
   * boring.
   */
  async ensure(host: string): Promise<HostCapability> {
    const cached = this.known()[host];
    if (cached && cached.accounts !== 'checking') {
      return cached;
    }
    const inFlight = this.pending.get(host);
    if (inFlight) {
      return inFlight;
    }

    this.write(host, { accounts: 'checking', statuses: 'checking' });
    const probe = this.run()
      .then((result) => {
        this.write(host, result);
        return result;
      })
      .catch(() => {
        const failed: HostCapability = { accounts: 'unreachable', statuses: 'unreachable' };
        this.write(host, failed);
        return failed;
      })
      .finally(() => this.pending.delete(host));

    this.pending.set(host, probe);
    return probe;
  }

  /** Forget everything, so the next zero-result search asks again. */
  reset(): void {
    this.known.set({});
    this.pending.clear();
  }

  /**
   * The two canaries.
   *
   * Posts are probed only when accounts came back: a host that refuses search
   * refuses both, and a second request would buy a second copy of the same answer.
   */
  private async run(): Promise<HostCapability> {
    const accounts = await this.canary('accounts');
    if (accounts !== 'works') {
      return { accounts, statuses: accounts };
    }
    return { accounts, statuses: await this.canary('statuses') };
  }

  private async canary(type: 'accounts' | 'statuses'): Promise<SearchAbility> {
    const query = type === 'accounts' ? ACCOUNT_CANARY : POST_CANARY;
    try {
      const results = await firstValueFrom(this.api.search(query, type, { limit: PROBE_LIMIT }));
      const list = type === 'accounts' ? results.accounts : results.statuses;
      return (list?.length ?? 0) > 0 ? 'works' : 'empty';
    } catch (error: unknown) {
      return refused(error) ? 'refused' : 'unreachable';
    }
  }

  private write(host: string, capability: HostCapability): void {
    this.known.update((all) => ({ ...all, [host]: capability }));
  }
}

/**
 * Did the server say "not without a token"?
 *
 * 422 is in the list because some Mastodon builds use it for token-only endpoints —
 * the same quirk `search-server-probe.ts` already accounts for.
 */
function refused(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403 || status === 422;
}
