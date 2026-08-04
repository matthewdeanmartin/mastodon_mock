import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Api } from '../api';
import { Auth } from '../auth';
import { PageDiagnostics, statusOf } from '../page-diagnostics';
import { Collection, UserList } from '../models';
import { AnonymousFollows } from '../providers/anonymous/anonymous-follows';
import { AnonymousLists } from '../providers/anonymous/anonymous-lists';
import { AnonymousAccount } from '../providers/anonymous/anonymous-account';
import { Account } from '../models';

interface ListRow {
  list: UserList;
  member: boolean;
}

/**
 * A pending "you must follow them first" prompt.
 *
 * Mastodon refuses list membership for accounts you don't follow, so the add
 * can't simply be retried — it needs a follow, which is a *visible social act*
 * (the target gets a notification). We never do that silently: the failed add
 * parks here and the user confirms.
 *
 * `retry` re-runs whatever the original action was (toggle an existing list, or
 * create-then-add), so the confirm button finishes the job the user started.
 */
interface FollowGate {
  listTitle: string;
  retry: () => void;
}

/**
 * Does this failure mean "you don't follow that account"?
 *
 * Mastodon is not consistent here and never has been: mainline returns **404**
 * from `POST /lists/{id}/accounts` for a non-followed account (the account is
 * simply not visible to the list), while other implementations and some
 * versions answer **422 Unprocessable Entity** with a message naming the
 * follow. Glitch/Akkoma variants phrase it differently again.
 *
 * So we match on status *and* keep a text check for servers that use a status
 * we'd otherwise pass through. 404 is safe to claim here because the list id
 * came from a listing we just fetched — a genuinely missing list is not a case
 * we can reach from this dialog.
 */
function isNotFollowingError(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) {
    return false;
  }
  if (err.status === 404) {
    return true;
  }
  const detail = String(err.error?.error ?? err.error?.message ?? '').toLowerCase();
  return err.status === 422 && (detail.includes('follow') || detail === '');
}

/** The server's own words when we have them; a plain fallback when we don't. */
function describeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const detail = String(err.error?.error ?? err.error?.message ?? '').trim();
    if (detail) {
      return detail;
    }
    if (err.status === 0) {
      return "Couldn't reach the server.";
    }
    return `The server rejected that (HTTP ${err.status}).`;
  }
  return 'Something went wrong.';
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
  private diagnostics = inject(PageDiagnostics);
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

  /** Set when an add failed because the viewer doesn't follow the target. */
  protected followGate = signal<FollowGate | null>(null);
  /** True while the follow-and-retry is in flight. */
  protected following = signal(false);
  /** Any other list error, shown verbatim so a failure is never silent. */
  protected listError = signal('');

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
    if (row.member) {
      this.diagnostics.info('Lists', 'member-remove:start', {
        listId: row.list.id,
        accountId: this.accountId(),
      });
      this.api.removeFromList(row.list.id, this.accountId()).subscribe({
        next: () => {
          this.diagnostics.info('Lists', 'member-remove:success', {
            listId: row.list.id,
            accountId: this.accountId(),
          });
          this.markMember(row.list.id, false);
        },
        error: (err) => {
          this.diagnostics.error('Lists', 'member-remove:error', err, {
            listId: row.list.id,
            accountId: this.accountId(),
            status: statusOf(err),
          });
          this.reportListError(err);
        },
      });
      return;
    }
    this.addTo(row.list, () => this.markMember(row.list.id, true));
  }

  /**
   * Add the account to one list, routing the "not followed" rejection to the
   * follow gate instead of dropping it. Shared by the checkbox and by
   * create-and-add so both fail the same way.
   */
  private addTo(list: UserList, onAdded: () => void): void {
    this.clearErrors();
    const context = { listId: list.id, accountId: this.accountId() };
    this.diagnostics.info('Lists', 'member-add:start', context);
    this.api.addToList(list.id, this.accountId()).subscribe({
      next: () => {
        this.diagnostics.info('Lists', 'member-add:success', context);
        onAdded();
      },
      error: (err) => {
        const status = statusOf(err);
        if (isNotFollowingError(err)) {
          // Not a fault — the expected refusal for an account you don't follow.
          // Logged at info so the console shows why the gate appeared, and so a
          // *misclassified* failure (a real 404 read as "follow first") is
          // visible next to the status that produced it.
          this.diagnostics.info('Lists', 'member-add:needs-follow', { ...context, status });
          this.followGate.set({
            listTitle: list.title,
            retry: () => this.addTo(list, onAdded),
          });
        } else {
          this.diagnostics.error('Lists', 'member-add:error', err, { ...context, status });
          this.reportListError(err);
        }
      },
    });
  }

  /**
   * The user accepted the follow. Follow, then re-run the add that failed.
   *
   * A follow is only "processed" here once the server confirms it; Mastodon
   * applies it synchronously for local accounts, so the immediate retry is
   * sound. A remote account behind a slow federation hop can still bounce — in
   * that case the retry re-arms the gate rather than pretending it worked.
   */
  protected confirmFollow(): void {
    const gate = this.followGate();
    if (!gate || this.following()) {
      return;
    }
    this.following.set(true);
    this.diagnostics.info('Lists', 'gate-follow:start', { accountId: this.accountId() });
    this.api.follow(this.accountId()).subscribe({
      next: () => {
        this.diagnostics.info('Lists', 'gate-follow:success', { accountId: this.accountId() });
        this.following.set(false);
        this.followGate.set(null);
        gate.retry();
      },
      error: (err) => {
        this.diagnostics.error('Lists', 'gate-follow:error', err, {
          accountId: this.accountId(),
          status: statusOf(err),
        });
        this.following.set(false);
        this.followGate.set(null);
        this.reportListError(err);
      },
    });
  }

  protected dismissFollowGate(): void {
    this.followGate.set(null);
  }

  private markMember(listId: string, member: boolean): void {
    this.rows.update((rows) => rows.map((r) => (r.list.id === listId ? { ...r, member } : r)));
  }

  private clearErrors(): void {
    this.followGate.set(null);
    this.listError.set('');
  }

  private reportListError(err: unknown): void {
    this.listError.set(describeError(err));
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
    this.diagnostics.info('Lists', 'create-and-add:start', { titleLength: title.length });
    this.api.createList(title).subscribe({
      next: (list) => {
        this.diagnostics.info('Lists', 'create-and-add:list-created', { listId: list.id });
        this.newTitle.set('');
        // The list exists now even if the add is refused, so show it immediately
        // as a non-member row; addTo flips it once membership actually lands.
        this.rows.update((rows) => [...rows, { list, member: false }]);
        this.addTo(list, () => this.markMember(list.id, true));
      },
      error: (err) => {
        this.diagnostics.error('Lists', 'create-and-add:error', err, {
          titleLength: title.length,
          status: statusOf(err),
        });
        this.reportListError(err);
      },
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
