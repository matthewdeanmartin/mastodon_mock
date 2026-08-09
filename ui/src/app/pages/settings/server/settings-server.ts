import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../../auth';
import { MastodonServers } from '../../../mastodon-servers';
import { AnonymousAccount } from '../../../providers/anonymous/anonymous-account';
import { AnonymousPreferences } from '../../../providers/anonymous/anonymous-preferences';
import { ServerDiscovery } from '../../../server-discovery/server-discovery';
import { ServerPicker } from '../../../server-picker/server-picker';
import { probeServerAvailability } from '../../../server-availability';
import { SearchServerDiscovery } from '../../../search-server-discovery/search-server-discovery';
import { SearchServer } from '../../../search-server';
import { FeedCapability } from '../../../feed-capability';
import { SearchCapability } from '../../../search-capability';
import { SearchServerRejects, rejectReason } from '../../../search-server-rejects';

type ConnectionStatus = 'checking' | 'available' | 'degraded' | 'unreachable';

/** Anonymous-only control for the public Mastodon instance used by read-only API calls. */
@Component({
  selector: 'app-settings-server',
  imports: [FormsModule, ServerDiscovery, ServerPicker, SearchServerDiscovery],
  templateUrl: './settings-server.html',
  styleUrl: './settings-server.css',
})
export class SettingsServer implements OnInit {
  private readonly auth = inject(Auth);
  private readonly anonymous = inject(AnonymousAccount);
  protected readonly anonymousPreferences = inject(AnonymousPreferences);
  private readonly directory = inject(MastodonServers);
  private readonly searchCapability = inject(SearchCapability);
  private readonly feedCaps = inject(FeedCapability);
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
  protected readonly ageOptions = [
    { days: 30, label: '30 days' },
    { days: 90, label: '3 months' },
    { days: 180, label: '6 months' },
    { days: 365, label: '1 year' },
    { days: 730, label: '2 years' },
    { days: 1825, label: '5 years' },
  ];

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
    // Which feeds this server serves is cached for a day, so "check connection"
    // is also the button that re-asks: someone whose admin just turned the
    // local timeline back on has one obvious place to go, and it is this one.
    this.feedCaps.reset();
    this.feedCaps.ensureAll();
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

  protected setMaximumAge(days: string | number): void {
    this.anonymousPreferences.setFollowedPostMaxAgeDays(Number(days));
  }
}
