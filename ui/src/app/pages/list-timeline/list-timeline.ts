import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Account, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { BulkAddDialog } from '../../bulk-add-dialog/bulk-add-dialog';
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

@Component({
  selector: 'app-list-timeline',
  imports: [RouterLink, StatusCard, BulkAddDialog, ConfirmDialog],
  templateUrl: './list-timeline.html',
  styleUrl: './list-timeline.css',
})
export class ListTimeline implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private converter = inject(ListCollectionConverter);
  protected auth = inject(Auth);
  private anonymousFollows = inject(AnonymousFollows);
  private anonymousLists = inject(AnonymousLists);
  private anonymousProvider = inject(AnonymousMastodonProvider);
  private anonymousCorpus = inject(AnonymousFeedCorpus);

  protected title = signal('');
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected loadingMore = signal(false);
  protected exhausted = signal(true);
  protected warnings = signal<string[]>([]);
  private anonymousFeed: AnonymousFollowFeedSession | null = null;
  protected tab = signal<'posts' | 'members'>('posts');

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
    this.api.listTimeline(id).subscribe({
      next: (s) => {
        this.statuses.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadMore(): void {
    if (!this.auth.isAnonymous || this.loadingMore() || this.exhausted()) return;
    this.fetchAnonymousPage(true);
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

  setTab(tab: 'posts' | 'members'): void {
    this.tab.set(tab);
    if (tab === 'members' && this.membersLoadedFor !== this.listId()) {
      this.loadMembers();
    }
  }

  loadMembers(): void {
    if (this.auth.isAnonymous) {
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
    this.api.removeFromList(this.listId(), account.id).subscribe(() => {
      this.members.update((m) => m.filter((a) => a.id !== account.id));
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

  onChanged(index: number, updated: Status): void {
    this.statuses.update((list) => list.map((s, i) => (i === index ? updated : s)));
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
