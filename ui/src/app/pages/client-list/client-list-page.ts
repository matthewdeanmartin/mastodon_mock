import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClientList, ClientLists } from '../../lists/client-lists';
import { ProfileLists } from '../../providers/account/profile-lists';
import { ListFeedResolver, MERGE_MEMBER_CAP } from '../../lists/list-feed-resolver';
import { Account, Status } from '../../models';
import { StatusCard } from '../../status-card/status-card';
import { PageDiagnostics } from '../../page-diagnostics';

/**
 * One client-side list: its posts, and the accounts behind them.
 *
 * Follows the `ListTimeline` shape (Posts / Members tabs) because that is the pattern
 * every list in this app presents, whatever produces its feed — see
 * `sprint/lists-0-overview.md`. What differs here is the two-step resolution: members
 * are stored as handles ({@link ClientLists}), so they must be looked up before their
 * timelines can be merged.
 */
@Component({
  selector: 'app-client-list-page',
  imports: [RouterLink, StatusCard],
  templateUrl: './client-list-page.html',
  styleUrl: './client-list-page.css',
})
export class ClientListPage implements OnInit {
  private route = inject(ActivatedRoute);
  private store = inject(ClientLists);
  private profileLists = inject(ProfileLists);
  private resolver = inject(ListFeedResolver);
  private diagnostics = inject(PageDiagnostics);

  protected list = signal<ClientList | null>(null);
  protected members = signal<Account[]>([]);
  protected statuses = signal<Status[]>([]);
  protected loading = signal(true);
  protected tab = signal<'posts' | 'members'>('posts');

  /** Handles the server could not resolve — shown so a silent gap is explicable. */
  protected unresolved = signal<string[]>([]);

  /**
   * True when the list has more members than one merge fans out to.
   *
   * Merging N member timelines is fast against the mock and slow against real
   * mastodon.social, so the resolver caps the fan-out. Saying so is better than
   * quietly showing a partial feed the reader would read as the whole list.
   */
  protected capped = computed(() => (this.list()?.memberHandles.length ?? 0) > MERGE_MEMBER_CAP);
  protected readonly memberCap = MERGE_MEMBER_CAP;

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        void this.load(id);
      }
    });
  }

  /**
   * Resolve a list from whichever store holds it.
   *
   * The route is shared by both destinations because a list is a list: the page
   * renders members and posts identically whether the record came from this
   * browser or from the account. Only the lookup differs, and the ids do not
   * collide — a Plus list is `mwk-list-*`, a local one `client-list-*`.
   *
   * Local is checked first and without awaiting anything, so the common case
   * still renders synchronously and signed-out users never wait on a network
   * call they have no account for.
   */
  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.tab.set('posts');
    this.statuses.set([]);
    this.members.set([]);
    this.unresolved.set([]);

    let list = this.store.get(id);
    if (!list) {
      // Only reachable for an id this browser does not hold locally, so a
      // signed-out visitor pays nothing: `ProfileLists.load()` refuses before
      // the network when there is no account key.
      await this.profileLists.load();
      list = this.profileLists.get(id);
    }
    this.list.set(list);
    if (!list || !list.memberHandles.length) {
      this.loading.set(false);
      return;
    }

    this.resolver.resolveHandles(list.memberHandles).subscribe({
      next: (accounts) => {
        this.members.set(accounts);
        const found = new Set(accounts.map((a) => a.acct.toLowerCase()));
        this.unresolved.set(
          list.memberHandles.filter((h) => !found.has(h) && !found.has(h.split('@')[0])),
        );
        if (!accounts.length) {
          this.loading.set(false);
          return;
        }
        this.resolver.mergeMemberTimelines(accounts.map((a) => a.id)).subscribe({
          next: (merged) => {
            this.statuses.set(merged.statuses);
            this.loading.set(false);
            this.diagnostics.info('ClientListPage', 'feed:loaded', {
              members: accounts.length,
              posts: merged.statuses.length,
            });
          },
          error: (error: unknown) => {
            this.loading.set(false);
            this.diagnostics.error('ClientListPage', 'feed:error', error);
          },
        });
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.diagnostics.error('ClientListPage', 'resolve:error', error);
      },
    });
  }
}
