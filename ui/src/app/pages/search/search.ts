import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { SearchResults, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';

@Component({
  selector: 'app-search',
  imports: [FormsModule, RouterLink, StatusCard],
  templateUrl: './search.html',
  styleUrl: './search.css',
})
export class Search {
  private api = inject(Api);

  protected query = signal('');
  protected results = signal<SearchResults | null>(null);
  protected searching = signal(false);

  run(): void {
    const q = this.query().trim();
    if (!q) {
      return;
    }
    this.searching.set(true);
    this.api.search(q).subscribe({
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
