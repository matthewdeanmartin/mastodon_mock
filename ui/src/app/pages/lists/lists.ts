import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Collection, FeaturedTag, Tag, UserList } from '../../models';
import { ConfirmDialog } from '../../confirm-dialog/confirm-dialog';
import { AnonymousLists } from '../../providers/anonymous/anonymous-lists';
import { AnonymousTags } from '../../providers/anonymous/anonymous-tags';
import { SavedSearches } from '../search/saved-searches';
import { SERVER_FEEDS, ServerFeedDef } from '../../lists/server-feeds';
import { PageDiagnostics } from '../../page-diagnostics';

/**
 * Which sections the Feeds page shows. `/feeds` shows everything; `/feeds/lists`
 * and `/feeds/tags` are filtered views used by the More menu's Lists / Tags
 * entries. Read from the route's `only` data.
 */
type FeedFilter = 'all' | 'lists' | 'tags';

@Component({
  selector: 'app-lists',
  imports: [RouterLink, FormsModule, ConfirmDialog],
  templateUrl: './lists.html',
  styleUrl: './lists.css',
})
export class Lists implements OnInit {
  private api = inject(Api);
  protected auth = inject(Auth);
  private anonymousLists = inject(AnonymousLists);
  private anonymousTags = inject(AnonymousTags);
  protected saved = inject(SavedSearches);
  private diagnostics = inject(PageDiagnostics);
  private route = inject(ActivatedRoute);

  /** Section filter from the route (`/feeds/lists`, `/feeds/tags`, else all). */
  protected filter: FeedFilter = (this.route.snapshot.data['only'] as FeedFilter) ?? 'all';
  /** A given section is shown when we're on the "all" view or it owns the filter. */
  protected shows(section: FeedFilter): boolean {
    return this.filter === 'all' || this.filter === section;
  }

  // Followed / featured hashtags, surfaced here as feed rows (the old /tags page).
  protected followedTags = signal<Tag[]>([]);
  protected featuredTags = signal<FeaturedTag[]>([]);

  /**
   * Server feeds to show. Auth-gated feeds drop for anonymous sessions; probed
   * feeds (Fediverse/Local) are hidden until confirmed non-empty, because
   * mastodon.social has disabled them while other instances keep them — we
   * don't want people clicking into a dead feed to find out.
   */
  protected serverFeeds = signal<ServerFeedDef[]>([]);

  protected lists = signal<UserList[]>([]);
  protected loading = signal(true);
  protected newTitle = signal('');

  // Collections (Mastodon 4.6+). Older servers 404 → collectionsSupported=false.
  protected collections = signal<Collection[]>([]);
  protected inCollections = signal<Collection[]>([]);
  protected collectionsLoading = signal(true);
  protected collectionsSupported = signal(true);
  protected newCollectionName = signal('');

  // Your own endorsed accounts, surfaced as a synthetic list (see endorsed-list page).
  protected myEndorsedCount = signal<number | null>(null);

  // Pending deletions awaiting confirmation.
  protected listToDelete = signal<UserList | null>(null);
  protected collectionToDelete = signal<Collection | null>(null);
  protected showStarterCollection = computed(
    () =>
      !this.collectionsLoading() &&
      !this.collections().length &&
      (this.auth.isAnonymous || (this.auth.account()?.following_count ?? 0) === 0),
  );

  ngOnInit(): void {
    this.diagnostics.info('Lists', 'page:open', {
      mode: this.auth.mode() ?? 'unauthenticated',
      filter: this.filter,
    });
    if (this.shows('lists')) {
      this.load();
      this.loadCollections();
      this.resolveServerFeeds();
    }
    if (this.shows('tags')) {
      this.loadTags();
    }
  }

  /** Followed + featured hashtags (mirrors the retired standalone /tags page). */
  private loadTags(): void {
    if (this.auth.isAnonymous) {
      this.followedTags.set(
        this.anonymousTags.tags().map((name) => ({
          id: name,
          name,
          url: '',
          history: [],
          following: true,
          featuring: false,
        })),
      );
      this.featuredTags.set([]);
      return;
    }
    this.api.followedTags().subscribe({
      next: (tags) => this.followedTags.set(tags),
      error: () => this.followedTags.set([]),
    });
    this.api.featuredTags().subscribe({
      next: (tags) => this.featuredTags.set(tags),
      error: () => this.featuredTags.set([]),
    });
  }

  /** The ✕ sits inside a routerLink; unfollow without navigating to the tag. */
  askUnfollowTag(tag: Tag, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.unfollowTag(tag);
  }

  private unfollowTag(tag: Tag): void {
    if (this.auth.isAnonymous) {
      this.anonymousTags.unfollow(tag.name);
      this.followedTags.update((list) => list.filter((t) => t.name !== tag.name));
      return;
    }
    this.api.unfollowTag(tag.name).subscribe(() => {
      this.followedTags.update((list) => list.filter((t) => t.name !== tag.name));
    });
  }

  /**
   * Decide which server-feed rows to show. Non-probed, session-eligible feeds
   * appear immediately; probed feeds (Fediverse/Local) are appended only after
   * a HEAD-of-timeline fetch confirms the instance actually serves them.
   */
  private resolveServerFeeds(): void {
    const eligible = SERVER_FEEDS.filter((f) => !f.authRequired || !this.auth.isAnonymous);
    this.serverFeeds.set(eligible.filter((f) => !f.probe));

    for (const def of eligible.filter((f) => f.probe)) {
      const probe =
        def.feed === 'local' ? this.api.publicTimeline(true) : this.api.publicTimeline(false);
      probe.subscribe({
        next: (statuses) => {
          if (statuses.length) {
            this.addServerFeed(def);
          }
        },
        error: () => {
          // Endpoint disabled/unauthorized on this instance — leave it hidden.
        },
      });
    }
  }

  /** Insert a probed feed in its catalogue order (keeps rows stable). */
  private addServerFeed(def: ServerFeedDef): void {
    this.serverFeeds.update((current) => {
      if (current.some((f) => f.feed === def.feed)) {
        return current;
      }
      const order = SERVER_FEEDS.map((f) => f.feed);
      return [...current, def].sort((a, b) => order.indexOf(a.feed) - order.indexOf(b.feed));
    });
  }

  /** Count the signed-in user's own endorsements so the "Endorsed accounts"
   *  section shows a row only when there's something to see. Called with a
   *  verified account from {@link loadCollections} (which already resolves the
   *  auth snapshot), so it never issues its own verify_credentials. */
  private loadEndorsed(accountId: string): void {
    this.api.accountEndorsements(accountId).subscribe({
      next: (accounts) => this.myEndorsedCount.set(accounts.length),
      error: () => this.myEndorsedCount.set(null),
    });
  }

  load(): void {
    this.diagnostics.info('Lists', 'load:lists-start', { anonymous: this.auth.isAnonymous });
    this.loading.set(true);
    if (this.auth.isAnonymous) {
      this.lists.set(this.anonymousLists.lists());
      this.loading.set(false);
      this.diagnostics.info('Lists', 'load:lists-success', {
        anonymous: true,
        count: this.lists().length,
      });
      return;
    }
    this.api.lists().subscribe({
      next: (l) => {
        this.lists.set(l);
        this.loading.set(false);
        this.diagnostics.info('Lists', 'load:lists-success', { anonymous: false, count: l.length });
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.diagnostics.error('Lists', 'load:lists-error', error);
      },
    });
  }

  loadCollections(): void {
    if (this.auth.isAnonymous) {
      this.collectionsLoading.set(false);
      return;
    }
    const me = this.auth.account();
    if (!me) {
      // Auth snapshot not verified yet; fetch it, then retry.
      this.api.verifyCredentials().subscribe({
        next: (account) => {
          this.auth.setAccount(account);
          this.loadCollections();
        },
        error: () => this.collectionsLoading.set(false),
      });
      return;
    }
    // The account is now resolved; fetch the user's own endorsements alongside.
    this.loadEndorsed(me.id);
    this.collectionsLoading.set(true);
    this.api.accountCollections(me.id).subscribe({
      next: (c) => {
        this.collections.set(c);
        this.collectionsLoading.set(false);
      },
      error: () => {
        this.collectionsSupported.set(false);
        this.collectionsLoading.set(false);
      },
    });
    this.api.accountInCollections(me.id).subscribe({
      next: (c) => this.inCollections.set(c),
      error: () => this.inCollections.set([]),
    });
  }

  create(): void {
    const title = this.newTitle().trim();
    if (!title) {
      return;
    }
    this.diagnostics.info('Lists', 'user:create-list', {
      anonymous: this.auth.isAnonymous,
      titleLength: title.length,
    });
    if (this.auth.isAnonymous) {
      this.lists.update((lists) => [...lists, this.anonymousLists.create(title)]);
      this.newTitle.set('');
      return;
    }
    this.api.createList(title).subscribe((list) => {
      this.lists.update((l) => [...l, list]);
      this.newTitle.set('');
    });
  }

  /** The ✕ sits inside a routerLink; open the confirm without navigating. */
  askDeleteList(list: UserList, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.diagnostics.info('Lists', 'user:request-delete-list', { id: list.id });
    this.listToDelete.set(list);
  }

  remove(list: UserList): void {
    this.diagnostics.info('Lists', 'user:confirm-delete-list', {
      id: list.id,
      anonymous: this.auth.isAnonymous,
    });
    this.listToDelete.set(null);
    if (this.auth.isAnonymous) {
      this.anonymousLists.remove(list.id);
      this.lists.update((lists) => lists.filter((item) => item.id !== list.id));
      return;
    }
    this.api.deleteList(list.id).subscribe(() => {
      this.lists.update((l) => l.filter((x) => x.id !== list.id));
    });
  }

  createCollection(): void {
    const name = this.newCollectionName().trim();
    if (!name) {
      return;
    }
    this.diagnostics.info('Lists', 'user:create-collection', { nameLength: name.length });
    this.api.createCollection(name).subscribe((wrapped) => {
      this.newCollectionName.set('');
      // The mock's stub returns {collection: null}; only append real payloads.
      if (wrapped?.collection) {
        this.collections.update((c) => [...c, wrapped.collection]);
      } else {
        this.loadCollections();
      }
    });
  }

  askDeleteCollection(collection: Collection, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.diagnostics.info('Lists', 'user:request-delete-collection', { id: collection.id });
    this.collectionToDelete.set(collection);
  }

  removeCollection(collection: Collection): void {
    this.diagnostics.info('Lists', 'user:confirm-delete-collection', { id: collection.id });
    this.collectionToDelete.set(null);
    this.api.deleteCollection(collection.id).subscribe(() => {
      this.collections.update((c) => c.filter((x) => x.id !== collection.id));
    });
  }
}
