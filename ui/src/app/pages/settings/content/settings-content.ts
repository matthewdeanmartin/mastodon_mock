import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TrustedAccounts } from '../../../trusted-accounts';

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

  protected toggleCw(): void {
    this.trusted.setExpandAllCw(!this.trusted.expandAllCw());
  }

  protected toggleSensitive(): void {
    this.trusted.setShowAllSensitive(!this.trusted.showAllSensitive());
  }

  protected untrust(key: string): void {
    this.trusted.untrust(key);
  }

  protected clearAll(): void {
    this.trusted.clearAll();
  }
}
