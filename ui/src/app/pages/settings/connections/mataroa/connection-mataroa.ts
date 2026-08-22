import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MataroaApi } from '../../../../providers/mataroa/mataroa-api';
import { MataroaSettings } from '../../../../providers/mataroa/mataroa-settings';
import { CorsProxy } from '../../../../providers/cors-proxy/cors-proxy';
import { ProxyConsent } from '../../../../providers/proxy-consent-store';
import { expiryLabel } from '../expiry-label';
import { credentialLocation, StorageBadge } from '../storage-badge';
import { VaultBridge } from '../../../../providers/vault/vault-bridge';

/** The registry base this page's credential is stored under. */
const MATAROA_KEY = 'mockingbird_mataroa_connection';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';
import { PageDiagnostics } from '../../../../page-diagnostics';

/** Settings → Connections → Blog (Mataroa). */
@Component({
  selector: 'app-connection-mataroa',
  imports: [FormsModule, RouterLink, StorageBadge],
  templateUrl: './connection-mataroa.html',
  styleUrls: ['../connection-page.css', './connection-mataroa.css'],
})
export class ConnectionMataroa implements OnInit {
  protected readonly settings = inject(MataroaSettings);
  private readonly bridge = inject(VaultBridge);
  private readonly api = inject(MataroaApi);
  private readonly proxy = inject(CorsProxy);
  private readonly consent = inject(ProxyConsent);
  private readonly diagnostics = inject(PageDiagnostics);

  protected readonly apiKey = signal('');
  protected readonly blogUrl = signal('');
  protected readonly includeInProfile = signal(false);
  protected readonly understandsProxy = signal(false);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly proxyEntry = computed(() => this.proxy.entry());
  protected readonly proxyReady = computed(
    () => this.proxy.available() && this.proxyEntry()?.forwardsCustomHeaders === true,
  );
  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.account.detail;
  protected readonly expiryLabel = expiryLabel;

  /**
   * Where this credential lives, for the badge.
   *
   * Reads the connector's own facts rather than the vault's state: a locked
   * vault is not a locked credential. See `storage-badge.ts`.
   */
  protected where() {
    return credentialLocation(this.bridge.syncs(MATAROA_KEY), this.settings.needsFetch());
  }

  ngOnInit(): void {
    this.settings.enforceLifetime();
    this.blogUrl.set(this.settings.blogUrl() ?? '');
    this.includeInProfile.set(this.settings.includeInProfile());
  }

  connect(): void {
    const proxy = this.proxyEntry();
    if (!proxy || !this.proxyReady()) {
      this.error.set('Choose a CORS proxy that forwards custom headers first.');
      return;
    }
    if (!this.understandsProxy()) {
      this.error.set('Confirm that you understand what the proxy can see.');
      return;
    }
    this.error.set(null);
    this.notice.set(null);
    try {
      this.settings.connect(this.apiKey(), this.blogUrl(), this.includeInProfile());
    } catch (error: unknown) {
      this.diagnostics.error('Mataroa', 'save-connection:error', error);
      this.error.set(error instanceof Error ? error.message : "Couldn't save this connection.");
      return;
    }

    this.consent.grant('mataroa', proxy.id);
    this.busy.set(true);
    this.api.listPosts().subscribe({
      next: () => {
        this.busy.set(false);
        this.apiKey.set('');
        this.notice.set('Mataroa connected. Blog is now available in the composer.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.settings.disconnect();
        this.consent.revoke('mataroa', proxy.id);
        this.error.set(
          error instanceof Error
            ? `Mataroa rejected the connection: ${error.message}`
            : "Mataroa couldn't be reached through this proxy.",
        );
      },
    });
  }

  setProfileFeed(include: boolean): void {
    this.includeInProfile.set(include);
    this.settings.setIncludeInProfile(include);
  }

  disconnect(): void {
    this.settings.disconnect();
    this.consent.revokeAll('mataroa');
    this.notice.set(null);
    this.error.set(null);
    this.understandsProxy.set(false);
  }
}
