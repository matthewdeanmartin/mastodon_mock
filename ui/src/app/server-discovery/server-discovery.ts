import { Component, inject, input, OnDestroy, output, signal } from '@angular/core';
import { MastodonServers, ServerSuggestion } from '../mastodon-servers';
import { probeServerAvailability } from '../server-availability';

type DiscoveryState = 'idle' | 'searching' | 'found' | 'exhausted';

export interface DiscoveredServer extends ServerSuggestion {
  title: string;
  degraded: boolean;
  mediaHost: string | null;
}

/** Finds a CORS-accessible Mastodon instance without depending on the live directory. */
@Component({
  selector: 'app-server-discovery',
  imports: [],
  templateUrl: './server-discovery.html',
  styleUrl: './server-discovery.css',
})
export class ServerDiscovery implements OnDestroy {
  private readonly directory = inject(MastodonServers);

  readonly currentServer = input('');
  readonly startLabel = input('Find another server');
  readonly selected = output<string>();

  protected readonly state = signal<DiscoveryState>('idle');
  protected readonly candidate = signal<DiscoveredServer | null>(null);
  protected readonly tried = signal(0);
  protected readonly acceptDegraded = signal(false);
  protected readonly directorySource = this.directory.source;

  private readonly attempted = new Set<string>();
  private searchAbort: AbortController | null = null;
  private searchSequence = 0;

  ngOnDestroy(): void {
    this.cancel(false);
  }

  protected async startSearch(reset = true): Promise<void> {
    this.cancel(false);
    if (reset) {
      this.attempted.clear();
      this.tried.set(0);
    }
    this.candidate.set(null);
    this.state.set('searching');
    const sequence = ++this.searchSequence;
    this.searchAbort = new AbortController();

    await this.directory.ready();
    if (sequence !== this.searchSequence) {
      return;
    }

    const currentDomain = this.currentServer()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .toLowerCase();
    const excluded = new Set(this.attempted);
    if (currentDomain) {
      excluded.add(currentDomain);
    }
    const queue = this.directory.shuffled(excluded);
    if (!queue.length) {
      this.state.set('exhausted');
      return;
    }

    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, () => this.runWorker(queue, sequence)),
    );
    if (sequence === this.searchSequence && this.state() === 'searching') {
      this.state.set('exhausted');
    }
  }

  protected cancel(showIdle = true): void {
    this.searchSequence += 1;
    this.searchAbort?.abort();
    this.searchAbort = null;
    if (showIdle) {
      this.state.set('idle');
      this.candidate.set(null);
    }
  }

  protected useCandidate(): void {
    const candidate = this.candidate();
    if (candidate) {
      this.selected.emit(`https://${candidate.domain}`);
    }
  }

  protected sizeLabel(users: number): string {
    if (users >= 100_000) return 'very large';
    if (users >= 10_000) return 'large';
    if (users >= 1_000) return 'mid-size';
    if (users > 0) return 'cozy';
    return '';
  }

  private async runWorker(queue: ServerSuggestion[], sequence: number): Promise<void> {
    while (sequence === this.searchSequence && this.state() === 'searching') {
      const server = queue.shift();
      if (!server) {
        return;
      }
      this.attempted.add(server.domain.toLowerCase());
      this.tried.update((count) => count + 1);
      const result = await probeServerAvailability(
        `https://${server.domain}`,
        this.searchAbort?.signal,
        4000,
      );
      const usable =
        result.status === 'available' || (result.status === 'degraded' && this.acceptDegraded());
      if (usable && sequence === this.searchSequence && this.state() === 'searching') {
        this.candidate.set({
          ...server,
          title: result.title,
          degraded: result.status === 'degraded',
          mediaHost: result.mediaUrl ? new URL(result.mediaUrl).host : null,
        });
        this.state.set('found');
        this.searchAbort?.abort();
        return;
      }
    }
  }
}
