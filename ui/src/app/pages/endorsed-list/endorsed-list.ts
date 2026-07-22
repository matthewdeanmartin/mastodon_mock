import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Account, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { ListFeedResolver, MERGE_MEMBER_CAP } from '../../lists/list-feed-resolver';

/**
 * An account's endorsed ("featured") accounts presented as a list: the members
 * are the endorsements (managed on the owner's profile, read-only here) and the
 * feed is their merged recent timelines (client-side synthesis via
 * {@link ListFeedResolver}, same as collections). See sprint/lists-3-endorsed-lists.md.
 */
@Component({
  selector: 'app-endorsed-list',
  imports: [RouterLink, StatusCard],
  templateUrl: './endorsed-list.html',
  styleUrl: './endorsed-list.css',
})
export class EndorsedList implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private resolver = inject(ListFeedResolver);
  protected auth = inject(Auth);

  protected accountId = signal('');
  protected owner = signal<Account | null>(null);
  protected members = signal<Account[]>([]);
  protected feed = signal<Status[]>([]);
  protected loading = signal(true);
  protected feedLoading = signal(false);
  protected error = signal('');
  protected cappedNote = signal('');
  protected tab = signal<'feed' | 'members'>('feed');

  protected isSelf = computed(() => this.owner()?.id === this.auth.account()?.id);
  protected title = computed(() => {
    const o = this.owner();
    const who = o ? o.display_name || o.username : 'this account';
    return this.isSelf() ? 'Your endorsed accounts' : `Endorsed by ${who}`;
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('accountId');
      if (id) {
        this.accountId.set(id);
        this.tab.set('feed');
        this.load(id);
      }
    });
  }

  load(id: string): void {
    this.loading.set(true);
    this.error.set('');
    this.owner.set(null);
    this.members.set([]);
    this.feed.set([]);
    this.cappedNote.set('');

    // The owner's own display name is nice-to-have; a failure here is non-fatal.
    this.api.getAccount(id).subscribe({
      next: (a) => this.owner.set(a),
      error: () => {
        /* header falls back to "this account" */
      },
    });

    this.api.accountEndorsements(id).subscribe({
      next: (accounts) => {
        this.members.set(accounts);
        this.loading.set(false);
        this.loadFeed();
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load endorsed accounts for this profile.');
      },
    });
  }

  private loadFeed(): void {
    const ids = this.members().map((m) => m.id);
    if (!ids.length) {
      this.feed.set([]);
      return;
    }
    this.feedLoading.set(true);
    this.resolver.mergeMemberTimelines(ids).subscribe({
      next: (merged) => {
        this.feed.set(merged.statuses);
        this.feedLoading.set(false);
        this.cappedNote.set(
          merged.capped
            ? `Feed merges posts from the first ${MERGE_MEMBER_CAP} of ${merged.cappedFrom} members.`
            : '',
        );
      },
      error: () => this.feedLoading.set(false),
    });
  }

  setTab(tab: 'feed' | 'members'): void {
    this.tab.set(tab);
  }

  onChanged(index: number, updated: Status): void {
    this.feed.update((list) => list.map((s, i) => (i === index ? updated : s)));
  }

  onDeleted(removed: Status): void {
    this.feed.update((list) => list.filter((s) => s.id !== removed.id));
  }
}
