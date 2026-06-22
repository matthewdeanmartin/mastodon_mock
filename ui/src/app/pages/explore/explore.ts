import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { InstanceInfo, Status, Tag } from '../../models';

type ExploreTab = 'posts' | 'hashtags';

/**
 * Logged-out discovery surface, mirroring mastodon.social's public landing: a server
 * intro, trending posts/hashtags, and sign-in calls to action. Served with anonymous
 * access (no auth guard); trends + instance metadata are public endpoints.
 */
@Component({
  selector: 'app-explore',
  imports: [RouterLink],
  templateUrl: './explore.html',
  styleUrl: './explore.css',
})
export class Explore implements OnInit {
  private api = inject(Api);
  protected auth = inject(Auth);

  protected tab = signal<ExploreTab>('posts');

  protected instance = signal<InstanceInfo | null>(null);
  protected posts = signal<Status[]>([]);
  protected tags = signal<Tag[]>([]);

  protected loadingPosts = signal(true);
  protected loadingTags = signal(true);

  ngOnInit(): void {
    this.api.instanceInfo().subscribe({
      next: (info) => this.instance.set(info),
      error: () => this.instance.set(null),
    });
    this.api.trendingStatuses().subscribe({
      next: (posts) => {
        this.posts.set(posts);
        this.loadingPosts.set(false);
      },
      error: () => this.loadingPosts.set(false),
    });
    this.api.trendingTags().subscribe({
      next: (tags) => {
        this.tags.set(tags);
        this.loadingTags.set(false);
      },
      error: () => this.loadingTags.set(false),
    });
  }

  selectTab(tab: ExploreTab): void {
    this.tab.set(tab);
  }

  /** Sum of a tag's recent-history `uses` for the "N people in the past N days" line. */
  tagUses(tag: Tag): number {
    return (tag.history ?? []).reduce((sum, h) => sum + Number(h.uses || 0), 0);
  }
}
