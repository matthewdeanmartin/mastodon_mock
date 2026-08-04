import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { PageDiagnostics, statusOf } from '../../page-diagnostics';
import { Account, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { BulkAddDialog } from '../../bulk-add-dialog/bulk-add-dialog';
import { BulkActionId, BulkActions, BulkTarget } from '../../bulk-actions';
import { BulkActionsDialog } from '../../bulk-actions-dialog/bulk-actions-dialog';
import { BulkProgress } from '../../bulk-progress/bulk-progress';
import { ConfirmDialog } from '../../confirm-dialog/confirm-dialog';
import { ListCollectionConverter } from '../../list-collection-converter';
import { Auth } from '../../auth';
import { AnonymousFollows } from '../../providers/anonymous/anonymous-follows';
import { AnonymousLists } from '../../providers/anonymous/anonymous-lists';
import {
  AnonymousFollowFeedSession,
  AnonymousMastodonProvider,
} from '../../providers/anonymous/anonymous-mastodon-provider';
import { AnonymousFeedCorpus } from '../../providers/anonymous/anonymous-feed-corpus';
import { anonymousAccountRouteRef } from '../../providers/anonymous/anonymous-route-ref';
import { FeedAnalytics } from '../../feed-analytics/feed-analytics';
import { FeedSource } from '../../feed-sample';
import { JUST_MY_SERVER_LIST_PREFIX, serverOnlyStatuses } from '../../just-my-server';

/** Posts per request when sampling the list — Mastodon's cap. */
const SAMPLE_PAGE_SIZE = 40;

@Component({
  selector: 'app-list-timeline',
  imports: [
    RouterLink,
    StatusCard,
    BulkAddDialog,
    ConfirmDialog,
    FeedAnalytics,
    BulkActionsDialog,
    BulkProgress,
  ],
  templateUrl: './list-timeline.html',
  styleUrl: './list-timeline.css',
})
export class ListTimeline implements OnInit {
  private api = inject(Api);
  private diagnostics = inject(PageDiagnostics);
  private route = inject(ActivatedRoute);
  private converter = inject(ListCollectionConverter);
  protected auth = inject(Auth);
  private anonymousFollows = inject(AnonymousFollows);
  private anonymousLists = inject(AnonymousLists);
  private anonymousProvider = inject(AnonymousMastodonProvider);
  private anonymousCorpus = inject(AnonymousFeedCorpus);
  private bulk = inject(BulkActions);

  protected title = signal('');
  protected statuses = signal<Status[]>([]);
  /** The generated same-server list hides boosts whose displayed author is remote. */
  protected displayedStatuses = computed(() => {
    const title = this.title();
    if (!title.startsWith(JUST_MY_SERVER_LIST_PREFIX)) return this.statuses();
    return serverOnlyStatuses(this.statuses(), title.slice(JUST_MY_SERVER_LIST_PREFIX.length));
  });
  protected loading = signal(true);
  protected loadingMore = signal(false);
  protected exhausted = signal(true);
  protected warnings = signal<string[]>([]);
  private anonymousFeed: AnonymousFollowFeedSession | null = null;
  protected tab = signal<'posts' | 'members' | 'analytics'>('posts');

  /**
   * The feed the Analytics tab samples.
   *
   * A signed-in list is a real server timeline, so it pages. An anonymous list
   * isn't — it's synthesised by merging one fetch per followed account, and
   * there is no cursor that reproduces that merge. So the anonymous case hands
   * over the posts already on screen, and the report covers however many that
   * is (see `feed-sample.ts`).
   */
  protected feedSource = computed<FeedSource>(() => {
    const id = this.listId();
    const name = this.title() || 'List';
    if (this.auth.isAnonymous) {
      return { type: 'list', query: name, posts: this.statuses() };
    }
    return {
      type: 'list',
      query: name,
      pageSize: SAMPLE_PAGE_SIZE,
      fetch: (after: Status | null) =>
        this.api.listTimeline(id, after?.id ?? undefined, SAMPLE_PAGE_SIZE),
    };
  });

  // Members are fetched lazily, the first time the tab is opened.
  protected members = signal<Account[]>([]);
  protected membersLoading = signal(false);
  private membersLoadedFor = '';
  /** The current list id, exposed for the bulk-add dialog target. */
  protected listId = signal('');

  // Dialog state
  protected showBulk = signal(false);
  protected memberToRemove = signal<Account | null>(null);
  protected converting = signal(false);
  protected conversionMessage = signal('');

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.listId.set(id);
        this.tab.set('posts');
        this.membersLoadedFor = '';
        this.load(id);
      }
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.statuses.set([]);
    this.warnings.set([]);
    this.exhausted.set(true);
    this.anonymousFeed = null;
    if (this.auth.isAnonymous) {
      const list = this.anonymousLists.get(id);
      this.title.set(list?.title ?? 'List');
      const memberKeys = new Set(list?.memberKeys ?? []);
      const follows = this.anonymousFollows
        .follows()
        .filter((follow) => memberKeys.has(follow.key));
      this.members.set(follows.map((follow) => follow.account));
      this.membersLoadedFor = id;
      this.anonymousFeed = this.anonymousProvider.createFollowFeed(follows);
      this.fetchAnonymousPage(false);
      return;
    }
    this.api.getList(id).subscribe((l) => this.title.set(l.title));
    this.fetchMastodonPage(false);
  }

  loadMore(): void {
    if (this.loadingMore() || this.exhausted()) return;
    if (this.auth.isAnonymous) {
      this.fetchAnonymousPage(true);
    } else {
      this.fetchMastodonPage(true);
    }
  }

  private fetchMastodonPage(append: boolean): void {
    this.loadingMore.set(append);
    const maxId = append ? this.statuses().at(-1)?.id : undefined;
    this.api.listTimeline(this.listId(), maxId, SAMPLE_PAGE_SIZE).subscribe({
      next: (page) => {
        this.statuses.update((current) => {
          if (!append) return page;
          const seen = new Set(current.map((status) => status.id));
          return [...current, ...page.filter((status) => !seen.has(status.id))];
        });
        this.exhausted.set(page.length < SAMPLE_PAGE_SIZE);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadingMore.set(false);
      },
    });
  }

  private fetchAnonymousPage(append: boolean): void {
    const feed = this.anonymousFeed;
    if (!feed) {
      this.loading.set(false);
      return;
    }
    this.loadingMore.set(append);
    feed.fetchPage().subscribe({
      next: (page) => {
        this.anonymousCorpus.ingest(page.statuses);
        this.statuses.update((current) =>
          append ? [...current, ...page.statuses] : page.statuses,
        );
        this.warnings.update((current) => [...new Set([...current, ...page.warnings])]);
        this.exhausted.set(!page.hasMore);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadingMore.set(false);
        this.exhausted.set(true);
      },
    });
  }

  protected memberLink(account: Account): (string | number)[] {
    const follow = this.anonymousFollows
      .follows()
      .find(
        (item) =>
          item.account === account ||
          (item.account.id === account.id && item.account.acct === account.acct),
      );
    return this.auth.isAnonymous && follow
      ? [
          '/accounts',
          anonymousAccountRouteRef({
            server: follow.readRef.server,
            id: follow.readRef.accountId,
            originalUrl: follow.profileUrl,
          }),
        ]
      : ['/accounts', account.id];
  }

  // ---------------------------------------------------- bulk member actions

  /**
   * Follow / unfollow every member, offered on the Members tab.
   *
   * Server-backed, so it is signed-in only: an Anonymous list is a local set of
   * follows this browser keeps, with no relationships on any server to change.
   */
  protected readonly bulkRunning = this.bulk.running;
  protected readonly pendingBulk = signal<BulkActionId | null>(null);

  protected readonly bulkTarget = computed<BulkTarget>(() => ({
    listId: this.listId(),
    listTitle: this.title() || 'List',
  }));

  constructor() {
    // A finished job has changed who is followed, and for an unfollow-everyone
    // it has emptied the list itself — so re-read rather than show a stale tab.
    effect(() => {
      const phase = this.bulk.job()?.phase;
      if (phase === 'done' || phase === 'cancelled' || phase === 'failed') {
        if (this.tab() === 'members' && this.listId()) {
          this.loadMembers();
        }
      }
    });
  }

  protected askBulk(action: BulkActionId): void {
    if (!this.bulkRunning()) {
      this.pendingBulk.set(action);
    }
  }

  protected cancelBulk(): void {
    this.pendingBulk.set(null);
  }

  protected confirmBulk(): void {
    const action = this.pendingBulk();
    this.pendingBulk.set(null);
    if (action) {
      void this.bulk.start(action, this.bulkTarget());
    }
  }

  setTab(tab: 'posts' | 'members' | 'analytics'): void {
    this.tab.set(tab);
    if (tab === 'members' && this.membersLoadedFor !== this.listId()) {
      this.loadMembers();
    }
  }

  loadMembers(): void {
    if (this.auth.isAnonymous) {
      const memberKeys = new Set(this.anonymousLists.get(this.listId())?.memberKeys ?? []);
      this.members.set(
        this.anonymousFollows
          .follows()
          .filter((follow) => memberKeys.has(follow.key))
          .map((follow) => follow.account),
      );
      this.membersLoadedFor = this.listId();
      this.membersLoading.set(false);
      return;
    }
    this.membersLoading.set(true);
    this.membersLoadedFor = this.listId();
    this.api.listAccounts(this.listId()).subscribe({
      next: (accounts) => {
        this.members.set(accounts);
        this.membersLoading.set(false);
      },
      error: () => this.membersLoading.set(false),
    });
  }

  removeMember(account: Account): void {
    this.memberToRemove.set(null);
    if (this.auth.isAnonymous) {
      const follow = this.anonymousFollows.findByAccountId(account.id);
      if (follow) this.anonymousLists.setMember(this.listId(), follow.key, false);
      this.members.update((members) => members.filter((member) => member.id !== account.id));
      return;
    }
    const context = { listId: this.listId(), accountId: account.id };
    this.diagnostics.info('Lists', 'member-remove:start', context);
    this.api.removeFromList(this.listId(), account.id).subscribe({
      next: () => {
        this.diagnostics.info('Lists', 'member-remove:success', context);
        this.members.update((m) => m.filter((a) => a.id !== account.id));
      },
      // The row stays put, which is honest — they are still on the list — but
      // silently so, which is how a failed removal reads as a UI bug.
      error: (error) =>
        this.diagnostics.error('Lists', 'member-remove:error', error, {
          ...context,
          status: statusOf(error),
        }),
    });
  }

  /** After a bulk add, force the members list to reload next time it's shown. */
  onBulkAdded(): void {
    this.showBulk.set(false);
    this.membersLoadedFor = '';
    if (this.tab() === 'members') {
      this.loadMembers();
    }
  }

  onChanged(target: number | Status, updated: Status): void {
    this.statuses.update((list) =>
      list.map((status, index) =>
        (typeof target === 'number' ? index === target : status === target) ? updated : status,
      ),
    );
  }

  onDeleted(removed: Status): void {
    this.statuses.update((list) => list.filter((s) => s.id !== removed.id));
  }

  convertToCollection(): void {
    if (this.converting() || !this.title()) {
      return;
    }
    this.converting.set(true);
    this.conversionMessage.set('');
    this.converter.convertListToCollection(this.listId(), this.title()).subscribe({
      next: (result) => {
        this.converting.set(false);
        this.conversionMessage.set(
          conversionSummary('collection', result.added, result.existing, result.failed),
        );
      },
      error: () => {
        this.converting.set(false);
        this.conversionMessage.set('Could not convert this list.');
      },
    });
  }
}

function conversionSummary(
  target: string,
  added: number,
  existing: number,
  failed: number,
): string {
  const parts = [`${added} added`];
  if (existing) parts.push(`${existing} already present`);
  if (failed) parts.push(`${failed} skipped`);
  return `Converted to ${target}: ${parts.join(', ')}.`;
}
