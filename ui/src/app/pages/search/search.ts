import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { SearchResults, Status, Tag } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { FindPeople } from '../find-people/find-people';

type SearchType = 'accounts' | 'statuses' | 'hashtags';

/** The mastodon.social full-text-search date operators the advanced panel builds. */
const DATE_OPERATORS = ['before', 'after', 'during'] as const;
type DateOperator = (typeof DATE_OPERATORS)[number];

@Component({
  selector: 'app-search',
  imports: [FormsModule, RouterLink, StatusCard, FindPeople],
  templateUrl: './search.html',
  styleUrl: './search.css',
})
export class Search implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected query = signal('');
  protected results = signal<SearchResults | null>(null);
  protected searching = signal(false);
  protected type = signal<SearchType>('accounts');

  // Advanced panel: date pickers that compose before:/after:/during: operators
  // into the query itself (they're plain query syntax on mastodon.social, so
  // the assembled query stays visible and hand-editable in the box).
  protected advancedOpen = signal(false);
  protected before = signal('');
  protected after = signal('');
  protected during = signal('');

  // Idle-state trends: shown under the box before anything is searched.
  protected trendingPosts = signal<Status[]>([]);
  protected trendingTags = signal<Tag[]>([]);
  private trendsRequested = false;

  ngOnInit(): void {
    // Restore the query/type from the URL so that returning here (e.g. via the
    // browser back button after visiting a result) re-runs the same search
    // instead of showing an empty page.
    this.route.queryParamMap.subscribe((params) => {
      const q = params.get('q') ?? '';
      const t = (params.get('type') as SearchType) ?? 'accounts';
      this.query.set(q);
      this.type.set(t);
      if (q.trim()) {
        this.fetch(q.trim(), t);
      } else {
        this.results.set(null);
        this.loadTrends();
      }
    });
  }

  /** Fetch trending posts + tags once, for the idle states. Failures show nothing. */
  private loadTrends(): void {
    if (this.trendsRequested) {
      return;
    }
    this.trendsRequested = true;
    this.api.trendingStatuses().subscribe({
      next: (posts) => this.trendingPosts.set(posts),
      error: () => {},
    });
    this.api.trendingTags().subscribe({
      next: (tags) => this.trendingTags.set(tags),
      error: () => {},
    });
  }

  /** Sum of a tag's recent-history `uses` for the "N recent uses" line. */
  tagUses(tag: Tag): number {
    return (tag.history ?? []).reduce((sum, h) => sum + Number(h.uses || 0), 0);
  }

  run(): void {
    const q = this.query().trim();
    if (!q) {
      return;
    }
    // Push the search into the URL; ngOnInit's subscription performs the fetch.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q, type: this.type() },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Rewrite the query's date operators from the pickers (dropping any typed by
   * hand first, so the panel is the single source of truth) and search.
   */
  applyAdvanced(): void {
    let q = this.query();
    for (const op of DATE_OPERATORS) {
      q = q.replace(new RegExp(`\\s*\\b${op}:\\S+`, 'gi'), '');
    }
    q = q.trim();
    const picked: [DateOperator, string][] = [
      ['before', this.before()],
      ['after', this.after()],
      ['during', this.during()],
    ];
    for (const [op, date] of picked) {
      if (date) {
        q = `${q} ${op}:${date}`.trim();
      }
    }
    this.query.set(q);
    if (q) {
      // Date operators only apply to full-text status search.
      this.type.set('statuses');
      this.run();
    }
  }

  clearAdvanced(): void {
    this.before.set('');
    this.after.set('');
    this.during.set('');
  }

  private fetch(q: string, type: SearchType): void {
    this.searching.set(true);
    // Handle- or URL-shaped queries get resolve=true so the server webfingers
    // accounts it hasn't federated with yet (how you find someone by address).
    const resolve =
      type === 'accounts' && (/^@?[\w.-]+@[\w.-]+\.\w+$/.test(q) || /^https?:\/\//.test(q));
    this.api.search(q, type, resolve ? { resolve: true } : undefined).subscribe({
      next: (r) => {
        this.results.set(r);
        this.searching.set(false);
      },
      error: () => this.searching.set(false),
    });
  }

  onChanged(updated: Status): void {
    this.results.update((r) =>
      r ? { ...r, statuses: r.statuses.map((s) => (s.id === updated.id ? updated : s)) } : r,
    );
  }

  onTrendChanged(updated: Status): void {
    this.trendingPosts.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
  }

  onTrendDeleted(removed: Status): void {
    this.trendingPosts.update((list) => list.filter((s) => s.id !== removed.id));
  }

  onDeleted(removed: Status): void {
    this.results.update((r) =>
      r ? { ...r, statuses: r.statuses.filter((s) => s.id !== removed.id) } : r,
    );
  }
}
