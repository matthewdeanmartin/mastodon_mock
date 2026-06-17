import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApi } from '../admin-api';
import { Status, TrendingTag } from '../../models';
import { StatusCard } from '../../status-card/status-card';

/** Read-only trends viewer: trending hashtags and most-favourited statuses. */
@Component({
  selector: 'app-admin-trends',
  imports: [RouterLink, StatusCard],
  templateUrl: './admin-trends.html',
  styleUrl: './admin-trends.css',
})
export class AdminTrends implements OnInit {
  private api = inject(AdminApi);

  protected tags = signal<TrendingTag[]>([]);
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.api.trendingTags().subscribe((t) => this.tags.set(t));
    this.api.trendingStatuses().subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Total uses across the tag's 7-day history (counts are strings in the API). */
  uses(tag: TrendingTag): number {
    return tag.history.reduce((sum, h) => sum + Number(h.uses), 0);
  }
}
