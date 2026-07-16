import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, CollectionWithAccounts, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { BulkAddDialog } from '../../bulk-add-dialog/bulk-add-dialog';
import { ConfirmDialog } from '../../confirm-dialog/confirm-dialog';

/** How many statuses to pull per member when synthesizing the feed. */
const FEED_PER_MEMBER = 20;
/** Cap on the merged feed length. */
const FEED_MAX = 40;

/** A member of the collection paired with its item id (needed for removal). */
interface Member {
  itemId: string;
  state: 'pending' | 'accepted';
  account: Account;
}

/**
 * A single Collection (Mastodon 4.6+): a curated set of accounts.
 * Shows the members and a client-side feed merged from the members' recent
 * statuses — the API has no collection timeline endpoint, so the feed is
 * synthesized in the browser (same client-side-only constraint as elsewhere).
 */
@Component({
  selector: 'app-collection',
  imports: [FormsModule, RouterLink, StatusCard, BulkAddDialog, ConfirmDialog],
  templateUrl: './collection.html',
  styleUrl: './collection.css',
})
export class CollectionPage implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected data = signal<CollectionWithAccounts | null>(null);
  protected loading = signal(true);
  protected error = signal('');
  protected tab = signal<'feed' | 'members'>('feed');

  protected feed = signal<Status[]>([]);
  protected feedLoading = signal(false);
  private feedLoadedFor = '';

  // Add-member search (owner only)
  protected query = signal('');
  protected searching = signal(false);
  protected results = signal<Account[]>([]);

  // Dialog state
  protected showBulk = signal(false);
  protected showDeleteConfirm = signal(false);
  protected memberToRemove = signal<Member | null>(null);

  protected members = computed<Member[]>(() => {
    const d = this.data();
    if (!d) {
      return [];
    }
    const byId = new Map(d.accounts.map((a) => [a.id, a]));
    const out: Member[] = [];
    for (const item of d.collection.items) {
      const account = item.account_id ? byId.get(item.account_id) : undefined;
      if (account) {
        out.push({ itemId: item.id, state: item.state, account });
      }
    }
    return out;
  });

  protected curator = computed<Account | null>(() => {
    const d = this.data();
    return d ? (d.accounts.find((a) => a.id === d.collection.account_id) ?? null) : null;
  });

  protected isOwner = computed(() => {
    const d = this.data();
    return !!d && d.collection.account_id === this.auth.account()?.id;
  });

  /** My own item in someone else's collection, if I'm featured in it. */
  protected myItem = computed<Member | null>(() => {
    const me = this.auth.account()?.id;
    return (this.members().find((m) => m.account.id === me) as Member | undefined) ?? null;
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.load(id);
      }
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.error.set('');
    this.feedLoadedFor = '';
    this.api.getCollection(id).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
        if (this.tab() === 'feed') {
          this.loadFeed();
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          err?.status === 404
            ? 'Collection not found (this server may not support collections).'
            : 'Could not load this collection.',
        );
      },
    });
  }

  setTab(tab: 'feed' | 'members'): void {
    this.tab.set(tab);
    if (tab === 'feed') {
      this.loadFeed();
    }
  }

  /** Merge each member's recent statuses into one reverse-chronological feed. */
  loadFeed(): void {
    const d = this.data();
    if (!d || this.feedLoadedFor === d.collection.id) {
      return;
    }
    const ids = this.members()
      .filter((m) => m.state === 'accepted')
      .map((m) => m.account.id);
    this.feedLoadedFor = d.collection.id;
    if (!ids.length) {
      this.feed.set([]);
      return;
    }
    this.feedLoading.set(true);
    forkJoin(
      ids.map((id) =>
        this.api
          .getAccountStatuses(id, { excludeReplies: true, limit: FEED_PER_MEMBER })
          .pipe(catchError(() => of([] as Status[]))),
      ),
    )
      .pipe(
        map((lists) =>
          lists
            .flat()
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, FEED_MAX),
        ),
      )
      .subscribe({
        next: (statuses) => {
          this.feed.set(statuses);
          this.feedLoading.set(false);
        },
        error: () => this.feedLoading.set(false),
      });
  }

  onChanged(index: number, updated: Status): void {
    this.feed.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.feed.update((list) => list.filter((s) => s.id !== removed.id));
  }

  search(): void {
    const q = this.query().trim();
    if (!q) {
      return;
    }
    this.searching.set(true);
    this.api.search(q, 'accounts', { resolve: true, limit: 5 }).subscribe({
      next: (r) => {
        this.results.set(r.accounts);
        this.searching.set(false);
      },
      error: () => this.searching.set(false),
    });
  }

  addMember(account: Account): void {
    const d = this.data();
    if (!d) {
      return;
    }
    this.api.addCollectionAccount(d.collection.id, account.id).subscribe(() => {
      this.results.update((r) => r.filter((a) => a.id !== account.id));
      this.query.set('');
      // Re-fetch: the server assigns the item id/state we need for later removal.
      this.reload();
    });
  }

  removeMember(member: Member): void {
    const d = this.data();
    this.memberToRemove.set(null);
    if (!d) {
      return;
    }
    this.api.removeCollectionItem(d.collection.id, member.itemId).subscribe(() => this.reload());
  }

  /** Remove myself from someone else's collection. */
  revokeSelf(): void {
    const d = this.data();
    const mine = this.myItem();
    if (!d || !mine) {
      return;
    }
    this.api.revokeCollectionItem(d.collection.id, mine.itemId).subscribe(() => this.reload());
  }

  remove(): void {
    const d = this.data();
    this.showDeleteConfirm.set(false);
    if (!d) {
      return;
    }
    this.api.deleteCollection(d.collection.id).subscribe(() => this.router.navigate(['/lists']));
  }

  /** Re-fetch the collection after a bulk add (the server assigns item ids). */
  onBulkAdded(): void {
    this.showBulk.set(false);
    this.reload();
  }

  private reload(): void {
    const d = this.data();
    if (d) {
      this.load(d.collection.id);
    }
  }
}
