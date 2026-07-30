import { Component, computed, inject, signal } from '@angular/core';
import { BULK_ACTIONS, BulkActionId, BulkActions } from '../../../bulk-actions';
import { BulkActionsDialog } from '../../../bulk-actions-dialog/bulk-actions-dialog';
import { BulkProgress } from '../../../bulk-progress/bulk-progress';

/**
 * Settings → Bulk actions: the four whole-account operations, each behind a
 * dialog that counts the damage first, with one shared progress panel.
 *
 * The same two amnesty actions also sit at the top of the Muted and Blocked
 * pages, where someone staring at the list is most likely to want them; this tab
 * is the place you go when you already know what you want to do.
 */
@Component({
  selector: 'app-settings-bulk-actions',
  imports: [BulkActionsDialog, BulkProgress],
  templateUrl: './settings-bulk-actions.html',
  styleUrl: './settings-bulk-actions.css',
})
export class SettingsBulkActions {
  private readonly bulk = inject(BulkActions);

  protected readonly actions = BULK_ACTIONS;
  protected readonly running = this.bulk.running;
  protected readonly job = this.bulk.job;

  /** Which action's confirmation dialog is open, if any. */
  protected readonly pending = signal<BulkActionId | null>(null);

  /** The action a finished-or-running job belongs to, so its card can say so. */
  protected readonly activeAction = computed(() => this.job()?.action ?? null);

  protected ask(id: BulkActionId): void {
    if (this.running()) {
      return;
    }
    this.pending.set(id);
  }

  protected cancel(): void {
    this.pending.set(null);
  }

  protected confirm(): void {
    const id = this.pending();
    this.pending.set(null);
    if (id) {
      // Deliberately not awaited: the job reports itself through the progress
      // panel, and the user is free to navigate away while it runs.
      void this.bulk.start(id);
    }
  }
}
