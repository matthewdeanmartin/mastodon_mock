import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../../../api';
import { BulkActionId, BulkActions } from '../../../bulk-actions';
import { BulkActionsDialog } from '../../../bulk-actions-dialog/bulk-actions-dialog';
import { BulkProgress } from '../../../bulk-progress/bulk-progress';
import { Account } from '../../../models';

type Kind = 'mutes' | 'blocks';

/**
 * Muted accounts / Blocked accounts — one component, chosen by route data
 * `kind`.
 *
 * Carries the matching amnesty action at the top, because looking at a list of
 * 200 blocks you no longer care about is exactly when you want to be rid of all
 * of them, and hunting through Settings for the tab that does it is friction at
 * the wrong moment. It is the same job the Bulk actions tab starts, same dialog,
 * same progress panel.
 */
@Component({
  selector: 'app-settings-account-list',
  imports: [RouterLink, BulkActionsDialog, BulkProgress],
  templateUrl: './settings-account-list.html',
  styleUrl: './settings-account-list.css',
})
export class SettingsAccountList implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private bulk = inject(BulkActions);

  protected kind = signal<Kind>('mutes');
  protected accounts = signal<Account[]>([]);
  protected loading = signal(false);

  // -------------------------------------------------------------- amnesty

  protected readonly amnestyRunning = this.bulk.running;
  /** True while the confirmation dialog for this page's amnesty is open. */
  protected readonly asking = signal(false);

  protected readonly amnestyAction = computed<BulkActionId>(() =>
    this.kind() === 'mutes' ? 'mute-amnesty' : 'block-amnesty',
  );

  protected readonly amnestyLabel = computed(() =>
    this.kind() === 'mutes' ? 'Unmute everyone' : 'Unblock everyone',
  );

  constructor() {
    // Reload once the job finishes so the list reflects what just happened
    // rather than showing accounts that are no longer muted or blocked.
    effect(() => {
      const phase = this.bulk.job()?.phase;
      if (phase === 'done' || phase === 'cancelled' || phase === 'failed') {
        this.load();
      }
    });
  }

  protected askAmnesty(): void {
    if (!this.amnestyRunning()) {
      this.asking.set(true);
    }
  }

  protected cancelAmnesty(): void {
    this.asking.set(false);
  }

  protected confirmAmnesty(): void {
    this.asking.set(false);
    void this.bulk.start(this.amnestyAction());
  }

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      this.kind.set((data['kind'] as Kind) ?? 'mutes');
      this.load();
    });
  }

  protected get title(): string {
    return this.kind() === 'mutes' ? 'Muted accounts' : 'Blocked accounts';
  }

  protected get subtitle(): string {
    return this.kind() === 'mutes'
      ? "You won't see posts or notifications from these accounts. They can still follow you."
      : "These accounts can't follow you, see your posts, or interact with you.";
  }

  private load(): void {
    this.loading.set(true);
    const call = this.kind() === 'mutes' ? this.api.mutes() : this.api.blocks();
    call.subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  undo(acc: Account): void {
    const call =
      this.kind() === 'mutes' ? this.api.unmuteAccount(acc.id) : this.api.unblockAccount(acc.id);
    call.subscribe(() => {
      this.accounts.update((list) => list.filter((a) => a.id !== acc.id));
    });
  }
}
