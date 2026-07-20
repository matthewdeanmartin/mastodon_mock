import { Injectable, computed, inject, signal } from '@angular/core';
import { Server } from '../server';

/**
 * Persisted per-endpoint call metrics + a compact time series + an error ring,
 * for the Observability page.
 *
 * ## Why this shape
 *
 * localStorage is a small, synchronous, shared budget (a few MB for the whole
 * origin). Storing one record per API call would blow through it in a busy
 * session, so nothing here grows with call *count*:
 *
 *  - **Per-endpoint aggregates** — one row per endpoint template (path with ids
 *    collapsed, query dropped). Each row holds count / total / min / max /
 *    sum-of-squares (for stddev) / error count / last status. O(endpoints).
 *  - **Time buckets** — call + error counts bucketed per {@link BUCKET_MS},
 *    kept as a bounded ring ({@link MAX_BUCKETS}). Fixed size regardless of
 *    traffic; enough to chart the recent past.
 *  - **Error ring** — the last {@link MAX_ERRORS} failing calls, trimmed.
 *
 * Writes are debounced (see {@link scheduleFlush}) so a burst of calls costs one
 * serialize, not one per call. Everything stays in the browser.
 */

/** Aggregate stats for one endpoint template (method + normalized path). */
export interface EndpointStat {
  /** e.g. "GET /api/v1/accounts/:id/followers". */
  key: string;
  count: number;
  errors: number;
  /** Total, min, max response time in ms (for mean / best / worst). */
  totalMs: number;
  minMs: number;
  maxMs: number;
  /** Σ(ms²), so stddev is derivable without keeping every sample. */
  sumSqMs: number;
  /** The most recent HTTP status seen (0 = network failure). */
  lastStatus: number;
  /** Epoch ms of the most recent call. */
  lastAt: number;
}

/** One failing call, kept in the bounded error ring. */
export interface ApiError {
  at: number;
  method: string;
  /** Normalized endpoint template (no args). */
  endpoint: string;
  status: number;
  /** Short, size-capped message. */
  message: string;
}

/** One time bucket: total + failed calls in a fixed window. */
export interface TimeBucket {
  /** Bucket start, epoch ms floored to BUCKET_MS. */
  t: number;
  count: number;
  errors: number;
}

/** Snapshot persisted to localStorage (compact keys keep the blob small). */
interface StoredMetrics {
  /** version */
  v: 1;
  /** endpoints: [key, count, errors, total, min, max, sumSq, lastStatus, lastAt][] */
  e: [string, number, number, number, number, number, number, number, number][];
  /** buckets: [t, count, errors][] */
  b: [number, number, number][];
  /** errors: [at, method, endpoint, status, message][] */
  x: [number, string, string, number, string][];
}

const LEGACY_STORAGE_KEY = 'mockingbird_api_metrics';
const STORAGE_PREFIX = 'mockingbird_api_metrics:';
/** One minute per time bucket. */
export const BUCKET_MS = 60_000;
/** Keep two hours of buckets (120 × 1 min). */
const MAX_BUCKETS = 120;
/** Keep the last 50 errors. */
const MAX_ERRORS = 50;
/** Cap a stored error message so one giant blob can't dominate the budget. */
const MAX_MSG_LEN = 300;
/** Debounce window for persisting after activity. */
const FLUSH_DEBOUNCE_MS = 1_500;

interface MetricsState {
  endpoints: Map<string, EndpointStat>;
  buckets: TimeBucket[];
  errorRing: ApiError[];
}

function emptyMetrics(): MetricsState {
  return { endpoints: new Map<string, EndpointStat>(), buckets: [], errorRing: [] };
}

function serverScope(baseUrl: string): string {
  if (!baseUrl) return 'this-server';
  try {
    return new URL(baseUrl).origin.toLowerCase();
  } catch {
    return baseUrl.toLowerCase().replace(/\/$/, '') || 'this-server';
  }
}

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`;
}

/**
 * Collapse a request URL into an endpoint template: drop the query string and
 * replace id-like path segments with `:id`, so `/accounts/42/followers` and
 * `/accounts/99/followers` aggregate into one row.
 */
export function normalizeEndpoint(url: string): string {
  // Strip origin and query/hash.
  let path = url;
  const schemeIdx = path.indexOf('://');
  if (schemeIdx !== -1) {
    const slash = path.indexOf('/', schemeIdx + 3);
    path = slash === -1 ? '/' : path.slice(slash);
  }
  path = path.split('?')[0].split('#')[0];
  return (
    path
      .split('/')
      .map((seg) => (isIdSegment(seg) ? ':id' : seg))
      .join('/') || '/'
  );
}

/** True for a path segment that looks like an id rather than a route name. */
function isIdSegment(seg: string): boolean {
  if (!seg) {
    return false;
  }
  // Pure numbers, snowflake ids.
  if (/^\d+$/.test(seg)) {
    return true;
  }
  // Provider-scoped ids (rss:…, bsky:…) and other colon-bearing composites.
  if (seg.includes(':') || seg.includes('%3A')) {
    return true;
  }
  // Long hex / base32-ish tokens (mixed digits+letters, 12+ chars).
  if (seg.length >= 12 && /\d/.test(seg) && /[a-zA-Z]/.test(seg)) {
    return true;
  }
  return false;
}

@Injectable({ providedIn: 'root' })
export class ApiMetrics {
  private server = inject(Server);
  private states = new Map<string, MetricsState>();

  /** Bumped on every mutation so the page's computed views refresh. */
  private readonly version = signal(0);
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFlushes = new Set<string>();

  constructor() {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    // Best-effort final flush when the tab goes away.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushPending());
    }
  }

  readonly serverLabel = computed(() => serverScope(this.server.baseUrl()));

  // ------------------------------------------------------------------ record

  /**
   * Record one completed API call. `status` is the HTTP status (0 for a network
   * failure); `ok` is false for status 0 or ≥ 400.
   */
  record(method: string, url: string, durationMs: number, status: number, ok: boolean): void {
    const scope = this.activeScope();
    const state = this.state(scope);
    const endpoint = normalizeEndpoint(url);
    const key = `${method.toUpperCase()} ${endpoint}`;
    const ms = Math.max(0, Math.round(durationMs));

    const prev = state.endpoints.get(key);
    if (prev) {
      prev.count++;
      prev.totalMs += ms;
      prev.minMs = Math.min(prev.minMs, ms);
      prev.maxMs = Math.max(prev.maxMs, ms);
      prev.sumSqMs += ms * ms;
      prev.lastStatus = status;
      prev.lastAt = Date.now();
      if (!ok) {
        prev.errors++;
      }
    } else {
      state.endpoints.set(key, {
        key,
        count: 1,
        errors: ok ? 0 : 1,
        totalMs: ms,
        minMs: ms,
        maxMs: ms,
        sumSqMs: ms * ms,
        lastStatus: status,
        lastAt: Date.now(),
      });
    }

    this.bumpBucket(state, !ok);
    if (!ok) {
      this.pushError(state, method, endpoint, status, ms);
    }
    this.version.update((v) => v + 1);
    this.scheduleFlush(scope);
  }

  private bumpBucket(state: MetricsState, isError: boolean): void {
    const t = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
    const last = state.buckets[state.buckets.length - 1];
    if (last && last.t === t) {
      last.count++;
      if (isError) {
        last.errors++;
      }
    } else {
      state.buckets.push({ t, count: 1, errors: isError ? 1 : 0 });
      if (state.buckets.length > MAX_BUCKETS) {
        state.buckets = state.buckets.slice(-MAX_BUCKETS);
      }
    }
  }

  private pushError(
    state: MetricsState,
    method: string,
    endpoint: string,
    status: number,
    ms: number,
  ): void {
    const message = this.statusMessage(status, ms).slice(0, MAX_MSG_LEN);
    state.errorRing.push({
      at: Date.now(),
      method: method.toUpperCase(),
      endpoint,
      status,
      message,
    });
    if (state.errorRing.length > MAX_ERRORS) {
      state.errorRing = state.errorRing.slice(-MAX_ERRORS);
    }
  }

  private statusMessage(status: number, ms: number): string {
    if (status === 0) {
      return `Network failure (no response) after ${ms}ms`;
    }
    return `HTTP ${status} after ${ms}ms`;
  }

  // ------------------------------------------------------------------- views

  /** All endpoint rows, busiest first. Recomputed when metrics change. */
  readonly stats = computed<EndpointStat[]>(() => {
    this.version();
    return [...this.activeState().endpoints.values()].sort((a, b) => b.count - a.count);
  });

  readonly errors = computed<ApiError[]>(() => {
    this.version();
    // Newest first for display.
    return [...this.activeState().errorRing].reverse();
  });

  readonly timeline = computed<TimeBucket[]>(() => {
    this.version();
    return [...this.activeState().buckets];
  });

  /** Roll-up totals across every endpoint. */
  readonly totals = computed(() => {
    this.version();
    const state = this.activeState();
    let count = 0;
    let errors = 0;
    let totalMs = 0;
    for (const s of state.endpoints.values()) {
      count += s.count;
      errors += s.errors;
      totalMs += s.totalMs;
    }
    return {
      count,
      errors,
      endpoints: state.endpoints.size,
      avgMs: count ? Math.round(totalMs / count) : 0,
      errorRate: count ? errors / count : 0,
    };
  });

  /** Standard deviation of response time for one endpoint row (ms). */
  static stddev(s: EndpointStat): number {
    if (s.count < 2) {
      return 0;
    }
    const mean = s.totalMs / s.count;
    const variance = Math.max(0, s.sumSqMs / s.count - mean * mean);
    return Math.sqrt(variance);
  }

  static mean(s: EndpointStat): number {
    return s.count ? s.totalMs / s.count : 0;
  }

  // ------------------------------------------------------------------- reset

  reset(): void {
    const scope = this.activeScope();
    this.states.set(scope, emptyMetrics());
    this.version.update((v) => v + 1);
    this.flush(scope);
  }

  // ---------------------------------------------------------------- persist

  private scheduleFlush(scope: string): void {
    this.pendingFlushes.add(scope);
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, FLUSH_DEBOUNCE_MS);
  }

  private flushPending(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    for (const scope of this.pendingFlushes) this.flush(scope);
    this.pendingFlushes.clear();
  }

  private flush(scope: string): void {
    const state = this.state(scope);
    const blob: StoredMetrics = {
      v: 1,
      e: [...state.endpoints.values()].map((s) => [
        s.key,
        s.count,
        s.errors,
        s.totalMs,
        s.minMs,
        s.maxMs,
        s.sumSqMs,
        s.lastStatus,
        s.lastAt,
      ]),
      b: state.buckets.map((b) => [b.t, b.count, b.errors]),
      x: state.errorRing.map((e) => [e.at, e.method, e.endpoint, e.status, e.message]),
    };
    try {
      localStorage.setItem(storageKey(scope), JSON.stringify(blob));
    } catch {
      // Quota exceeded (or storage disabled): drop the oldest half of the
      // error ring and buckets and try once more; metrics are best-effort.
      state.errorRing = state.errorRing.slice(-Math.floor(MAX_ERRORS / 2));
      state.buckets = state.buckets.slice(-Math.floor(MAX_BUCKETS / 2));
      try {
        localStorage.setItem(storageKey(scope), JSON.stringify({ ...blob, b: [], x: [] }));
      } catch {
        // Give up silently; observability must never break the app.
      }
    }
  }

  private activeScope(): string {
    return serverScope(this.server.baseUrl());
  }

  private activeState(): MetricsState {
    return this.state(this.activeScope());
  }

  private state(scope: string): MetricsState {
    const existing = this.states.get(scope);
    if (existing) return existing;
    const loaded = this.load(scope);
    this.states.set(scope, loaded);
    return loaded;
  }

  private load(scope: string): MetricsState {
    let blob: StoredMetrics | null;
    try {
      const key = storageKey(scope);
      const raw = localStorage.getItem(key);
      blob = raw ? (JSON.parse(raw) as StoredMetrics) : null;
    } catch {
      blob = null;
    }
    const state = emptyMetrics();
    if (!blob || blob.v !== 1) {
      return state;
    }
    for (const row of blob.e ?? []) {
      const [key, count, errors, totalMs, minMs, maxMs, sumSqMs, lastStatus, lastAt] = row;
      state.endpoints.set(key, {
        key,
        count,
        errors,
        totalMs,
        minMs,
        maxMs,
        sumSqMs,
        lastStatus,
        lastAt,
      });
    }
    state.buckets = (blob.b ?? []).map(([t, count, errors]) => ({ t, count, errors }));
    state.errorRing = (blob.x ?? []).map(([at, method, endpoint, status, message]) => ({
      at,
      method,
      endpoint,
      status,
      message,
    }));
    return state;
  }
}
