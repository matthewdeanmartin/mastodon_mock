import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, Status, TrendLink } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { authorsOf, ServerFeedKind } from '../../lists/list-source';
import { serverFeedDef } from '../../lists/server-feeds';

/**
 * A built-in server feed presented as a list. Two content shapes:
 *  - posts (Fediverse / Local / Trending): a feed of statuses plus a Members
 *    tab of the distinct authors of the loaded posts, computed lazily on first
 *    open (see sprint/lists-0-overview.md).
 *  - links (News): trending preview cards; no members (there are no authors).
 *
 * Federated/local timelines 422 anonymously on mastodon.social and are disabled
 * outright on some instances; the Lists page probes them and only links here
 * when they return data, so this page rarely hits an empty timeline.
 */
@Component({
  selector: 'app-server-feed',
  imports: [RouterLink, StatusCard],
  templateUrl: './server-feed.html',
  styleUrl: './server-feed.css',
})
export class ServerFeed implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  protected auth = inject(Auth);

  protected feed = signal<ServerFeedKind>('trending');
  protected statuses = signal<Status[]>([]);
  protected links = signal<TrendLink[]>([]);
  protected loading = signal(true);
  protected loadingMore = signal(false);
  protected exhausted = signal(false);
  protected notice = signal('');
  protected tab = signal<'posts' | 'members'>('posts');

  protected def = computed(() => serverFeedDef(this.feed()));
  protected title = computed(() => this.def()?.title ?? 'Feed');
  protected isLinks = computed(() => this.def()?.content === 'links');

  // Synthetic members are computed lazily: only once the Members tab is opened,
  // and memoized against the statuses snapshot it was computed from.
  private membersComputedFor: Status[] | null = null;
  protected members = signal<Account[]>([]);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const raw = params.get('feed');
      const feed: ServerFeedKind =
        raw === 'federated' || raw === 'local' || raw === 'trending' || raw === 'news'
          ? raw
          : 'trending';
      this.feed.set(feed);
      this.tab.set('posts');
      this.membersComputedFor = null;
      this.members.set([]);
      this.load();
    });
  }

  private request(maxId?: string): Observable<Status[]> {
    switch (this.feed()) {
      case 'federated':
        return this.api.publicTimeline(false, maxId);
      case 'local':
        return this.api.publicTimeline(true, maxId);
      case 'trending':
      case 'news': // unused for news (handled in load), but keeps the switch total
        return this.api.trendingStatuses();
    }
  }

  load(): void {
    this.statuses.set([]);
    this.links.set([]);
    this.notice.set('');

    if (this.isLinks()) {
      this.exhausted.set(true);
      this.loading.set(true);
      this.api.trendingLinks().subscribe({
        next: (l) => {
          this.links.set(l);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notice.set('Could not load news links.');
        },
      });
      return;
    }

    // Trending is a single non-paged snapshot; the timelines page.
    this.exhausted.set(this.feed() === 'trending');
    if (this.def()?.authRequired && this.auth.isAnonymous) {
      this.loading.set(false);
      this.notice.set('Sign in to view this timeline. Anonymous sessions can only browse Trending and News.');
      return;
    }
    this.loading.set(true);
    this.request().subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.loading.set(false);
        this.exhausted.set(this.feed() === 'trending' || !s.length);
      },
      error: () => {
        this.loading.set(false);
        this.notice.set('Could not load this feed.');
      },
    });
  }

  loadMore(): void {
    if (this.loadingMore() || this.exhausted() || !this.statuses().length) {
      return;
    }
    const maxId = this.statuses()[this.statuses().length - 1]?.id;
    this.loadingMore.set(true);
    this.request(maxId).subscribe({
      next: (s) => {
        this.statuses.update((cur) => [...cur, ...s]);
        this.loadingMore.set(false);
        this.exhausted.set(!s.length);
        // A larger post set may add authors; recompute if members are on screen.
        if (this.tab() === 'members') {
          this.computeMembers();
        }
      },
      error: () => {
        this.loadingMore.set(false);
        this.exhausted.set(true);
      },
    });
  }

  setTab(tab: 'posts' | 'members'): void {
    this.tab.set(tab);
    if (tab === 'members') {
      this.computeMembers();
    }
  }

  /** Lazily derive synthetic members from the loaded posts, memoized against
   *  the exact statuses snapshot so repeated tab switches don't rework it. */
  private computeMembers(): void {
    const snapshot = this.statuses();
    if (this.membersComputedFor === snapshot) {
      return;
    }
    this.membersComputedFor = snapshot;
    this.members.set(authorsOf(snapshot));
  }

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
