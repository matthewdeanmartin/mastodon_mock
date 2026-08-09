import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, CollectionWithAccounts, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { BulkAddDialog } from '../../bulk-add-dialog/bulk-add-dialog';
import { BulkActions, BulkTarget } from '../../bulk-actions';
import { BulkActionsDialog } from '../../bulk-actions-dialog/bulk-actions-dialog';
import { BulkProgress } from '../../bulk-progress/bulk-progress';
import { ConfirmDialog } from '../../confirm-dialog/confirm-dialog';
import { FollowButton } from '../../follow-button/follow-button';
import { FollowState } from '../../follow-state';
import { ListCollectionConverter } from '../../list-collection-converter';
import { ListFeedResolver } from '../../lists/list-feed-resolver';
import { anonymousAccountRouteRef } from '../../providers/anonymous/anonymous-route-ref';
import { AnonymousPublicApi } from '../../providers/anonymous/anonymous-public-api';
import {
  shippedStarterKit,
  shippedStarterKitCollection,
  ShippedStarterKit,
} from '../../starter-kits';

/**
 * Where to read a shipped member's posts from, or null for a local account.
 *
 * Their `url` is the only thing that says which instance they are on — the id is
 * meaningless anywhere else, which is precisely why asking the home server for
 * it 404s.
 */
function publicRefFor(account: Account): { server: string; id: string } | null {
  if (!account.url) {
    return null;
  }
  try {
    return { server: new URL(account.url).origin, id: account.id };
  } catch {
    return null;
  }
}

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
  imports: [
    FormsModule,
    RouterLink,
    NgTemplateOutlet,
    StatusCard,
    BulkAddDialog,
    ConfirmDialog,
    FollowButton,
    BulkActionsDialog,
    BulkProgress,
  ],
  templateUrl: './collection.html',
  styleUrl: './collection.css',
})
export class CollectionPage implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private converter = inject(ListCollectionConverter);
  protected follows = inject(FollowState);
  protected bulk = inject(BulkActions);
  private feedResolver = inject(ListFeedResolver);
  private anonymousApi = inject(AnonymousPublicApi);

  protected data = signal<CollectionWithAccounts | null>(null);
  protected shipped = signal<ShippedStarterKit | null>(null);
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
  protected converting = signal(false);
  protected conversionMessage = signal('');

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

  /**
   * Whether this page can offer follow buttons at all.
   *
   * Signed-in only — an anonymous session has no relationships and no token to
   * write one with.
   *
   * Shipped starter kits are included, but by a different route. Their members
   * are accounts on other instances, so the ids they carry are meaningless
   * here; the button resolves each one to its local record first (webfinger via
   * `search?resolve=true`) and acts on that. See {@link foreignMember}.
   */
  protected canFollow = computed(() => !this.auth.isAnonymous);

  /**
   * The account to resolve before following, or null when its id is already
   * one this server can act on.
   *
   * Only shipped kits need it: a real server-side collection's members are
   * local records by definition.
   */
  protected foreignMember(account: Account): Account | null {
    return this.shipped() ? account : null;
  }

  /**
   * Resolve follow state for every member, in batches.
   *
   * The collection page's whole job is "here are people worth following", and
   * it used to answer the obvious follow-up — *which of them do I already
   * follow?* — only by making you open each one in a new tab.
   */
  private resolveFollows(): void {
    // Shipped kits are deliberately excluded: their ids are foreign, so asking
    // for relationships on them would answer about whoever holds those ids
    // locally. Each row resolves itself instead, one webfinger at a time.
    if (!this.canFollow() || this.shipped()) {
      return;
    }
    void this.follows.resolve(this.members().map((m) => m.account.id));
  }

  /** Whether the follow-everyone confirmation is open. */
  protected followAllOpen = signal(false);

  /**
   * This collection, as the bulk runner wants it.
   *
   * `list-follow` is reused rather than given a collection-specific twin: the
   * job is identical — read members, skip the ones already followed, write the
   * rest with pacing and rate-limit pauses — and the only difference is the
   * read, which {@link BulkTarget.kind} selects.
   */
  protected followAllTarget = computed<BulkTarget | undefined>(() => {
    const d = this.data();
    return d
      ? { listId: d.collection.id, listTitle: d.collection.name, kind: 'collection' }
      : undefined;
  });

  protected askFollowAll(): void {
    if (!this.bulk.running() && this.followAllTarget()) {
      this.followAllOpen.set(true);
    }
  }

  protected confirmFollowAll(): void {
    this.followAllOpen.set(false);
    const target = this.followAllTarget();
    if (!target) {
      return;
    }
    // Not awaited: the progress panel reports it, and the user is free to leave.
    void this.bulk.start('list-follow', target).then(() => {
      // Re-read relationships so the per-row buttons agree with what just
      // happened, rather than showing "Follow" for people we just followed.
      this.follows.reset();
      this.resolveFollows();
    });
  }

  /**
   * Route to a member's profile, keeping them inside Mawkingbird.
   *
   * A shipped collection's members are accounts on other instances, so their
   * ids mean nothing to the home server. An anonymous route ref carries the
   * origin alongside the id, which is what lets the profile page fetch them —
   * the same resolution the collection widget on Home already used. Members of
   * a real server-side collection are local and route by plain id.
   */
  protected memberLink(account: Account): (string | number)[] {
    if (!this.shipped() || !account.url) {
      return ['/accounts', account.id];
    }
    try {
      return [
        '/accounts',
        anonymousAccountRouteRef({
          server: new URL(account.url).origin,
          id: account.id,
          originalUrl: account.url,
        }),
      ];
    } catch {
      return ['/accounts', account.id];
    }
  }

  protected curator = computed<Account | null>(() => {
    const d = this.data();
    return d ? (d.accounts.find((a) => a.id === d.collection.account_id) ?? null) : null;
  });

  protected isOwner = computed(() => {
    const d = this.data();
    return !this.shipped() && !!d && d.collection.account_id === this.auth.account()?.id;
  });

  /** My own item in someone else's collection, if I'm featured in it. */
  protected myItem = computed<Member | null>(() => {
    if (this.shipped()) {
      return null;
    }
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
    const kit = shippedStarterKit(id);
    if (kit) {
      this.shipped.set(kit);
      this.data.set(shippedStarterKitCollection(kit));
      this.tab.set('members');
      this.loading.set(false);
      return;
    }
    this.shipped.set(null);
    this.api.getCollection(id).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
        this.resolveFollows();
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
    // Shipped collections use the explicit, bounded sample control on Posts;
    // loading every member here would defeat that control and recreate the
    // giant injected feed this split is meant to avoid.
    if (tab === 'feed' && !this.shipped()) {
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
    this.feedResolver.mergeMemberTimelines(ids).subscribe({
      next: (merged) => {
        this.feed.set(merged.statuses);
        this.feedLoading.set(false);
      },
      error: () => this.feedLoading.set(false),
    });
  }

  // ------------------------------------------------------------- preview

  /** Sample sizes offered on a preview. Each member costs one request. */
  protected readonly sampleSizes = [5, 10, 25] as const;

  /** How many members to sample posts from. Small by default: this costs N calls. */
  protected sampleSize = signal(5);

  /** True once a preview sample has been asked for, so the empty state can differ. */
  protected sampled = signal(false);

  protected setSampleSize(value: string): void {
    this.sampleSize.set(Number(value) || 5);
  }

  /**
   * Load a sample of posts from a shipped collection's members.
   *
   * A preview of a curated list is nearly useless without seeing what these
   * people actually post — but the members live on other instances, so there is
   * no single timeline to fetch and it costs one request per member. Hence the
   * explicit size and an explicit button: the reader decides how much this is
   * worth, rather than the page spending 24 requests on their behalf.
   *
   * Members are shuffled before sampling, so pressing it again on a large
   * collection surfaces different people rather than the same first five.
   */
  protected loadSample(): void {
    const accepted = this.members().filter((m) => m.state === 'accepted');
    if (!accepted.length || this.feedLoading()) {
      return;
    }
    const shuffled = [...accepted];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const picked = shuffled.slice(0, this.sampleSize()).map((m) => m.account);
    this.sampled.set(true);
    this.feedLoading.set(true);

    // Shipped members live on *their* instances, so their ids mean nothing to the
    // home server — asking it produces a 404 per member and an empty sample. Each
    // one is fetched from its own origin instead, the same public read the
    // profile page makes.
    forkJoin(
      picked.map((account) => {
        const ref = this.shipped() ? publicRefFor(account) : null;
        const request = ref
          ? this.anonymousApi.getAccountStatuses(ref, { excludeReplies: true, limit: 20 })
          : this.api.getAccountStatuses(account.id, { excludeReplies: true, limit: 20 });
        return request.pipe(catchError(() => of([] as Status[])));
      }),
    ).subscribe({
      next: (lists) => {
        this.feed.set(
          lists
            .flat()
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 60),
        );
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
    this.api.deleteCollection(d.collection.id).subscribe(() => this.router.navigate(['/feeds']));
  }

  /** Re-fetch the collection after a bulk add (the server assigns item ids). */
  onBulkAdded(): void {
    this.showBulk.set(false);
    this.reload();
  }

  convertToList(): void {
    const d = this.data();
    if (!d || this.converting()) {
      return;
    }
    this.converting.set(true);
    this.conversionMessage.set('');
    this.converter.convertCollectionToList(d).subscribe({
      next: (result) => {
        this.converting.set(false);
        const parts = [`${result.added} added`];
        if (result.existing) parts.push(`${result.existing} already present`);
        if (result.failed) parts.push(`${result.failed} skipped`);
        // The common failure, and the one that made this look broken: most
        // servers only keep accounts you follow in a list, so a collection of
        // strangers converts to an empty one. Name the cause and the fix — the
        // button that does it is directly above this message.
        const hint = result.needsFollow
          ? ' Most servers only keep accounts you follow in a list — use “Follow everyone in this collection” first, then convert again.'
          : '';
        this.conversionMessage.set(`Converted to list: ${parts.join(', ')}.${hint}`);
      },
      error: () => {
        this.converting.set(false);
        this.conversionMessage.set('Could not convert this collection.');
      },
    });
  }

  private reload(): void {
    const d = this.data();
    if (d) {
      this.load(d.collection.id);
    }
  }
}
