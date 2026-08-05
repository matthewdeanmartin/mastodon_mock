import { Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { Auth } from '../auth';
import { SessionTeardown } from '../session-teardown';

/** What the user chose on the way out. */
export type LeaveChoice = 'leave' | 'anonymous-data' | 'all-data';

/**
 * "Are you sure?" for leaving — and, more to the point, an offer to take your data
 * with you.
 *
 * Logging out used to be immediate and total in the wrong direction: it cleared the
 * token and left every follow, list, muted word and subscribed hashtag sitting in
 * `localStorage` for whoever used the machine next. Someone reading Mastodon on an
 * office desktop clicked "Log out", believed that was the end of it, and was wrong.
 * So the exit asks, and offers to clean up.
 *
 * Three outs, and the ordering is the argument:
 *
 *  1. **Leave, keep everything** — the default and the safe one.
 *  2. **Delete anonymous data** — emphasised, because it is what most people asking
 *     for this actually want: the read-only session gone, saved accounts untouched.
 *  3. **Remove everything** — accounts and tokens included.
 *
 * Both destructive paths offer an export *first*. The person who most wants a clean
 * machine is also the person who most wants their follow list to survive the trip,
 * and making them choose between the two would push them toward keeping the data.
 */
@Component({
  selector: 'app-leave-dialog',
  templateUrl: './leave-dialog.html',
  styleUrl: './leave-dialog.css',
})
export class LeaveDialog {
  private auth = inject(Auth);
  private teardown = inject(SessionTeardown);

  readonly closed = output<void>();
  /** Emitted once the teardown has run; the shell owns the navigation and reload. */
  readonly chose = output<LeaveChoice>();

  /** Overridden in tests; real callers let it read `Auth`. */
  readonly anonymous = input<boolean | null>(null);

  protected exported = signal(false);
  protected exportError = signal<string | null>(null);

  protected isAnonymous = computed(() => this.anonymous() ?? this.auth.isAnonymous);

  protected who = computed(() => {
    if (this.isAnonymous()) {
      return 'Anonymous';
    }
    const account = this.auth.account();
    return account?.username ? `@${account.username}` : 'this account';
  });

  /**
   * Download a backup of everything the wipe is about to destroy.
   *
   * Uses `SessionTeardown.backup`, **not** `exportPortableConfig`: the latter builds
   * a shareable *setup* (theme, server, proxy) and contains none of the eight
   * anonymous keys, so it would have promised a rescue while saving nothing the user
   * was worried about losing. See the comment on `backup()`.
   *
   * Scope `'all'` regardless of which button they eventually press: this is offered
   * before the choice is made, and a backup wider than the deletion costs nothing
   * while a narrower one loses data. Credentials are excluded either way.
   */
  protected downloadBackup(): void {
    try {
      const config = this.teardown.backup('all');
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mawkingbird-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.exported.set(true);
      this.exportError.set(null);
    } catch {
      // Never block the exit on a failed backup: the user asked to leave.
      this.exportError.set("Couldn't build a backup file. You can still leave.");
    }
  }

  protected leave(): void {
    this.chose.emit('leave');
  }

  protected deleteAnonymous(): void {
    this.teardown.clearAnonymousData();
    this.chose.emit('anonymous-data');
  }

  protected deleteEverything(): void {
    this.teardown.clearAllData();
    this.chose.emit('all-data');
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }
}
