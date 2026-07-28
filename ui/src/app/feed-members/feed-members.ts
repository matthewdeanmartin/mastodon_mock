import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../api';
import { Auth } from '../auth';
import { AuthorRow, feedAuthors, pct } from '../feed-metrics';
import { FeedSource, isSupplied, sampleFeed } from '../feed-sample';
import { Status } from '../models';

/** Sample sizes the user can pick between on a paged feed. */
export const SAMPLE_CHOICES = [50, 100, 200] as const;
/** Default sample: 100 posts, three requests at Mastodon's 40-post page cap. */
export const DEFAULT_SAMPLE = 100;
/** Authors resolved per relationships call — Mastodon accepts them batched. */
const RELATIONSHIP_BATCH = 80;

/**
 * "Who is in this feed", for feeds that have no membership list of their own.
 *
 * A Mastodon list has real members you can add and remove. A hashtag doesn't,
 * and neither does a merged synthetic feed — so their membership is *emergent*:
 * whoever showed up in a sample of recent posts. That distinction is stated in
 * the UI rather than papered over, because "members" here can change every time
 * you look.
 *
 * Shares the sampling machinery with `FeedAnalytics`, so opening both tabs on
 * one feed costs two independent samples — deliberate, since each tab is
 * lazily mounted and neither should depend on the other having been opened.
 */
@Component({
  selector: 'app-feed-members',
  imports: [RouterLink],
  templateUrl: './feed-members.html',
  styleUrl: './feed-members.css',
})
export class FeedMembers {
  private api = inject(Api);
  private auth = inject(Auth);

  /** The feed whose authors to list. Changing it restarts collection. */
  readonly source = input.required<FeedSource>();

  protected readonly sampleChoices = SAMPLE_CHOICES;
  protected sampleSize = signal<number>(DEFAULT_SAMPLE);

  protected loading = signal(true);
  protected error = signal(false);
  protected posts = signal<Status[]>([]);
  protected apiCalls = signal(0);
  /** Account ids the viewer follows; null until (or unless) resolved. */
  protected followingIds = signal<ReadonlySet<string> | null>(null);

  constructor() {
    effect(() => {
      const source = this.source();
      const size = this.sampleSize();
      untracked(() => this.collect(source, size));
    });
  }

  private collect(source: FeedSource, size: number): void {
    this.loading.set(true);
    this.error.set(false);
    this.posts.set([]);
    this.apiCalls.set(0);
    this.followingIds.set(null);
    sampleFeed(source, size).subscribe((sample) => {
      this.posts.set(sample.posts);
      this.apiCalls.set(sample.apiCalls);
      this.error.set(sample.failed);
      this.loading.set(false);
      this.resolveFollows(sample.posts);
    });
  }

  /** One batched request, signed-in only, so each row can offer Follow. */
  private resolveFollows(posts: Status[]): void {
    if (this.auth.isAnonymous || !posts.length) {
      return;
    }
    const ids = this.authors()
      .slice(0, RELATIONSHIP_BATCH)
      .map((row) => row.account.id);
    this.api.relationships(ids).subscribe({
      next: (rels) => {
        this.apiCalls.update((n) => n + 1);
        this.followingIds.set(new Set(rels.filter((r) => r.following).map((r) => r.id)));
      },
      error: () => this.followingIds.set(null),
    });
  }

  /** Synthetic feeds are handed over whole, so there is no sample size to pick. */
  protected paged = computed(() => !isSupplied(this.source()));

  /** The people in the feed, most prolific first. */
  protected authors = computed<AuthorRow[]>(() => feedAuthors(this.posts()));

  /** True once relationships resolved and this account is followed. */
  isFollowed(row: AuthorRow): boolean {
    return this.followingIds()?.has(row.account.id) ?? false;
  }

  /** Whether follow state is known at all (it never is for anonymous viewers). */
  protected knowsFollows = computed(() => this.followingIds() !== null);

  setSampleSize(size: number): void {
    if (size !== this.sampleSize()) {
      this.sampleSize.set(size);
    }
  }

  /** Re-collect against the same feed, for a fresh look at who's posting. */
  refresh(): void {
    this.collect(this.source(), this.sampleSize());
  }

  pct = pct;
}
