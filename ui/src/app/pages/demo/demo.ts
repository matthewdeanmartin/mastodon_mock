import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DemoFeed, DEMO_SERVER } from '../../demo/demo-feed';
import { HumanTimePipe } from '../../human-time.pipe';
import { Status, Tag } from '../../models';

type DemoTab = 'trending' | 'live';

/**
 * One-click, logged-out demo: a read-only feed of live public posts pulled
 * straight from the demo instance (mastodon.social) via {@link DemoFeed}.
 * No account, no mock server, no seeding — reachable from the login page
 * without signing anything. The "live" tab follows a trending hashtag
 * because mastodon.social's full public firehose requires a signed-in user,
 * while tag timelines stay anonymous.
 */
@Component({
  selector: 'app-demo',
  imports: [RouterLink, HumanTimePipe],
  templateUrl: './demo.html',
  styleUrl: './demo.css',
})
export class Demo implements OnInit {
  private feed = inject(DemoFeed);

  protected readonly demoHost = DEMO_SERVER.replace(/^https?:\/\//, '');

  protected tab = signal<DemoTab>('trending');
  protected trending = signal<Status[]>([]);
  protected live = signal<Status[]>([]);
  protected tags = signal<Tag[]>([]);
  protected activeTag = signal<string | null>(null);
  protected loading = signal(true);
  protected loadingMore = signal(false);
  protected error = signal(false);
  /** Sensitive media the viewer chose to reveal, by status id. */
  protected revealed = signal<Set<string>>(new Set());

  ngOnInit(): void {
    this.feed.trendingStatuses().subscribe({
      next: (posts) => {
        this.trending.set(posts);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  selectTab(tab: DemoTab): void {
    this.tab.set(tab);
    if (tab === 'live' && !this.tags().length) {
      this.loading.set(true);
      this.feed.trendingTags().subscribe({
        next: (tags) => {
          this.tags.set(tags);
          const first = tags[0]?.name;
          if (first) {
            this.selectTag(first);
          } else {
            this.loading.set(false);
          }
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
    }
  }

  selectTag(name: string): void {
    if (this.activeTag() === name) {
      return;
    }
    this.activeTag.set(name);
    this.live.set([]);
    this.loading.set(true);
    this.feed.tagTimeline(name).subscribe({
      next: (posts) => {
        // Ignore a slow response for a tag the user has already moved past.
        if (this.activeTag() === name) {
          this.live.set(posts);
          this.loading.set(false);
        }
      },
      error: () => {
        if (this.activeTag() === name) {
          this.error.set(true);
          this.loading.set(false);
        }
      },
    });
  }

  posts(): Status[] {
    return this.tab() === 'trending' ? this.trending() : this.live();
  }

  loadMore(): void {
    this.loadingMore.set(true);
    if (this.tab() === 'trending') {
      this.feed.trendingStatuses(this.trending().length).subscribe({
        next: (posts) => {
          this.trending.update((list) => [...list, ...posts]);
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false),
      });
    } else {
      const tag = this.activeTag();
      const oldest = this.live().at(-1)?.id;
      if (!tag) {
        this.loadingMore.set(false);
        return;
      }
      this.feed.tagTimeline(tag, oldest).subscribe({
        next: (posts) => {
          this.live.update((list) => [...list, ...posts]);
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false),
      });
    }
  }

  reveal(status: Status): void {
    this.revealed.update((set) => new Set(set).add(status.id));
  }

  isRevealed(status: Status): boolean {
    return this.revealed().has(status.id);
  }

  /** Hide media behind a click when the author flagged the post sensitive. */
  mediaHidden(status: Status): boolean {
    return !!status.sensitive && !this.isRevealed(status);
  }
}
