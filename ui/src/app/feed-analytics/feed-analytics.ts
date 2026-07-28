import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../api';
import { Auth } from '../auth';
import { HumanTimePipe } from '../human-time.pipe';
import { Status } from '../models';
import { StatusCard } from '../status-card/status-card';
import { FeedReport, analyzeFeed, pct } from '../feed-metrics';
import { FeedSource, isSupplied, sampleFeed } from '../feed-sample';
import { LANG_NAMES } from '../language-detect';

export type { FeedSource } from '../feed-sample';

/** Sample sizes the user can pick between on a paged feed. */
export const SAMPLE_CHOICES = [50, 100, 200] as const;
/** Default sample: 100 posts, three requests at Mastodon's 40-post page cap. */
export const DEFAULT_SAMPLE = 100;
/** Authors resolved per relationships call — Mastodon accepts them batched. */
const RELATIONSHIP_BATCH = 80;
/** How many rows the long tables show before "show all". */
const PREVIEW_ROWS = 8;

/**
 * Analytics for a sampled feed — the counterpart to `AccountAnalytics`, which
 * profiles one account's own output. Everything is computed client-side from
 * the posts in the sample (see `feed-metrics.ts`); no per-post requests are
 * made, so a paged feed costs 3–10 calls and a synthetic one costs none.
 *
 * Collection starts when the component mounts, so keep it behind a lazily-shown
 * tab rather than rendering it alongside the feed itself.
 */
@Component({
  selector: 'app-feed-analytics',
  imports: [RouterLink, StatusCard, HumanTimePipe],
  templateUrl: './feed-analytics.html',
  styleUrl: './feed-analytics.css',
})
export class FeedAnalytics {
  private api = inject(Api);
  private auth = inject(Auth);

  /** The feed to sample. Changing it restarts collection. */
  readonly source = input.required<FeedSource>();

  protected readonly sampleChoices = SAMPLE_CHOICES;
  protected sampleSize = signal<number>(DEFAULT_SAMPLE);

  protected loading = signal(true);
  protected error = signal(false);
  protected posts = signal<Status[]>([]);
  protected apiCalls = signal(0);
  protected collectedAt = signal(new Date().toISOString());
  /** Account ids the viewer follows; null until (or unless) resolved. */
  private followingIds = signal<ReadonlySet<string> | null>(null);

  /** Which long tables have been expanded past their preview. */
  private expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly previewRows = PREVIEW_ROWS;

  constructor() {
    // Collection is driven by the two things that define a sample: which feed
    // and how many posts. `untracked` keeps the fetch itself from registering
    // any further dependencies.
    effect(() => {
      const source = this.source();
      const size = this.sampleSize();
      untracked(() => this.collect(source, size));
    });
  }

  private collect(source: FeedSource, size: number): void {
    this.loading.set(true);
    this.error.set(false);
    this.posts.set([]);
    this.apiCalls.set(0);
    this.followingIds.set(null);
    sampleFeed(source, size).subscribe((sample) => {
      this.posts.set(sample.posts);
      this.apiCalls.set(sample.apiCalls);
      this.error.set(sample.failed);
      this.collectedAt.set(new Date().toISOString());
      this.loading.set(false);
      this.resolveFollows(sample.posts);
    });
  }

  /** Synthetic feeds are handed over whole, so there is no sample size to pick. */
  protected paged = computed(() => !isSupplied(this.source()));

  /**
   * Followed-vs-unfollowed is the one metric the status payload can't answer.
   * It costs exactly one batched request, and only for signed-in viewers — the
   * report renders without it and fills the row in when it lands.
   */
  private resolveFollows(posts: Status[]): void {
    if (this.auth.isAnonymous || !posts.length) {
      return;
    }
    const ids = [...new Set(posts.map((p) => (p.reblog ?? p).account.id))].slice(
      0,
      RELATIONSHIP_BATCH,
    );
    this.api.relationships(ids).subscribe({
      next: (rels) => {
        this.apiCalls.update((n) => n + 1);
        this.followingIds.set(new Set(rels.filter((r) => r.following).map((r) => r.id)));
      },
      error: () => this.followingIds.set(null),
    });
  }

  /** Re-collect at a different sample size. */
  setSampleSize(size: number): void {
    if (size !== this.sampleSize()) {
      this.sampleSize.set(size);
    }
  }

  /** Re-run collection against the same feed, for a fresh snapshot. */
  refresh(): void {
    this.collect(this.source(), this.sampleSize());
  }

  // --- The report ---

  protected report = computed<FeedReport>(() => {
    const following = this.followingIds();
    return analyzeFeed(
      this.posts(),
      {
        feedType: this.source().type,
        feedQuery: this.source().query,
        apiCalls: this.apiCalls(),
        collectedAt: this.collectedAt(),
      },
      following ? { followingIds: following } : {},
    );
  });

  /** Peak hour count, for scaling the hour-of-day bars. */
  protected hourPeak = computed(() => Math.max(1, ...this.report().recency.byHour));
  /** Peak day count, for scaling the per-day bars. */
  protected dayPeak = computed(() =>
    Math.max(1, ...this.report().recency.byDay.map((d) => d.posts)),
  );
  /** Peak slice average, for scaling the engagement comparison bars. */
  protected slicePeak = computed(() =>
    Math.max(1, ...this.report().engagement.slices.map((s) => s.avgEngagement)),
  );

  /**
   * The composition breakdown as bar rows. Percentages are of the whole sample
   * and deliberately overlap — a post can be a reply *and* carry media.
   */
  protected compositionRows = computed(() => {
    const c = this.report().composition;
    return [
      { label: 'Original posts', count: c.original },
      { label: 'Boosts', count: c.boosts },
      { label: 'Replies', count: c.replies },
      { label: 'Standalone posts', count: c.standalone },
      { label: 'With media', count: c.withMedia },
      { label: 'With links', count: c.withLinks },
      { label: 'With polls', count: c.withPolls },
      { label: 'Behind a content warning', count: c.withContentWarning },
    ].map((row) => ({ ...row, share: c.total ? row.count / c.total : 0 }));
  });

  /** Whether a named table is showing all of its rows. */
  isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  toggleExpanded(key: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  /** Rows to render for a table: a preview, unless it has been expanded. */
  visible<T>(key: string, rows: T[]): T[] {
    return this.isExpanded(key) ? rows : rows.slice(0, PREVIEW_ROWS);
  }

  /** Human name for a language code; `und` covers posts with none declared. */
  langName(code: string): string {
    if (code === 'und') {
      return 'Not declared';
    }
    return LANG_NAMES[code as keyof typeof LANG_NAMES] ?? code.toUpperCase();
  }

  /**
   * The "largest" cell of a concentration row. The metrics module keeps raw
   * keys, so the language dimension needs the same name mapping the language
   * table gets rather than showing a bare `und`.
   */
  concLargest(row: { label: string; largest: string }): string {
    return row.label === 'Languages' ? this.langName(row.largest) : row.largest;
  }

  /** Hostname of a URL, for compact display of repeated links. */
  shortUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname === '/' ? '' : parsed.pathname;
      return parsed.hostname.replace(/^www\./, '') + path;
    } catch {
      return url;
    }
  }

  /** The age of the sample, phrased in whatever unit reads best. */
  protected sampleSpan = computed(() => {
    const hours = this.report().recency.spanHours;
    if (hours < 1) {
      return `${Math.round(hours * 60)} minutes`;
    }
    if (hours < 48) {
      return `${Math.round(hours)} hours`;
    }
    return `${Math.round(hours / 24)} days`;
  });

  pct = pct;
}
