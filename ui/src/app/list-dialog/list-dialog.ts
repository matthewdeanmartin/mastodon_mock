import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { concatMap, forkJoin, from, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Api } from '../api';
import { Auth } from '../auth';
import { Collection, UserList } from '../models';

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

/** One line of the bulk add-by-name result. */
interface BulkResult {
  handle: string;
  status: 'added' | 'exists' | 'notfound' | 'error';
}

/**
 * Add an account to the viewer's **lists** (private) and **collections**
 * (public) from a profile. Also supports bulk "add by name" into a single
 * named target: paste one handle, a CSV, or one-per-line and they're resolved
 * and added in rapid succession.
 */
@Component({
  selector: 'app-list-dialog',
  imports: [FormsModule],
  templateUrl: './list-dialog.html',
  styleUrl: './list-dialog.css',
})
export class ListDialog implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);

  readonly username = input.required<string>();
  readonly accountId = input.required<string>();
  readonly closed = output<void>();

  protected rows = signal<ListRow[]>([]);
  protected loading = signal(true);
  protected newTitle = signal('');

  // Collections (public). Older servers 404 → collectionsSupported=false.
  protected collectionRows = signal<CollectionRow[]>([]);
  protected collectionsSupported = signal(true);
  protected newCollectionName = signal('');

  // Bulk add-by-name.
  protected bulkTarget = signal('');
  protected bulkKind = signal<'list' | 'collection'>('list');
  protected bulkHandles = signal('');
  protected bulkBusy = signal(false);
  protected bulkResults = signal<BulkResult[]>([]);

  ngOnInit(): void {
    this.load();
    this.loadCollections();
  }

  private load(): void {
    this.loading.set(true);
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

  // ------------------------------------------------------------ bulk add-by-name

  /** Split a paste into handles: comma, newline, or whitespace separated. */
  protected parseHandles(raw: string): string[] {
    return raw
      .split(/[\s,]+/)
      .map((h) => h.replace(/^@/, ''))
      .filter((h) => h.length > 0);
  }

  protected bulkCount(): number {
    return this.parseHandles(this.bulkHandles()).length;
  }

  /**
   * Resolve each pasted handle and add it to the named list/collection,
   * creating the target if it doesn't exist. Adds run in rapid succession.
   */
  bulkAdd(): void {
    const targetName = this.bulkTarget().trim();
    const handles = this.parseHandles(this.bulkHandles());
    if (!targetName || !handles.length || this.bulkBusy()) {
      return;
    }
    this.bulkBusy.set(true);
    this.bulkResults.set([]);

    const kind = this.bulkKind();
    const id$ = kind === 'list' ? this.ensureList(targetName) : this.ensureCollection(targetName);

    id$
      .pipe(
        switchMap((id) => {
          if (!id) {
            return of<BulkResult>({ handle: '(target unavailable)', status: 'error' });
          }
          const add = (accountId: string) =>
            kind === 'list'
              ? this.api.addToList(id, accountId)
              : this.api.addCollectionAccount(id, accountId);
          return from(handles).pipe(concatMap((handle) => this.addOne(handle, add)));
        }),
      )
      .subscribe({
        next: (result) => this.bulkResults.update((r) => [...r, result]),
        complete: () => {
          this.bulkBusy.set(false);
          // Refresh the checkbox sections so newly-added rows reflect reality.
          this.load();
          this.loadCollections();
        },
        error: () => this.bulkBusy.set(false),
      });
  }

  /** Resolve one handle to an account and add it; never errors the outer stream. */
  private addOne(
    handle: string,
    add: (accountId: string) => Observable<unknown>,
  ): Observable<BulkResult> {
    return this.api.search(handle, 'accounts', { resolve: true, limit: 1 }).pipe(
      switchMap((res) => {
        const account = res.accounts[0];
        if (!account) {
          return of<BulkResult>({ handle, status: 'notfound' });
        }
        return add(account.id).pipe(
          map(() => ({ handle, status: 'added' }) as BulkResult),
          catchError(() => of<BulkResult>({ handle, status: 'error' })),
        );
      }),
      catchError(() => of<BulkResult>({ handle, status: 'error' })),
    );
  }

  /** Find an existing list by (case-insensitive) title, else create one. */
  private ensureList(name: string): Observable<string> {
    return this.api.lists().pipe(
      switchMap((lists) => {
        const existing = lists.find((l) => l.title.toLowerCase() === name.toLowerCase());
        return existing ? of(existing.id) : this.api.createList(name).pipe(map((l) => l.id));
      }),
    );
  }

  /** Find an existing collection of the viewer's by name, else create one. */
  private ensureCollection(name: string): Observable<string> {
    const me = this.auth.account();
    const mine$ = me
      ? this.api.accountCollections(me.id).pipe(catchError(() => of([] as Collection[])))
      : of([] as Collection[]);
    return mine$.pipe(
      switchMap((cols) => {
        const existing = cols.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          return of(existing.id);
        }
        // createCollection may return {collection:null} on stub servers.
        return this.api
          .createCollection(name)
          .pipe(map((wrapped) => wrapped?.collection?.id ?? ''));
      }),
    );
  }
}
