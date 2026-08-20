import { Component, inject, OnInit, signal } from '@angular/core';
import { VaultBridge } from '../../../../providers/vault/vault-bridge';
import { credentialLocation, StorageBadge } from '../storage-badge';

/** The registry base this page's credential is stored under. */
const RAINDROP_KEY = 'mockingbird_raindrop_token';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RaindropSession } from '../../../../providers/raindrop/raindrop-session';
import { expiryLabel } from '../expiry-label';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';

/** Settings → Connections → Raindrop.io. Test-token paste; no OAuth (see the copy). */
@Component({
  selector: 'app-connection-raindrop',
  imports: [FormsModule, RouterLink, StorageBadge],
  templateUrl: './connection-raindrop.html',
  styleUrls: ['../connection-page.css', './connection-raindrop.css'],
})
export class ConnectionRaindrop implements OnInit {
  protected raindrop = inject(RaindropSession);
  private bridge = inject(VaultBridge);

  protected raindropToken = signal('');
  protected raindropError = signal<string | null>(null);
  protected raindropNotice = signal<string | null>(null);

  protected readonly expiryLabel = expiryLabel;

  /** The storage-scope sentence shown under the heading. */
  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.account.detail;

  ngOnInit(): void {
    // Deep-link case: re-check against a policy shortened on the catalog page.
    this.raindrop.enforceLifetime();
  }

  connectRaindrop(): void {
    this.raindropError.set(null);
    this.raindropNotice.set(null);
    try {
      this.raindrop.connect(this.raindropToken());
      this.raindropToken.set('');
      this.raindropNotice.set('Raindrop.io connected. Bookmark buttons now offer both providers.');
    } catch (error: unknown) {
      this.raindropError.set(
        error instanceof Error ? error.message : "Couldn't connect Raindrop.io.",
      );
    }
  }

  disconnectRaindrop(): void {
    this.raindrop.disconnect();
    this.raindropNotice.set(null);
  }

  /**
   * Where this credential lives, for the badge.
   *
   * Reads the connector's own facts rather than the vault's state: a locked
   * vault is not a locked credential. See `storage-badge.ts`.
   */
  protected where() {
    return credentialLocation(this.bridge.syncs(RAINDROP_KEY), this.raindrop.needsFetch());
  }
}
