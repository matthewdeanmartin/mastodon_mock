import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { FeaturedTag, Tag } from '../../models';

@Component({
  selector: 'app-followed-tags',
  imports: [RouterLink],
  templateUrl: './followed-tags.html',
  styleUrl: './followed-tags.css',
})
export class FollowedTags implements OnInit {
  private api = inject(Api);

  protected followed = signal<Tag[]>([]);
  protected featured = signal<FeaturedTag[]>([]);
  protected loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.followedTags().subscribe({
      next: (tags) => {
        this.followed.set(tags);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.featuredTags().subscribe((tags) => this.featured.set(tags));
  }

  unfollow(tag: Tag): void {
    this.api.unfollowTag(tag.name).subscribe(() => {
      this.followed.update((list) => list.filter((t) => t.name !== tag.name));
    });
  }
}
