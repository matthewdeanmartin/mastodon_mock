import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Api } from '../api';
import { Auth } from '../auth';
import { Collection, UserList } from '../models';
import { AnonymousFollows } from '../providers/anonymous/anonymous-follows';
import { AnonymousLists } from '../providers/anonymous/anonymous-lists';
import { AnonymousAccount } from '../providers/anonymous/anonymous-account';
import { Account } from '../models';

interface ListRow {
  list: UserList;
  member: boolean;
}

interface CollectionRow {
  collection: Collection;
  /** Item id when this account is a member (needed to remove); '' otherwise. */
  itemId: string;
  member: boolean;
  busy: boolean;
}

/**
 * Add a single account (from their profile) to the viewer's **lists**
 * (private) and **collections** (public), via membership checkboxes.
 * Bulk "add several people by name" lives on the list/collection pages
 * instead — this dialog is strictly about one person.
 */
@Component({
  selector: 'app-list-dialog',
  imports: [FormsModule],
  templateUrl: './list-dialog.html',
  styleUrl: './list-dialog.css',
})
export class ListDialog implements OnInit {
  private api = inject(Api);
  protected auth = inject(Auth);
  private anonymous = inject(AnonymousAccount);
  private anonymousFollows = inject(AnonymousFollows);
  private anonymousLists = inject(AnonymousLists);

  readonly username = input.required<string>();
  readonly accountId = input.required<string>();
  readonly account = input<Account | null>(null);
  readonly closed = output<void>();

  protected rows = signal<ListRow[]>([]);
  protected loading = signal(true);
  protected newTitle = signal('');

  // Collections (public). Older servers 404 → collectionsSupported=false.
  protected collectionRows = signal<CollectionRow[]>([]);
  protected collectionsSupported = signal(true);
  protected newCollectionName = signal('');

  ngOnInit(): void {
    this.load();
    this.loadCollections();
  }

  private load(): void {
    this.loading.set(true);
    if (this.auth.isAnonymous) {
      const follow = this.anonymousFollow();
      this.rows.set(
        this.anonymousLists.lists().map((list) => ({
          list,
          member: !!follow && this.anonymousLists.hasMember(list.id, follow.key),
        })),
      );
      this.loading.set(false);
      return;
    }
    this.api.lists().subscribe((lists) => {
      if (!lists.length) {
        this.rows.set([]);
        this.loading.set(false);
        return;
      }
      // For each list, check whether this account is already a member.
      forkJoin(
        lists.map((list) =>
          this.api.listAccounts(list.id).pipe(
            map((accounts) => ({
              list,
              member: accounts.some((a) => a.id === this.accountId()),
            })),
          ),
        ),
      ).subscribe((rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      });
    });
  }

  private loadCollections(): void {
    if (this.auth.isAnonymous) {
      this.collectionsSupported.set(false);
      return;
    }
    const me = this.auth.account();
    if (!me) {
      this.collectionsSupported.set(false);
      return;
    }
    // My collections give the full set; the target's in_collections tells us
    // which ones already feature them (checked). Two requests, not N.
    forkJoin({
      mine: this.api.accountCollections(me.id).pipe(catchError(() => of(null))),
      featuring: this.api.accountInCollections(this.accountId()).pipe(catchError(() => of([]))),
    }).subscribe(({ mine, featuring }) => {
      if (mine === null) {
        this.collectionsSupported.set(false);
        return;
      }
      const featuredIds = new Set(featuring.map((c) => c.id));
      this.collectionRows.set(
        mine.map((collection) => ({
          collection,
          itemId: '',
          member: featuredIds.has(collection.id),
          busy: false,
        })),
      );
    });
  }

  toggle(row: ListRow): void {
    if (this.auth.isAnonymous) {
      const follow = row.member ? this.anonymousFollow() : this.ensureAnonymousFollow();
      if (!follow) return;
      this.anonymousLists.setMember(row.list.id, follow.key, !row.member);
      this.rows.update((rows) =>
        rows.map((item) =>
          item.list.id === row.list.id ? { ...item, member: !item.member } : item,
        ),
      );
      return;
    }
    const call = row.member
      ? this.api.removeFromList(row.list.id, this.accountId())
      : this.api.addToList(row.list.id, this.accountId());
    call.subscribe(() => {
      this.rows.update((rows) =>
        rows.map((r) => (r.list.id === row.list.id ? { ...r, member: !r.member } : r)),
      );
    });
  }

  createAndAdd(): void {
    const title = this.newTitle().trim();
    if (!title) {
      return;
    }
    if (this.auth.isAnonymous) {
      const follow = this.ensureAnonymousFollow();
      if (!follow) return;
      const list = this.anonymousLists.create(title);
      this.anonymousLists.setMember(list.id, follow.key, true);
      this.newTitle.set('');
      this.rows.update((rows) => [...rows, { list, member: true }]);
      return;
    }
    this.api.createList(title).subscribe((list) => {
      this.newTitle.set('');
      this.api.addToList(list.id, this.accountId()).subscribe(() => {
        this.rows.update((rows) => [...rows, { list, member: true }]);
      });
    });
  }

  toggleCollection(row: CollectionRow): void {
    if (row.busy) {
      return;
    }
    this.setCollectionBusy(row.collection.id, true);
    if (row.member) {
      // Need the item id to remove. Fetch it if we don't have it yet.
      if (row.itemId) {
        this.removeFromCollection(row.collection.id, row.itemId);
      } else {
        this.api.getCollection(row.collection.id).subscribe({
          next: (full) => {
            const item = full.collection.items.find((i) => i.account_id === this.accountId());
            if (item) {
              this.removeFromCollection(row.collection.id, item.id);
            } else {
              // Already gone; just reflect not-a-member.
              this.markCollection(row.collection.id, { member: false, itemId: '', busy: false });
            }
          },
          error: () => this.setCollectionBusy(row.collection.id, false),
        });
      }
    } else {
      this.api.addCollectionAccount(row.collection.id, this.accountId()).subscribe({
        next: (res) => {
          const itemId = res?.collection_item?.id ?? '';
          this.markCollection(row.collection.id, { member: true, itemId, busy: false });
        },
        error: () => this.setCollectionBusy(row.collection.id, false),
      });
    }
  }

  private removeFromCollection(collectionId: string, itemId: string): void {
    this.api.removeCollectionItem(collectionId, itemId).subscribe({
      next: () => this.markCollection(collectionId, { member: false, itemId: '', busy: false }),
      error: () => this.setCollectionBusy(collectionId, false),
    });
  }

  createCollectionAndAdd(): void {
    const name = this.newCollectionName().trim();
    if (!name) {
      return;
    }
    this.api.createCollection(name).subscribe((wrapped) => {
      this.newCollectionName.set('');
      const collection = wrapped?.collection;
      if (!collection) {
        // Stub server returned {collection:null}; nothing to add to.
        return;
      }
      this.api.addCollectionAccount(collection.id, this.accountId()).subscribe((res) => {
        this.collectionRows.update((rows) => [
          ...rows,
          {
            collection,
            itemId: res?.collection_item?.id ?? '',
            member: true,
            busy: false,
          },
        ]);
      });
    });
  }

  private markCollection(id: string, patch: Partial<CollectionRow>): void {
    this.collectionRows.update((rows) =>
      rows.map((r) => (r.collection.id === id ? { ...r, ...patch } : r)),
    );
  }

  private setCollectionBusy(id: string, busy: boolean): void {
    this.markCollection(id, { busy });
  }

  private anonymousFollow() {
    const account = this.account();
    return account
      ? this.anonymousFollows.find(account, this.anonymous.server())
      : this.anonymousFollows.findByAccountId(this.accountId());
  }

  private ensureAnonymousFollow() {
    const existing = this.anonymousFollow();
    if (existing) return existing;
    const account = this.account();
    if (!account) return null;
    const result = this.anonymousFollows.follow(account, this.anonymous.server());
    return result.ok ? this.anonymousFollows.find(account, this.anonymous.server()) : null;
  }
}
