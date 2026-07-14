import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../../api';
import { ContentFilter } from '../../../models';

/** Filters: list of the user's v2 filters (muted words/phrases live here). */
@Component({
  selector: 'app-settings-filters',
  imports: [RouterLink],
  templateUrl: './settings-filters.html',
  styleUrl: './settings-filters.css',
})
export class SettingsFilters implements OnInit {
  private api = inject(Api);

  protected filters = signal<ContentFilter[]>([]);
  protected loading = signal(false);

  ngOnInit(): void {
    this.loading.set(true);
    this.api.filters().subscribe({
      next: (filters) => {
        this.filters.set(filters);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  remove(filter: ContentFilter): void {
    this.api.deleteFilter(filter.id).subscribe(() => {
      this.filters.update((list) => list.filter((f) => f.id !== filter.id));
    });
  }

  protected keywordSummary(filter: ContentFilter): string {
    const words = filter.keywords.map((k) => k.keyword);
    if (!words.length) {
      return 'No keywords';
    }
    return words.slice(0, 4).join(', ') + (words.length > 4 ? ` +${words.length - 4} more` : '');
  }

  protected expirySummary(filter: ContentFilter): string {
    if (!filter.expires_at) {
      return 'Never expires';
    }
    const when = new Date(filter.expires_at);
    return when.getTime() < Date.now() ? 'Expired' : `Expires ${when.toLocaleString()}`;
  }
}
