import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ALL_SCOPES,
  ApiError,
  ApiMetrics,
  BUCKET_MS,
  ClientErrorGroup,
  DayBucket,
  EndpointStat,
  LatencyFamily,
  LatencyPoint,
  TimeBucket,
} from '../../observability/api-metrics';
import { EndpointDoc, endpointDoc } from '../../observability/api-docs';
import { CorsProxySettings } from '../../providers/cors-proxy/cors-proxy-settings';
import { CorsProxyUsageStore } from '../../providers/cors-proxy/cors-proxy-usage';
import { TwitterUsage } from '../../providers/twitter/twitter-usage';
import { RssSubscriptions } from '../../providers/rss/rss-subscriptions';
import {
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
/** Heights of the two stacked charts. Latency is shorter; it is a trend, not a total. */
const VOLUME_H = 150;
const LATENCY_H = 130;
/**
 * Minimum bar slots on the volume chart. With fewer days than this, bars keep
 * their width and the chart is left-aligned rather than stretching three days
 * across an axis that would then imply three months.
 */
const MIN_VOLUME_SLOTS = 14;
/** Space a latency axis label needs above a gridline before it clips. */
const TICK_LABEL_MARGIN = 11;

/** One day's latency point, laid out in SVG space. */
interface LatencyPlot {
  point: LatencyPoint;
  x: number;
  /** Null when the day had too few samples to place a median. */
  y: number | null;
}

/** One family's drawn geometry. */
interface LatencySeries {
  name: LatencyFamily;
  /** Median polylines, split at gaps. */
  segments: string[];
  /** Filled p25–p95 band polygons, split at gaps. */
  band: string[];
  points: LatencyPlot[];
}

/**
 * Split a series into polyline strings, breaking wherever a day has no median.
 *
 * The break is the point. Joining across a quiet day would draw a confident
 * line through a period that was never measured, and the reader has no way to
 * tell that segment from a measured one.
 */
function segmentsOf(
  points: LatencyPoint[],
  x: (i: number) => number,
  y: (ms: number) => number,
): string[] {
  const out: string[] = [];
  let run: string[] = [];
  points.forEach((p, i) => {
    if (p.median === null) {
      if (run.length > 1) {
        out.push(run.join(' '));
      }
      run = [];
      return;
    }
    run.push(`${x(i).toFixed(1)},${y(p.median).toFixed(1)}`);
  });
  if (run.length > 1) {
    out.push(run.join(' '));
  }
  return out;
}

/**
 * The p25–p95 band as filled polygons, again split at gaps.
 *
 * A run of a single banded day yields no polygon: a band needs two points to
 * have a width, and a lone day's spread is shown by its tooltip instead.
 */
function bandOf(
  points: LatencyPoint[],
  x: (i: number) => number,
  y: (ms: number) => number,
): string[] {
  const out: string[] = [];
  let upper: string[] = [];
  let lower: string[] = [];
  const close = (): void => {
    if (upper.length > 1) {
      out.push([...upper, ...lower.reverse()].join(' '));
    }
    upper = [];
    lower = [];
  };
  points.forEach((p, i) => {
    if (p.p25 === null || p.p95 === null) {
      close();
      return;
    }
    upper.push(`${x(i).toFixed(1)},${y(p.p95).toFixed(1)}`);
    lower.push(`${x(i).toFixed(1)},${y(p.p25).toFixed(1)}`);
  });
  close();
  return out;
}

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
  styleUrls: ['./diagnostics-shared.css', './observability.css'],
})
export class Observability {
  private metrics = inject(ApiMetrics);
  private routeLog = inject(RouteLog);
  private proxyUsageStore = inject(CorsProxyUsageStore);
  /** Twitter spend, for the section that exists because these requests cost money. */
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

  // ----------------------------------------------------------- server picker

  protected readonly allScopes = ALL_SCOPES;
  protected readonly scopes = this.metrics.scopes;
  protected readonly scope = this.metrics.scope;

  /** True when the view is merged across every server. */
  protected readonly merged = computed(() => this.scope() === ALL_SCOPES);

  selectScope(value: string): void {
    this.metrics.selectScope(value);
  }

  onScopeChange(event: Event): void {
    this.selectScope((event.target as HTMLSelectElement).value);
  }

  /** A server origin without its scheme, for a label that fits a dropdown. */
  protected scopeLabel(scope: string): string {
    return scope.replace(/^https?:\/\//, '');
  }

  resetProxyUsage(): void {
    this.proxyUsageStore.reset();
  }

  constructor() {
    // Bank the time spent getting here, so this page's own row isn't stale.
    this.routeLog.refresh();
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

  // ----------------------------------------------------- volume + latency charts

  protected readonly volumeH = VOLUME_H;
  protected readonly latencyH = LATENCY_H;

  /**
   * The daily volume chart: one bar per day, errors stacked on top.
   *
   * Bars rather than the old line, because the quantity is a *count over an
   * interval* and a line between two daily totals implies intermediate values
   * that were never measured. The previous chart drew a line across one-minute
   * buckets, which is why it looked like noise: it was noise, faithfully
   * rendered.
   */
  protected readonly volumeChart = computed(() => {
    const days = this.metrics.daily();
    if (!days.length) {
      return null;
    }
    const max = Math.max(1, ...days.map((d) => d.count));
    const innerW = CHART_W - CHART_PAD * 2;
    const innerH = VOLUME_H - CHART_PAD * 2;
    // Bars are laid out on a fixed slot width so a 3-day history reads as three
    // bars near the left, not three columns stretched across the whole box —
    // stretching would imply the axis covers a span it does not.
    const slot = innerW / Math.max(days.length, MIN_VOLUME_SLOTS);
    const barW = Math.max(1, slot * 0.7);
    const bars = days.map((d, i) => {
      const h = (d.count / max) * innerH;
      const errH = (d.errors / max) * innerH;
      return {
        day: d,
        x: CHART_PAD + i * slot + (slot - barW) / 2,
        w: barW,
        // Errors sit at the top of the bar, so the total height stays the total.
        y: CHART_PAD + innerH - h,
        h: Math.max(d.count ? 1 : 0, h),
        errY: CHART_PAD + innerH - h,
        errH,
      };
    });
    return { bars, max, baseline: CHART_PAD + innerH };
  });

  /**
   * The latency chart: median line plus a p25–p95 band, one series per family.
   *
   * Both families share a y-axis so they are honestly comparable, and the axis
   * is logarithmic — a linear axis with search at 900 ms and a timeline read at
   * 8 ms flattens the fast series onto the floor, which is exactly the series
   * most calls belong to.
   */
  protected readonly latencyChart = computed(() => {
    const fast = this.metrics.latencySeries('fast');
    const slow = this.metrics.latencySeries('slow');
    const all = [...fast, ...slow];
    const values = all.flatMap((p) =>
      [p.median, p.p25, p.p95].filter((v): v is number => v !== null),
    );
    if (values.length < 2) {
      return null;
    }
    const lo = Math.max(1, Math.min(...values));
    const hi = Math.max(...values, lo * 2);
    const innerW = CHART_W - CHART_PAD * 2;
    const innerH = LATENCY_H - CHART_PAD * 2;
    const span = Math.max(1, all.length ? fast.length - 1 : 1);
    const logLo = Math.log(lo);
    const logHi = Math.log(hi);
    const y = (ms: number): number =>
      CHART_PAD + innerH - ((Math.log(Math.max(1, ms)) - logLo) / (logHi - logLo)) * innerH;
    const x = (i: number): number => CHART_PAD + (span === 0 ? 0 : i / span) * innerW;

    const series = (points: LatencyPoint[], name: LatencyFamily): LatencySeries => ({
      name,
      // Segments, not one polyline: a day below the sample floor is a gap, and
      // a polyline would bridge it with a straight line that asserts continuity
      // the data does not have.
      segments: segmentsOf(points, x, y),
      band: bandOf(points, x, y),
      points: points.map((p, i) => ({
        point: p,
        x: x(i),
        y: p.median === null ? null : y(p.median),
      })),
    });
    return { fast: series(fast, 'fast'), slow: series(slow, 'slow'), lo, hi };
  });

  /** Axis ticks for the latency chart, at readable round magnitudes. */
  protected readonly latencyTicks = computed(() => {
    const c = this.latencyChart();
    if (!c) {
      return [];
    }
    const innerH = LATENCY_H - CHART_PAD * 2;
    const logLo = Math.log(c.lo);
    const logHi = Math.log(c.hi);
    return [1, 10, 100, 1_000, 10_000]
      .filter((ms) => ms >= c.lo && ms <= c.hi)
      .map((ms) => {
        const y = CHART_PAD + innerH - ((Math.log(ms) - logLo) / (logHi - logLo)) * innerH;
        return {
          ms,
          label: ms >= 1_000 ? `${ms / 1_000}s` : `${ms}ms`,
          y,
          // The label sits above its gridline, except near the top of the box
          // where that would clip it against the border — there it drops below.
          labelY: y < TICK_LABEL_MARGIN ? y + TICK_LABEL_MARGIN : y - 3,
        };
      });
  });

  /** Day label for an axis or tooltip ("Aug 18"). */
  protected dayLabel(t: number): string {
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** Tooltip text for a volume bar. */
  protected volumeLabel(d: DayBucket): string {
    return `${this.dayLabel(d.t)} · ${d.count.toLocaleString()} call${d.count === 1 ? '' : 's'}${
      d.errors ? ` · ${d.errors} error${d.errors === 1 ? '' : 's'}` : ''
    }`;
  }

  /** Tooltip text for a latency point, including why a band may be missing. */
  protected latencyLabel(p: LatencyPoint, family: LatencyFamily): string {
    if (p.median === null) {
      return `${this.dayLabel(p.t)} · ${family} · ${p.n} sample${p.n === 1 ? '' : 's'} — too few to summarise`;
    }
    const band =
      p.p25 === null
        ? ` (no spread shown: ${p.n} samples)`
        : ` · p25 ${this.round(p.p25)}ms · p95 ${this.round(p.p95!)}ms`;
    return `${this.dayLabel(p.t)} · ${family} · median ${this.round(p.median)}ms${band} · n=${p.n}`;
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
