import { Component, computed, inject, signal } from '@angular/core';
import {
  ApiError,
  ApiMetrics,
  BUCKET_MS,
  EndpointStat,
  TimeBucket,
} from '../../observability/api-metrics';
import {
  StorageEntry,
  StorageReport,
  formatBytes,
  inspectLocalStorage,
} from '../../observability/local-storage-inspector';

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

/**
 * The Observability page: API-call metrics (per-endpoint stats + a
 * calls-over-time chart), a recent-error log, and a localStorage inspector with
 * per-key sizes and delete buttons. All data comes from {@link ApiMetrics} (see
 * that service for the compact storage scheme) and a live localStorage scan.
 */
@Component({
  selector: 'app-observability',
  imports: [],
  templateUrl: './observability.html',
  styleUrl: './observability.css',
})
export class Observability {
  private metrics = inject(ApiMetrics);

  protected readonly totals = this.metrics.totals;
  protected readonly errors = this.metrics.errors;
  protected readonly serverLabel = this.metrics.serverLabel;
  protected readonly formatBytes = formatBytes;

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
    if (!confirm('Clear all collected API metrics, the timeline, and the error log?')) {
      return;
    }
    this.metrics.reset();
    this.refreshStorage();
  }
}
