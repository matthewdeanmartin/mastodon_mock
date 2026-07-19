import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { BookmarkGroup, groupByAuthor, groupByHashtag, withMedia } from './bookmark-groups';

type LibraryView = 'all' | 'authors' | 'hashtags' | 'media';

/**
 * The bookmark library: the flat bookmark list plus machine-computed shelves
 * (by author, by hashtag, with media). Grouping is done entirely client-side
 * from the fetched list — nothing extra is stored anywhere.
 */
@Component({
  selector: 'app-bookmarks',
  imports: [StatusCard],
  templateUrl: './bookmarks.html',
})
export class Bookmarks implements OnInit {
  private api = inject(Api);
  protected auth = inject(Auth);

  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected loadingMore = signal(false);
  /** An empty older page came back: the whole library is loaded. */
  protected exhausted = signal(false);
  protected view = signal<LibraryView>('all');

  protected readonly views: { id: LibraryView; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'authors', label: 'By author' },
    { id: 'hashtags', label: 'By hashtag' },
    { id: 'media', label: 'With media' },
  ];

  protected groups = computed<BookmarkGroup[]>(() => {
    switch (this.view()) {
      case 'authors':
        return groupByAuthor(this.statuses());
      case 'hashtags':
        return groupByHashtag(this.statuses());
      case 'media':
        return [{ label: 'With media', statuses: withMedia(this.statuses()) }];
      default:
        return [{ label: '', statuses: this.statuses() }];
    }
  });

  ngOnInit(): void {
    if (this.auth.isAnonymous) {
      this.loading.set(false);
      return;
    }
    this.api.bookmarks().subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadMore(): void {
    const last = this.statuses().at(-1);
    if (!last || this.loadingMore() || this.exhausted()) {
      return;
    }
    this.loadingMore.set(true);
    this.api.bookmarks(last.id).subscribe({
      next: (batch) => {
        this.loadingMore.set(false);
        if (!batch.length) {
          this.exhausted.set(true);
          return;
        }
        const seen = new Set(this.statuses().map((s) => s.id));
        const fresh = batch.filter((s) => !seen.has(s.id));
        if (!fresh.length) {
          this.exhausted.set(true);
          return;
        }
        this.statuses.update((list) => [...list, ...fresh]);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  onChanged(updated: Status): void {
    this.statuses.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
