import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { authorsOf, ServerFeedKind } from '../../lists/list-source';
import { serverFeedDef } from '../../lists/server-feeds';

/**
 * A built-in server feed (Fediverse / Local / News) presented as a list: a feed
 * of posts plus a synthetic Members tab derived from the distinct authors of the
 * loaded posts (see sprint/lists-0-overview.md). Federated/local timelines 422
 * anonymously on mastodon.social, so anonymous sessions see a note and only
 * "News" (trends) is offered.
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

  protected feed = signal<ServerFeedKind>('news');
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected loadingMore = signal(false);
  protected exhausted = signal(false);
  protected notice = signal('');
  protected tab = signal<'posts' | 'members'>('posts');

  protected def = computed(() => serverFeedDef(this.feed()));
  protected title = computed(() => this.def()?.title ?? 'Feed');
  /** Synthetic members: the distinct authors of the loaded posts. */
  protected members = computed<Account[]>(() => authorsOf(this.statuses()));

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const raw = params.get('feed');
      const feed: ServerFeedKind =
        raw === 'federated' || raw === 'local' || raw === 'news' ? raw : 'news';
      this.feed.set(feed);
      this.tab.set('posts');
      this.load();
    });
  }

  private request(maxId?: string): Observable<Status[]> {
    switch (this.feed()) {
      case 'federated':
        return this.api.publicTimeline(false, maxId);
      case 'local':
        return this.api.publicTimeline(true, maxId);
      case 'news':
        return this.api.trendingStatuses();
    }
  }

  load(): void {
    this.statuses.set([]);
    this.notice.set('');
    // News (trends) is a single non-paged snapshot; the timelines page.
    this.exhausted.set(this.feed() === 'news');
    if (this.def()?.authRequired && this.auth.isAnonymous) {
      this.loading.set(false);
      this.notice.set('Sign in to view this timeline. Anonymous sessions can only browse News.');
      return;
    }
    this.loading.set(true);
    this.request().subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.loading.set(false);
        this.exhausted.set(this.feed() === 'news' || !s.length);
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
      },
      error: () => {
        this.loadingMore.set(false);
        this.exhausted.set(true);
      },
    });
  }

  setTab(tab: 'posts' | 'members'): void {
    this.tab.set(tab);
  }

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
