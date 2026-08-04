import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClientList, ClientLists } from '../../lists/client-lists';
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
        this.load(id);
      }
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.tab.set('posts');
    this.statuses.set([]);
    this.members.set([]);
    this.unresolved.set([]);

    const list = this.store.get(id);
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
