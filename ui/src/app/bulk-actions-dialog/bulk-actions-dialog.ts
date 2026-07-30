import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { BulkActionId, BulkActions, BulkPreview, bulkAction } from '../bulk-actions';

/**
 * "Here is exactly what is about to happen — do you still want it?" for a bulk
 * action.
 *
 * Deliberately not the generic {@link ConfirmDialog}: everything that makes this
 * safe is specific. It runs the planning pass before asking, so the prompt says
 * "unblock all 47 accounts" rather than "unblock everyone" and the user knows
 * the size of what they are agreeing to. It spells out the consequences as
 * separate statements rather than one paragraph nobody reads. And for the two
 * destructive actions it offers a CSV of the list first, because "this can only
 * be undone if you backed it up" is only fair if backing it up is one click
 * away.
 *
 * The host owns open/closed state and reacts to (confirmed).
 */
@Component({
  selector: 'app-bulk-actions-dialog',
  imports: [],
  templateUrl: './bulk-actions-dialog.html',
  styleUrl: './bulk-actions-dialog.css',
})
export class BulkActionsDialog implements OnInit {
  private readonly bulk = inject(BulkActions);

  readonly action = input.required<BulkActionId>();
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly spec = computed(() => bulkAction(this.action()));
  protected readonly preview = signal<BulkPreview | null>(null);
  protected readonly loading = signal(true);
  protected readonly backup = signal<{ saved: boolean; count: number } | null>(null);
  protected readonly backupBusy = signal(false);
  protected readonly backupError = signal('');

  /**
   * Counting starts here rather than in the constructor: `action` is a required
   * input, and reading one before Angular has set it throws — which left the
   * dialog stuck on "Checking…" forever.
   */
  ngOnInit(): void {
    void this.load();
  }

  /** Count what the action would touch. Re-runnable after a failure. */
  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.preview.set(await this.bulk.preview(this.action()));
    } finally {
      // Never leave the dialog claiming to be busy; a stuck spinner in front of
      // a destructive action is worse than an error message.
      this.loading.set(false);
    }
  }

  /** Nothing to do — used to turn Confirm into a plain "Close". */
  protected readonly noWork = computed(() => {
    const preview = this.preview();
    return !!preview && !preview.error && preview.targets === 0;
  });

  /** The headline sentence, with the real number in it. */
  protected readonly summary = computed(() => {
    const preview = this.preview();
    const spec = this.spec();
    if (!preview || preview.error) {
      return '';
    }
    const count = preview.targets.toLocaleString();
    const about = preview.approximate ? 'at least ' : '';
    switch (spec.id) {
      case 'reblogs-off':
      case 'reblogs-on': {
        if (!preview.targets) {
          return `Nothing to do — retweets are already ${
            spec.id === 'reblogs-on' ? 'on' : 'off'
          } for everyone you follow.`;
        }
        const friends = preview.targets + preview.alreadyCorrect;
        const noun = preview.targets === 1 ? 'account' : 'accounts';
        // "1 of your 1 friends" is nonsense; when nobody is being skipped, say so.
        return preview.alreadyCorrect === 0
          ? `This will change all ${about}${count} ${
              friends === 1 ? 'account you follow' : 'accounts you follow'
            }.`
          : `This will change ${about}${count} ${noun} of the ${friends.toLocaleString()} you follow. The rest are already set that way and will be left alone.`;
      }
      case 'mute-amnesty':
        return preview.targets
          ? `This will unmute ${about}${count} ${preview.targets === 1 ? 'account' : 'accounts'}.`
          : 'Nothing to do — your mute list is already empty.';
      case 'block-amnesty':
        return preview.targets
          ? `This will unblock ${about}${count} ${preview.targets === 1 ? 'account' : 'accounts'}.`
          : 'Nothing to do — your block list is already empty.';
    }
  });

  /**
   * Download the list as CSV before it is destroyed.
   *
   * Built and downloaded client-side (see {@link BulkActions.backupCsv}) so it
   * works against any server, and formatted to match Mastodon's own export so it
   * can be imported back.
   */
  protected async downloadBackup(): Promise<void> {
    const spec = this.spec();
    if (!spec.backup || this.backupBusy()) {
      return;
    }
    this.backupBusy.set(true);
    this.backupError.set('');
    try {
      const { csv, count } = await this.bulk.backupCsv(spec.id);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${spec.backup}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      this.backup.set({ saved: true, count });
    } catch {
      this.backupError.set('Could not build the backup. You can still continue, or try again.');
    } finally {
      this.backupBusy.set(false);
    }
  }
}
