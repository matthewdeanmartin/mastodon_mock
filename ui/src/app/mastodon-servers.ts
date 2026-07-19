import { Injectable, signal } from '@angular/core';

/**
 * A curated instance from the joinmastodon.org server index, trimmed to the fields the
 * server picker actually shows. The full API row carries thumbnails, blurhashes, version
 * strings, etc.; storing all of that would bloat localStorage for no UI gain.
 */
export interface ServerSuggestion {
  domain: string;
  description: string;
  category: string;
  /** Rough size, for a "big vs cozy" hint. 0 when the API omitted it. */
  users: number;
}

/** joinmastodon's public, CORS-open index (Access-Control-Allow-Origin: *). */
const SERVERS_URL = 'https://api.joinmastodon.org/servers';

const CACHE_KEY = 'mastodon_mock_server_index';
/** Re-fetch the index at most weekly — it barely changes and the payload is ~200KB. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedIndex {
  fetchedAt: number;
  servers: ServerSuggestion[];
}

/** One row as returned by the joinmastodon API (only the fields we read). */
interface RawServer {
  domain: string;
  description?: string;
  category?: string;
  total_users?: number;
}

/**
 * Loads and caches the joinmastodon.org curated server list so the login picker can offer
 * real, described instances instead of a hardcoded handful. Client-side only: the list is
 * public and CORS-open, so an OAuth client with no backend can fetch it directly.
 */
@Injectable({ providedIn: 'root' })
export class MastodonServers {
  /** The full index once loaded; empty until the first successful fetch. */
  readonly servers = signal<ServerSuggestion[]>(this.readCache());
  /** True while a network fetch is in flight (for a subtle "loading suggestions" hint). */
  readonly loading = signal(false);

  /**
   * Ensure we have a reasonably fresh index. Serves the cache immediately (already loaded
   * into the signal) and only hits the network when the cache is missing or stale. Failures
   * are swallowed — a stale or empty list still lets the user type a domain by hand.
   */
  ensureLoaded(): void {
    if (this.loading()) {
      return;
    }
    if (this.servers().length && this.cacheIsFresh()) {
      return;
    }
    this.loading.set(true);
    fetch(SERVERS_URL, { signal: AbortSignal.timeout(8000) })
      .then((res) => (res.ok ? (res.json() as Promise<RawServer[]>) : Promise.reject()))
      .then((raw) => {
        const trimmed = raw
          .filter((s) => s.domain)
          .map<ServerSuggestion>((s) => ({
            domain: s.domain,
            description: (s.description ?? '').replace(/\s+/g, ' ').trim(),
            category: s.category ?? '',
            users: s.total_users ?? 0,
          }));
        this.servers.set(trimmed);
        this.writeCache(trimmed);
      })
      .catch(() => {
        // Offline, blocked, or timed out: keep whatever we already had.
      })
      .finally(() => this.loading.set(false));
  }

  /**
   * Rank the index against what the user has typed. Prefix matches on the domain win, then
   * any substring match on the domain, then description hits — bigger servers first within a
   * tier so the obvious general instances float up. With no query, returns the largest few
   * as a sensible default suggestion list.
   */
  search(query: string, limit = 7): ServerSuggestion[] {
    const all = this.servers();
    const q = query.trim().toLowerCase().replace(/^https?:\/\//, '');
    if (!q) {
      return [...all].sort((a, b) => b.users - a.users).slice(0, limit);
    }
    const scored = all
      .map((s) => ({ s, score: this.score(s, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.s.users - a.s.users);
    return scored.slice(0, limit).map((x) => x.s);
  }

  private score(s: ServerSuggestion, q: string): number {
    const domain = s.domain.toLowerCase();
    if (domain === q) return 100;
    if (domain.startsWith(q)) return 80;
    if (domain.includes(q)) return 50;
    if (s.category.toLowerCase() === q) return 30;
    if (s.description.toLowerCase().includes(q)) return 10;
    return 0;
  }

  // ---------- localStorage cache ----------

  private readCache(): ServerSuggestion[] {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return [];
      return (JSON.parse(raw) as CachedIndex).servers ?? [];
    } catch {
      return [];
    }
  }

  private cacheIsFresh(): boolean {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const { fetchedAt } = JSON.parse(raw) as CachedIndex;
      return Date.now() - fetchedAt < MAX_AGE_MS;
    } catch {
      return false;
    }
  }

  private writeCache(servers: ServerSuggestion[]): void {
    try {
      const payload: CachedIndex = { fetchedAt: Date.now(), servers };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Quota or private-mode failures are non-fatal; we just refetch next time.
    }
  }
}
