import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ApiError,
  ApiMetrics,
  BUCKET_MS,
  ClientErrorGroup,
  EndpointStat,
  TimeBucket,
} from '../../observability/api-metrics';
import { EndpointDoc, endpointDoc } from '../../observability/api-docs';
import { CorsProxySettings } from '../../providers/cors-proxy/cors-proxy-settings';
import { CorsProxyUsageStore } from '../../providers/cors-proxy/cors-proxy-usage';
import { TwitterUsage } from '../../providers/twitter/twitter-usage';
import { RssSubscriptions } from '../../providers/rss/rss-subscriptions';
import {
  DatabaseInfo,
  IndexedDbReport,
  inspectIndexedDb,
  totalRecords,
} from '../../observability/indexed-db-inspector';
import {
  StorageEntry,
  StorageReport,
  formatBytes,
  inspectLocalStorage,
} from '../../observability/local-storage-inspector';
import { RouteLog, RouteStat, formatDuration } from '../../observability/route-log';

/** How the endpoint table is sorted. */
type SortKey = 'count' | 'avg' | 'max' | 'errors';

/** A point on the calls-over-time chart, laid out in SVG space. */
interface ChartPoint {
  x: number;
  y: number;
  yErr: number;
  bucket: TimeBucket;
}

const CHART_W = 720;
const CHART_H = 160;
const CHART_PAD = 4;

/** How the route table is sorted. */
type RouteSortKey = 'visits' | 'time';

/**
 * The Observability page — everything this browser knows about how the app is
 * behaving, and how it's being used:
 *
 *  - **API calls** — per-endpoint stats, a calls-over-time chart, and a link
 *    from every endpoint to its official documentation ({@link endpointDoc}).
 *  - **Recent errors** — the last failing API calls.
 *  - **Client errors** — JS exceptions grouped by kind, with counts.
 *  - **Local storage** — per-key sizes, with delete.
 *  - **IndexedDB** — databases, stores, record counts, and the origin's quota.
 *  - **Route log** — visits and time spent per route.
 *
 * Data comes from {@link ApiMetrics} and {@link RouteLog} (see those services
 * for the count-don't-store storage schemes) plus live storage scans. Nothing
 * on this page is sent anywhere.
 */
@Component({
  selector: 'app-observability',
  imports: [RouterLink],
  templateUrl: './observability.html',
  styleUrl: './observability.css',
})
export class Observability {
  private metrics = inject(ApiMetrics);
  private routeLog = inject(RouteLog);
  private proxyUsageStore = inject(CorsProxyUsageStore);
  /** X spend, for the section that exists because these requests cost money. */
  protected twitterUsage = inject(TwitterUsage);
  private proxySettings = inject(CorsProxySettings);
  private rssSubs = inject(RssSubscriptions);

  protected readonly totals = this.metrics.totals;
  protected readonly errors = this.metrics.errors;
  protected readonly clientErrors = this.metrics.clientErrors;
  protected readonly clientErrorTotals = this.metrics.clientErrorTotals;
  protected readonly serverLabel = this.metrics.serverLabel;
  protected readonly formatBytes = formatBytes;
  protected readonly formatDuration = formatDuration;

  protected readonly proxyUsage = this.proxyUsageStore.usage;
  protected readonly proxyLabel = computed(() => this.proxySettings.chosen()?.label ?? null);
  protected readonly proxiedFeedCount = computed(() => this.rssSubs.proxiedCount());

  resetProxyUsage(): void {
    this.proxyUsageStore.reset();
  }

  constructor() {
    // Bank the time spent getting here, so this page's own row isn't stale.
    this.routeLog.refresh();
    void this.refreshIndexedDb();
  }

  protected readonly sortKey = signal<SortKey>('count');

  /** The endpoint stat rows, sorted by the chosen column. */
  protected readonly rows = computed<EndpointStat[]>(() => {
    const key = this.sortKey();
    const stats = [...this.metrics.stats()];
    const value = (s: EndpointStat): number => {
      switch (key) {
        case 'avg':
          return ApiMetrics.mean(s);
        case 'max':
          return s.maxMs;
        case 'errors':
          return s.errors;
        default:
          return s.count;
      }
    };
    return stats.sort((a, b) => value(b) - value(a));
  });

  /** The single busiest / slowest / most-error-prone endpoints, for the tiles. */
  protected readonly highlights = computed(() => {
    const stats = this.metrics.stats();
    if (!stats.length) {
      return null;
    }
    const busiest = stats.reduce((a, b) => (b.count > a.count ? b : a));
    const slowest = stats.reduce((a, b) => (ApiMetrics.mean(b) > ApiMetrics.mean(a) ? b : a));
    const fastest = stats.reduce((a, b) => (ApiMetrics.mean(b) < ApiMetrics.mean(a) ? b : a));
    const worst = stats.reduce((a, b) => (this.rate(b) > this.rate(a) ? b : a));
    return { busiest, slowest, fastest, worst };
  });

  private rate(s: EndpointStat): number {
    return s.count ? s.errors / s.count : 0;
  }

  // ---------------------------------------------------------------- helpers

  protected mean(s: EndpointStat): number {
    return ApiMetrics.mean(s);
  }

  protected stddev(s: EndpointStat): number {
    return ApiMetrics.stddev(s);
  }

  protected round(n: number): number {
    return Math.round(n);
  }

  protected pct(n: number): string {
    return `${(n * 100).toFixed(1)}%`;
  }

  protected method(key: string): string {
    return key.split(' ', 1)[0];
  }

  protected endpoint(key: string): string {
    return key.slice(this.method(key).length + 1);
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString();
  }

  protected when(at: number): string {
    return new Date(at).toLocaleString();
  }

  /**
   * Compact date + time for a table column ("Jul 30, 7:37 AM"). The full
   * timestamp is still in the row's tooltip; the column just has to fit.
   */
  protected stamp(at: number): string {
    return new Date(at).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // -------------------------------------------------------------- docs links

  /**
   * The documentation link for an endpoint key, or null if it isn't a Mastodon
   * endpoint. Memoized because the table re-renders on every sort and every
   * recorded call, and a miss walks the whole shape bucket.
   */
  private readonly docCache = new Map<string, EndpointDoc | null>();

  protected doc(key: string): EndpointDoc | null {
    const cached = this.docCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const found = endpointDoc(key);
    this.docCache.set(key, found);
    return found;
  }

  /** Tooltip for the docs link: what the call does, and how sure we are. */
  protected docTitle(key: string): string {
    const d = this.doc(key);
    if (!d) {
      return '';
    }
    return d.match === 'exact'
      ? `${d.summary || 'View documentation'} — opens docs.joinmastodon.org`
      : 'No exact match; opens the documentation section for this API family';
  }

  // ----------------------------------------------------------- client errors

  /** Full detail for a client-error row's hover tooltip. */
  protected clientErrorDetail(g: ClientErrorGroup): string {
    return [
      `${g.type}: ${g.message}`,
      g.where ? g.where : null,
      `${g.count} occurrence${g.count === 1 ? '' : 's'} (${g.source})`,
      `first ${this.when(g.firstAt)}`,
      `last ${this.when(g.lastAt)}`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }

  // --------------------------------------------------------------- IndexedDB

  protected readonly idb = signal<IndexedDbReport | null>(null);
  protected readonly idbLoading = signal(false);
  protected readonly totalRecords = totalRecords;

  async refreshIndexedDb(): Promise<void> {
    this.idbLoading.set(true);
    try {
      this.idb.set(await inspectIndexedDb());
    } finally {
      this.idbLoading.set(false);
    }
  }

  /** `"12.4 MB of 2.1 GB (0.6%)"`, or a shorter form when the browser is coy. */
  protected quotaLabel(): string {
    const q = this.idb()?.quota;
    if (!q || q.usage === null) {
      return 'Storage usage unavailable in this browser.';
    }
    const used = formatBytes(q.usage);
    if (q.quota === null) {
      return `${used} used`;
    }
    const pct = q.ratio === null ? '' : ` (${(q.ratio * 100).toFixed(1)}%)`;
    return `${used} of ${formatBytes(q.quota)}${pct}`;
  }

  protected storeSummary(db: DatabaseInfo): string {
    if (db.error) {
      return db.error;
    }
    if (!db.stores.length) {
      return 'no object stores';
    }
    return db.stores.map((s) => `${s.name} (${s.count ?? '?'})`).join(', ');
  }

  // --------------------------------------------------------------- route log

  protected readonly routeTotals = this.routeLog.totals;
  protected readonly routeSortKey = signal<RouteSortKey>('visits');

  protected readonly routeRows = computed<RouteStat[]>(() => {
    const key = this.routeSortKey();
    const stats = [...this.routeLog.stats()];
    return stats.sort((a, b) => (key === 'time' ? b.totalMs - a.totalMs : b.visits - a.visits));
  });

  setRouteSort(key: RouteSortKey): void {
    this.routeSortKey.set(key);
  }

  /** Average time per visit — the "is this a glance or a session" number. */
  protected avgDwell(s: RouteStat): number {
    return s.visits ? s.totalMs / s.visits : 0;
  }

  refreshRoutes(): void {
    this.routeLog.refresh();
  }

  resetRoutes(): void {
    if (!confirm('Clear the route log (visit counts and time spent)?')) {
      return;
    }
    this.routeLog.reset();
    this.refreshStorage();
  }

  /** Full, multi-line error detail for the row's hover tooltip. */
  protected errorDetail(e: ApiError): string {
    const status = e.status === 0 ? 'Network failure (no response)' : `HTTP ${e.status}`;
    return [
      `${e.method} ${e.endpoint}`,
      status,
      e.message,
      `at ${new Date(e.at).toLocaleString()}`,
    ].join('\n');
  }

  setSort(key: SortKey): void {
    this.sortKey.set(key);
  }

  // ------------------------------------------------------------ calls chart

  protected readonly chartW = CHART_W;
  protected readonly chartH = CHART_H;

  /** Chart geometry: one point per time bucket, scaled into the SVG box. */
  protected readonly chart = computed(() => {
    const buckets = this.metrics.timeline();
    if (buckets.length < 2) {
      return null;
    }
    const maxCount = Math.max(1, ...buckets.map((b) => b.count));
    const innerW = CHART_W - CHART_PAD * 2;
    const innerH = CHART_H - CHART_PAD * 2;
    const span = buckets.length - 1;
    const points: ChartPoint[] = buckets.map((b, i) => ({
      x: CHART_PAD + (i / span) * innerW,
      y: CHART_PAD + innerH - (b.count / maxCount) * innerH,
      yErr: CHART_PAD + innerH - (b.errors / maxCount) * innerH,
      bucket: b,
    }));
    const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${CHART_PAD},${CHART_PAD + innerH} ${line} ${(CHART_PAD + innerW).toFixed(1)},${(
      CHART_PAD + innerH
    ).toFixed(1)}`;
    const anyErrors = buckets.some((b) => b.errors > 0);
    const errLine = anyErrors
      ? points.map((p) => `${p.x.toFixed(1)},${p.yErr.toFixed(1)}`).join(' ')
      : null;
    return { points, line, area, errLine, maxCount };
  });

  /** The bucket the pointer is hovering, for the chart tooltip. */
  protected readonly hover = signal<ChartPoint | null>(null);

  onChartMove(event: MouseEvent, svg: Element): void {
    const c = this.chart();
    if (!c) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    // Map the pointer's client x into SVG viewBox x, then to the nearest point.
    const svgX = ((event.clientX - rect.left) / rect.width) * CHART_W;
    let nearest = c.points[0];
    for (const p of c.points) {
      if (Math.abs(p.x - svgX) < Math.abs(nearest.x - svgX)) {
        nearest = p;
      }
    }
    this.hover.set(nearest);
  }

  onChartLeave(): void {
    this.hover.set(null);
  }

  bucketLabel(b: TimeBucket): string {
    const d = new Date(b.t);
    return `${d.toLocaleTimeString()} · ${b.count} call${b.count === 1 ? '' : 's'}${
      b.errors ? ` · ${b.errors} err` : ''
    }`;
  }

  protected readonly bucketMinutes = BUCKET_MS / 60_000;

  // ---------------------------------------------------- localStorage inspector

  protected readonly storage = signal<StorageReport>(inspectLocalStorage());

  refreshStorage(): void {
    this.storage.set(inspectLocalStorage());
  }

  /** Human label for a known key, so the list isn't just opaque slugs. */
  keyNote(key: string): string {
    if (key.startsWith('mockingbird_api_metrics:')) {
      return 'this page’s metrics';
    }
    if (key === 'mockingbird_route_log') {
      return 'this page’s route log';
    }
    if (key.startsWith('mockingbird_')) {
      return 'Mockingbird';
    }
    if (key.startsWith('mastodon_mock_')) {
      return 'session';
    }
    return '';
  }

  deleteKey(entry: StorageEntry): void {
    if (!confirm(`Delete localStorage key "${entry.key}"? This can’t be undone.`)) {
      return;
    }
    localStorage.removeItem(entry.key);
    this.refreshStorage();
  }

  // ------------------------------------------------------------------- reset

  resetMetrics(): void {
    if (
      !confirm(
        'Clear all collected API metrics, the timeline, and both error logs for this server?',
      )
    ) {
      return;
    }
    this.metrics.reset();
    this.refreshStorage();
  }
}
