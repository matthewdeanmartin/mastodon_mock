import { Injectable, signal } from '@angular/core';

/**
 * How much traffic has gone through a CORS proxy, for the Observability page.
 *
 * Separate from {@link ApiMetrics} on purpose. That service is scoped to the
 * *instance's* API and its interceptor deliberately skips foreign hosts, which
 * is the right boundary — proxied feed fetches are not instance traffic and
 * folding them in would make endpoint stats lie. What is worth surfacing is
 * much smaller: how many requests this browser has handed to a third party,
 * and how many of those failed.
 *
 * Counters only, never URLs. Which feeds someone reads is exactly the thing a
 * proxy already learns, and writing it to a second place would only widen the
 * disclosure. `mockingbird_rss_feeds` already holds the subscription list for
 * anyone who legitimately needs it.
 */

const STORAGE_KEY = 'mockingbird_cors_proxy_usage';

export interface CorsProxyUsage {
  /** Requests sent through a proxy since the counter was last reset. */
  requests: number;
  /** How many of those failed. */
  failures: number;
  /** Epoch ms of the most recent proxied request, or 0 if never. */
  lastAt: number;
}

const EMPTY: CorsProxyUsage = { requests: 0, failures: 0, lastAt: 0 };

@Injectable({ providedIn: 'root' })
export class CorsProxyUsageStore {
  readonly usage = signal<CorsProxyUsage>(read());

  record(ok: boolean): void {
    const current = this.usage();
    this.write({
      requests: current.requests + 1,
      failures: current.failures + (ok ? 0 : 1),
      lastAt: Date.now(),
    });
  }

  reset(): void {
    this.write({ ...EMPTY });
  }

  private write(next: CorsProxyUsage): void {
    this.usage.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Counters are diagnostics; losing them costs nothing.
    }
  }
}

function read(): CorsProxyUsage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...EMPTY };
    }
    const parsed = JSON.parse(raw) as Partial<CorsProxyUsage>;
    return {
      requests: numberOr(parsed.requests),
      failures: numberOr(parsed.failures),
      lastAt: numberOr(parsed.lastAt),
    };
  } catch {
    return { ...EMPTY };
  }
}

function numberOr(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
