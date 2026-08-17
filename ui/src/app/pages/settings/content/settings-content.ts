import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../../api';
import { Auth } from '../../../auth';
import { Server } from '../../../server';
import { TrustLevel, TrustedAccounts } from '../../../trusted-accounts';

/**
 * Content warnings and sensitive media: the two account-wide switches, plus the
 * list of people they are already off for.
 *
 * The flipside of "Muted & Blocked", and deliberately its neighbour in the nav:
 * one page is the accounts you want less of, this is the accounts you want
 * without friction.
 *
 * Everything here is client-side and scoped to the signed-in Mastodon account
 * (see {@link TrustedAccounts}) — Mastodon has no server-side notion of a
 * trusted reader, and these need to work anonymously too.
 */
@Component({
  selector: 'app-settings-content',
  imports: [RouterLink],
  templateUrl: './settings-content.html',
  styleUrl: './settings-content.css',
})
export class SettingsContent {
  protected trusted = inject(TrustedAccounts);
  private api = inject(Api);
  private auth = inject(Auth);
  private server = inject(Server);

  /**
   * Your server's own "always expand content warnings" setting.
   *
   * Read-only, and not for want of trying: Mastodon exposes
   * `reading:expand:spoilers` through `GET /api/v1/preferences`, but has no API
   * to write it — it is settable only from the instance's own web Preferences
   * page, behind a session cookie. So this row reports the value and links out,
   * rather than pretending to a switch that could not save.
   *
   * `null` while loading, unknown, or not applicable (anonymous / Bluesky).
   */
  protected serverExpandsCw = signal<boolean | null>(null);

  /** Deep link to the page that *can* change it, on the viewer's own instance. */
  protected serverPrefsUrl = computed(() => {
    const base = this.server.baseUrl();
    if (!base) {
      return null;
    }
    try {
      return `${new URL(base).origin}/settings/preferences/other`;
    } catch {
      return null;
    }
  });

  protected showsServerRow = computed(() => !this.auth.isAnonymous && !this.auth.isBlueskyPrimary);

  constructor() {
    if (this.showsServerRow()) {
      this.api.preferences().subscribe({
        next: (prefs) => this.serverExpandsCw.set(prefs['reading:expand:spoilers'] === true),
        // An instance that does not serve preferences just leaves the row out,
        // which is better than an error for something purely informational.
        error: () => this.serverExpandsCw.set(null),
      });
    }
  }

  protected setLevel(level: TrustLevel): void {
    this.trusted.setLevel(level);
  }

  protected toggleCw(): void {
    this.trusted.setExpandAllCw(!this.trusted.expandAllCwSetting());
  }

  protected toggleSensitive(): void {
    this.trusted.setShowAllSensitive(!this.trusted.showAllSensitiveSetting());
  }

  protected untrust(key: string): void {
    this.trusted.untrust(key);
  }

  protected clearAll(): void {
    this.trusted.clearAll();
  }

  /**
   * Global revocation. Confirmed first: unlike every other control here it
   * throws the named list away, and there is no undo.
   */
  protected revokeAll(): void {
    const count = this.trusted.count();
    const detail = count
      ? `This turns off every trust setting and forgets all ${count} trusted account${count === 1 ? '' : 's'}.`
      : 'This turns off every trust setting.';
    if (confirm(`${detail}\n\nThere is no undo. Continue?`)) {
      this.trusted.revokeAll();
    }
  }
}
