import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Auth } from '../../../auth';
import { MastodonServers } from '../../../mastodon-servers';
import { AnonymousAccount } from '../../../providers/anonymous/anonymous-account';
import { ServerDiscovery } from '../../../server-discovery/server-discovery';
import { ServerPicker } from '../../../server-picker/server-picker';
import { probeServerAvailability } from '../../../server-availability';
import { SearchServerDiscovery } from '../../../search-server-discovery/search-server-discovery';
import { SearchServer } from '../../../search-server';
import { SearchCapability } from '../../../search-capability';
import { SearchServerRejects, rejectReason } from '../../../search-server-rejects';

type ConnectionStatus = 'checking' | 'available' | 'degraded' | 'unreachable';

/** Anonymous-only control for the public Mastodon instance used by read-only API calls. */
@Component({
  selector: 'app-settings-server',
  imports: [ServerDiscovery, ServerPicker, SearchServerDiscovery],
  templateUrl: './settings-server.html',
  styleUrl: './settings-server.css',
})
export class SettingsServer implements OnInit {
  private readonly auth = inject(Auth);
  private readonly anonymous = inject(AnonymousAccount);
  private readonly directory = inject(MastodonServers);
  private readonly searchCapability = inject(SearchCapability);
  protected readonly searchServer = inject(SearchServer);
  protected readonly rejects = inject(SearchServerRejects);
  protected readonly rejectReason = rejectReason;

  protected readonly currentUrl = this.anonymous.server;
  protected readonly currentHost = computed(() => this.currentUrl().replace(/^https?:\/\//, ''));
  protected readonly suggestion = computed(() =>
    this.directory.servers().find((item) => item.domain === this.currentHost()),
  );
  protected readonly connectionStatus = signal<ConnectionStatus>('checking');
  protected readonly changed = signal(false);

  ngOnInit(): void {
    void this.directory.ensureLoaded();
    void this.checkCurrent();
  }

  protected useServer(url: string): void {
    this.auth.enterAnonymous(url);
    this.changed.set(true);
    void this.checkCurrent();
  }

  protected async checkCurrent(): Promise<void> {
    this.connectionStatus.set('checking');
    try {
      const result = await probeServerAvailability(this.currentUrl());
      this.connectionStatus.set(result.status);
    } catch {
      this.connectionStatus.set('unreachable');
    }
  }

  // --- search server ---
  // Search can be pointed at a different instance than everything else, because
  // plenty of servers turn off anonymous search. Only the search call moves.

  /** Adopt a search server found by the discovery walk. */
  protected useSearchServer(url: string): void {
    this.searchServer.setBaseUrl(url);
    // Per-host verdicts don't describe the new host. Drop them.
    this.searchCapability.reset();
  }

  protected clearSearchServer(): void {
    this.searchServer.clear();
    this.searchCapability.reset();
  }

  protected forgetRejects(): void {
    this.rejects.clear();
  }
}
