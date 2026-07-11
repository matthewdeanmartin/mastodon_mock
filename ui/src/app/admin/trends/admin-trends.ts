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

  /** Ids that have been approved/rejected this session, for transient feedback. */
  protected moderated = signal<Record<string, 'approved' | 'rejected'>>({});

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

  private mark(id: string, state: 'approved' | 'rejected'): void {
    this.moderated.update((m) => ({ ...m, [id]: state }));
  }

  approveTag(tag: TrendingTag): void {
    this.api.approveTrendingTag(tag.id).subscribe(() => this.mark('tag-' + tag.id, 'approved'));
  }

  rejectTag(tag: TrendingTag): void {
    this.api.rejectTrendingTag(tag.id).subscribe(() => this.mark('tag-' + tag.id, 'rejected'));
  }

  approveStatus(status: Status): void {
    this.api
      .approveTrendingStatus(status.id)
      .subscribe(() => this.mark('status-' + status.id, 'approved'));
  }

  rejectStatus(status: Status): void {
    this.api
      .rejectTrendingStatus(status.id)
      .subscribe(() => this.mark('status-' + status.id, 'rejected'));
  }
}
