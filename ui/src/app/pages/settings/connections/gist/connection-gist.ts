import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GistProvider } from '../../../../providers/paste/gist-provider';
import { GistSettings } from '../../../../providers/paste/gist-settings';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';
import { expiryLabel } from '../expiry-label';
import { credentialLocation, StorageBadge } from '../storage-badge';
import { VaultBridge } from '../../../../providers/vault/vault-bridge';
import { PageDiagnostics } from '../../../../page-diagnostics';

/** The registry base this page's credential is stored under. */
const GIST_KEY = 'mockingbird_gist_credentials';

/**
 * Settings → Connections → GitHub Gist.
 *
 * No CORS proxy here, unlike Mataroa: `api.github.com` sends
 * `Access-Control-Allow-Origin` on authenticated writes, so the browser can
 * talk to it directly. That is a verified property of the API, not an
 * assumption — the Hugo connector depends on the same thing.
 */
@Component({
  selector: 'app-connection-gist',
  imports: [FormsModule, RouterLink, StorageBadge],
  templateUrl: './connection-gist.html',
  styleUrls: ['../connection-page.css'],
})
export class ConnectionGist implements OnInit {
  protected readonly settings = inject(GistSettings);
  private readonly bridge = inject(VaultBridge);
  private readonly provider = inject(GistProvider);
  private readonly diagnostics = inject(PageDiagnostics);

  protected readonly token = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.account.detail;
  protected readonly expiryLabel = expiryLabel;

  /**
   * Where this credential lives, for the badge.
   *
   * Reads the connector's own facts rather than the vault's state: a locked
   * vault is not a locked credential. See `storage-badge.ts`.
   */
  protected where() {
    return credentialLocation(this.bridge.syncs(GIST_KEY), this.settings.needsFetch());
  }

  ngOnInit(): void {
    this.settings.enforceLifetime();
  }

  /**
   * Prove the token works, *then* store it.
   *
   * In that order deliberately: a token that turns out to be bad should never
   * have been written to storage at all. `/user` is the cheapest call that
   * proves the token is live, and it returns the login the provider names
   * itself with — so one request does both jobs.
   */
  connect(): void {
    const token = this.token().trim();
    this.error.set(null);
    this.notice.set(null);
    if (!token) {
      this.error.set('Paste a GitHub personal access token with the gist scope.');
      return;
    }

    this.busy.set(true);
    this.provider.whoami(token).subscribe({
      next: (user) => {
        this.busy.set(false);
        try {
          this.settings.connect(token, { login: user.login });
        } catch (error: unknown) {
          this.diagnostics.error('Gist', 'save-token:error', error);
          this.error.set(error instanceof Error ? error.message : "Couldn't save this token.");
          return;
        }
        this.token.set('');
        this.notice.set(
          `Connected as @${user.login}. Gist is now an option wherever you post a paste.`,
        );
      },
      error: () => {
        this.busy.set(false);
        // Nothing was stored, so there is nothing to undo.
        this.error.set(
          'GitHub rejected that token. Check it is active and has the gist scope — nothing else.',
        );
      },
    });
  }

  disconnect(): void {
    this.settings.disconnect();
    this.token.set('');
    this.notice.set('Disconnected. Gists you already created are untouched on GitHub.');
    this.error.set(null);
  }
}
