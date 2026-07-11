import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { InstanceInfo, Tag } from '../../models';

/**
 * Right sidebar: trending hashtags, with a discovery box underneath holding the
 * Public/Explore links and basic server info (moved out of the top nav).
 */
@Component({
  selector: 'app-right-rail',
  imports: [RouterLink],
  templateUrl: './right-rail.html',
  styleUrl: './right-rail.css',
})
export class RightRail implements OnInit {
  private api = inject(Api);

  protected trends = signal<Tag[]>([]);
  protected instance = signal<InstanceInfo | null>(null);

  ngOnInit(): void {
    this.api.trendingTags().subscribe({
      next: (tags) => this.trends.set(tags),
      error: () => {
        // Sidebar widget: fail silently.
      },
    });
    this.api.instanceInfo().subscribe({
      next: (info) => this.instance.set(info),
      error: () => {
        // Sidebar widget: fail silently.
      },
    });
  }

  /** Most recent day's use count for a trending tag, if the mock provides one. */
  uses(tag: Tag): string | null {
    return tag.history?.[0]?.uses ?? null;
  }
}
