import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { SearchResults, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { FindPeople } from '../find-people/find-people';

type SearchType = 'accounts' | 'statuses' | 'hashtags';

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
      }
    });
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

  onDeleted(removed: Status): void {
    this.results.update((r) =>
      r ? { ...r, statuses: r.statuses.filter((s) => s.id !== removed.id) } : r,
    );
  }
}
