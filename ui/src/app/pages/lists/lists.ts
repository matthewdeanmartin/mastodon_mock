import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Collection, UserList } from '../../models';
import { ConfirmDialog } from '../../confirm-dialog/confirm-dialog';

@Component({
  selector: 'app-lists',
  imports: [RouterLink, FormsModule, ConfirmDialog],
  templateUrl: './lists.html',
  styleUrl: './lists.css',
})
export class Lists implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);

  protected lists = signal<UserList[]>([]);
  protected loading = signal(true);
  protected newTitle = signal('');

  // Collections (Mastodon 4.6+). Older servers 404 → collectionsSupported=false.
  protected collections = signal<Collection[]>([]);
  protected inCollections = signal<Collection[]>([]);
  protected collectionsLoading = signal(true);
  protected collectionsSupported = signal(true);
  protected newCollectionName = signal('');

  // Pending deletions awaiting confirmation.
  protected listToDelete = signal<UserList | null>(null);
  protected collectionToDelete = signal<Collection | null>(null);

  ngOnInit(): void {
    this.load();
    this.loadCollections();
  }

  load(): void {
    this.loading.set(true);
    this.api.lists().subscribe({
      next: (l) => {
        this.lists.set(l);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadCollections(): void {
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
    this.api.createList(title).subscribe((list) => {
      this.lists.update((l) => [...l, list]);
      this.newTitle.set('');
    });
  }

  /** The ✕ sits inside a routerLink; open the confirm without navigating. */
  askDeleteList(list: UserList, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.listToDelete.set(list);
  }

  remove(list: UserList): void {
    this.listToDelete.set(null);
    this.api.deleteList(list.id).subscribe(() => {
      this.lists.update((l) => l.filter((x) => x.id !== list.id));
    });
  }

  createCollection(): void {
    const name = this.newCollectionName().trim();
    if (!name) {
      return;
    }
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
    this.collectionToDelete.set(collection);
  }

  removeCollection(collection: Collection): void {
    this.collectionToDelete.set(null);
    this.api.deleteCollection(collection.id).subscribe(() => {
      this.collections.update((c) => c.filter((x) => x.id !== collection.id));
    });
  }
}
