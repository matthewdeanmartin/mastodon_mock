import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { deleteAccountData, formatBytes, inspectAccountData } from '../../../account-data';
import { Auth } from '../../../auth';
import { ConfirmDialog } from '../../../confirm-dialog/confirm-dialog';
import { Account } from '../../../models';
import { AnonymousAccount } from '../../../providers/anonymous/anonymous-account';

/** One credential stored in this browser, with the size of the data it owns. */
interface StoredAccount {
  /** Stable row key; also the token for Mastodon rows. */
  key: string;
  /** null for the browser-local Anonymous account. */
  token: string | null;
  kind: 'mastodon' | 'anonymous';
  account: Account | null;
  /** Base URL this credential belongs to ('' = this server). */
  server: string;
  /** True when this is the account currently signed in. */
  active: boolean;
  keyCount: number;
  bytes: number;
}

/** What the open confirmation dialog would do. */
type PendingAction =
  | { kind: 'data'; target: StoredAccount }
  | { kind: 'data-and-logout'; target: StoredAccount };

/**
 * Signed-in accounts: list every credential saved in this browser and clean them up.
 *
 * This is the account-level counterpart to the Local storage page. That page is a
 * key-by-key inspector for whoever is signed in right now; this one works on whole
 * accounts — including ones you are *not* currently using — which is what you need
 * when you're logged in twice to the same server, or want to reset one account's
 * local data without signing out of it.
 *
 * The active account is deliberately restricted: wiping the data out from under the
 * running session leaves the app in a half-torn-down state. The one exception is
 * when it's the only account left, since there is then somewhere coherent to land
 * (the logged-out main screen), so that case is allowed and navigates away.
 */
@Component({
  selector: 'app-settings-accounts',
  imports: [ConfirmDialog],
  templateUrl: './settings-accounts.html',
  styleUrl: './settings-accounts.css',
})
export class SettingsAccounts {
  private auth = inject(Auth);
  private anonymous = inject(AnonymousAccount);
  private router = inject(Router);

  protected readonly formatBytes = formatBytes;

  /** Bumped after every mutation to re-read localStorage sizes. */
  private revision = signal(0);

  protected accounts = computed<StoredAccount[]>(() => {
    this.revision();
    const mode = this.auth.mode();
    const activeToken = this.auth.token();
    const rows: StoredAccount[] = this.auth.sessions().map((session) => ({
      key: `mastodon:${session.id}`,
      token: session.token,
      kind: 'mastodon' as const,
      account: session.account,
      server: session.server ?? '',
      active: mode === 'mastodon' && session.token === activeToken,
      ...this.sizeOf(session.token),
    }));
    // Anonymous is a permanent local identity, so it is always a row — it owns
    // browser data (follows, posts) whether or not it is the active account.
    rows.push({
      key: 'anonymous',
      token: null,
      kind: 'anonymous',
      account: this.anonymous.account(),
      server: this.anonymous.server(),
      active: mode === 'anonymous',
      ...this.sizeOf(null),
    });
    return rows;
  });

  /**
   * True when there is no *other* account to fall back to. Anonymous is always
   * present as a row but is not a saved login, so "last" means: no saved
   * Mastodon sessions other than the active one. In that state, acting on the
   * active account is allowed precisely because signing out is a valid landing
   * place (the main screen).
   */
  protected isLastAccount = computed(() => {
    const others = this.accounts().filter((row) => !row.active && row.kind === 'mastodon');
    return others.length === 0;
  });

  protected pending = signal<PendingAction | null>(null);
  protected notice = signal('');

  private sizeOf(token: string | null): { keyCount: number; bytes: number } {
    const report = inspectAccountData(token);
    return { keyCount: report.entries.length, bytes: report.totalBytes };
  }

  protected label(row: StoredAccount): string {
    if (row.kind === 'anonymous') {
      return 'Anonymous (local)';
    }
    const account = row.account;
    return account ? account.display_name || account.username : 'Unverified account';
  }

  protected handle(row: StoredAccount): string {
    const acct = row.account?.acct;
    const host = row.server.replace(/^https?:\/\//, '') || 'this server';
    return acct ? `@${acct}` : host;
  }

  /**
   * Whether this row's destructive actions are available. The active account is
   * blocked unless it is the last one, because there would otherwise be no
   * coherent state to return to.
   */
  protected canModify(row: StoredAccount): boolean {
    return !row.active || this.isLastAccount();
  }

  protected blockedReason(row: StoredAccount): string {
    return row.active && !this.canModify(row)
      ? 'Switch to another account first, or remove the others.'
      : '';
  }

  askDeleteData(row: StoredAccount): void {
    this.pending.set({ kind: 'data', target: row });
  }

  askDeleteDataAndLogout(row: StoredAccount): void {
    this.pending.set({ kind: 'data-and-logout', target: row });
  }

  protected dialogTitle = computed(() => {
    const action = this.pending();
    if (!action) {
      return '';
    }
    return action.kind === 'data' ? 'Delete this account’s data?' : 'Delete data and sign out?';
  });

  protected dialogMessage = computed(() => {
    const action = this.pending();
    if (!action) {
      return '';
    }
    const row = action.target;
    const what = `${row.keyCount} ${row.keyCount === 1 ? 'key' : 'keys'} (${formatBytes(row.bytes)})`;
    const scope = `${this.label(row)} ${this.handle(row)}`;
    if (action.kind === 'data') {
      return `This permanently deletes ${what} of browser data belonging to ${scope}. The saved login is kept, so you stay signed in. This can't be undone.`;
    }
    return `This permanently deletes ${what} of browser data belonging to ${scope} and removes the saved login. This can't be undone.`;
  });

  cancel(): void {
    this.pending.set(null);
  }

  confirm(): void {
    const action = this.pending();
    this.pending.set(null);
    if (!action || !this.canModify(action.target)) {
      return;
    }
    const row = action.target;
    const removed = deleteAccountData(row.token);
    const logout = action.kind === 'data-and-logout';

    if (logout) {
      if (row.kind === 'anonymous') {
        // Anonymous can't be removed from the stable (it's permanent), so the
        // equivalent of "log out" is to leave it for the logged-out screen.
        this.auth.exitAnonymous();
      } else if (row.token) {
        this.auth.removeSession(row.token);
      }
    }

    // Wiping the *active* account's data mid-session leaves the app holding
    // state that no longer exists, so land the user somewhere coherent instead.
    if (row.active) {
      if (logout || this.isLastAccount()) {
        this.auth.logout();
      }
      void this.router.navigateByUrl('/').then(() => location.reload());
      return;
    }

    this.revision.update((n) => n + 1);
    this.notice.set(
      removed
        ? `Deleted ${removed} ${removed === 1 ? 'key' : 'keys'} for ${this.label(row)}.`
        : `${this.label(row)} had no local data to delete.`,
    );
    setTimeout(() => this.notice.set(''), 4000);
  }
}
