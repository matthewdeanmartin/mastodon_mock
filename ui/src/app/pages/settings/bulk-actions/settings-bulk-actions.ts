import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Api } from '../../../api';
import {
  BULK_ACTIONS,
  BulkActionId,
  BulkActions,
  BulkTarget,
  needsList,
} from '../../../bulk-actions';
import { BulkActionsDialog } from '../../../bulk-actions-dialog/bulk-actions-dialog';
import { BulkProgress } from '../../../bulk-progress/bulk-progress';
import { UserList } from '../../../models';

/**
 * Settings → Bulk actions: the whole-account operations, each behind a dialog
 * that counts the damage first, with one shared progress panel.
 *
 * Split into two groups because they take different inputs. The account-wide
 * actions need nothing but a confirmation; the list actions need to be told
 * which list, so they share a picker rather than repeating one per card.
 *
 * The amnesty actions also sit at the top of the Muted and Blocked pages, and
 * the list actions on a list's own Members tab, where someone looking at the
 * thing is most likely to want them; this tab is where you go when you already
 * know what you want to do.
 */
@Component({
  selector: 'app-settings-bulk-actions',
  imports: [BulkActionsDialog, BulkProgress],
  templateUrl: './settings-bulk-actions.html',
  styleUrl: './settings-bulk-actions.css',
})
export class SettingsBulkActions implements OnInit {
  private readonly bulk = inject(BulkActions);
  private readonly api = inject(Api);

  /** Template-side, so the dialog is only handed a target it will actually use. */
  protected readonly needsList = needsList;

  protected readonly accountActions = BULK_ACTIONS.filter((a) => !needsList(a.id));
  protected readonly listActions = BULK_ACTIONS.filter((a) => needsList(a.id));
  protected readonly running = this.bulk.running;
  protected readonly job = this.bulk.job;

  protected readonly lists = signal<UserList[]>([]);
  protected readonly listsLoading = signal(true);
  protected readonly selectedListId = signal('');

  /** Which action's confirmation dialog is open, if any. */
  protected readonly pending = signal<BulkActionId | null>(null);

  /** The action a finished-or-running job belongs to, so its card can say so. */
  protected readonly activeAction = computed(() => this.job()?.action ?? null);

  ngOnInit(): void {
    this.api.lists().subscribe({
      next: (lists) => {
        this.lists.set(lists);
        // Preselect, so the buttons are usable without a first interaction that
        // does nothing visible.
        this.selectedListId.set(lists[0]?.id ?? '');
        this.listsLoading.set(false);
      },
      error: () => this.listsLoading.set(false),
    });
  }

  /** The chosen list as the service wants it, or undefined if none is chosen. */
  protected readonly target = computed<BulkTarget | undefined>(() => {
    const id = this.selectedListId();
    const list = this.lists().find((l) => l.id === id);
    return list ? { listId: list.id, listTitle: list.title } : undefined;
  });

  protected selectList(id: string): void {
    this.selectedListId.set(id);
  }

  protected ask(id: BulkActionId): void {
    if (this.running() || (needsList(id) && !this.target())) {
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
      void this.bulk.start(id, needsList(id) ? this.target() : undefined);
    }
  }
}
