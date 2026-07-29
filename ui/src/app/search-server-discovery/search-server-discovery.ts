import { Component, inject, input, OnDestroy, output, signal } from '@angular/core';
import { MastodonServers, ServerSuggestion } from '../mastodon-servers';
import {
  isUsableSearchServer,
  probeSearchServer,
  SearchServerStatus,
} from '../search-server-probe';
import { rejectReason, SearchServerRejects } from '../search-server-rejects';

type DiscoveryState = 'idle' | 'searching' | 'found' | 'exhausted';

export interface DiscoveredSearchServer extends ServerSuggestion {
  /** Accounts the canary matched — evidence the index is live, not just reachable. */
  accounts: number;
  /** Posts the full-text canary matched. Non-zero is the bar for adoption. */
  statuses: number;
}

/** One host we walked past, kept so the hunt shows its work. */
interface Attempt {
  domain: string;
  reason: string;
}

/** How many rejections to keep on screen. Enough to look alive, not a wall of text. */
const VISIBLE_ATTEMPTS = 6;

/**
 * Finds an instance that will actually answer anonymous search.
 *
 * A sibling of `server-discovery/`, and close to it on purpose — that component is
 * already mounted in two places (`login.html`, `settings-server.html`) and the
 * random-walk-with-three-workers shape is proven. Three things differ:
 *
 *  - The bar is {@link isUsableSearchServer}, not reachability. Accounts *and* posts
 *    must come back. Hashtag search is not evidence: every server answers it,
 *    including the ones with no index at all.
 *  - Failures are recorded in {@link SearchServerRejects}, so the next hunt starts
 *    where this one left off instead of re-probing the same ~1000 duds.
 *  - It narrates. A sweep through fifty servers that says only "searching…" looks
 *    broken; `mastodon.example — search needs a login` scrolling past is the
 *    feature working.
 */
@Component({
  selector: 'app-search-server-discovery',
  imports: [],
  templateUrl: './search-server-discovery.html',
  styleUrl: './search-server-discovery.css',
})
export class SearchServerDiscovery implements OnDestroy {
  private readonly directory = inject(MastodonServers);
  private readonly rejects = inject(SearchServerRejects);

  /** Excluded from the hunt — usually the server already in use for search. */
  readonly currentServer = input('');
  readonly startLabel = input('Find a search server');
  readonly selected = output<string>();

  protected readonly state = signal<DiscoveryState>('idle');
  protected readonly candidate = signal<DiscoveredSearchServer | null>(null);
  protected readonly tried = signal(0);
  protected readonly attempts = signal<Attempt[]>([]);
  protected readonly directorySource = this.directory.source;
  protected readonly rejectCount = this.rejects.count;

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
      this.attempts.set([]);
    }
    this.candidate.set(null);
    this.state.set('searching');
    const sequence = ++this.searchSequence;
    this.searchAbort = new AbortController();

    await this.directory.ready();
    if (sequence !== this.searchSequence) {
      return;
    }

    // Three exclusion sources: this session's attempts, the persistent reject
    // list, and whatever is already in use.
    const excluded = new Set([...this.attempted, ...this.rejects.domains()]);
    const currentDomain = this.currentServer()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .toLowerCase();
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

  /** Forget every rejected server, so the next hunt re-probes from scratch. */
  protected forgetRejects(): void {
    this.rejects.clear();
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
      const domain = server.domain.toLowerCase();
      this.attempted.add(domain);
      this.tried.update((count) => count + 1);

      const probe = await probeSearchServer(
        `https://${server.domain}`,
        this.searchAbort?.signal,
        6000,
      );

      if (isUsableSearchServer(probe)) {
        if (sequence !== this.searchSequence || this.state() !== 'searching') {
          return;
        }
        this.candidate.set({
          ...server,
          accounts: probe.accounts,
          statuses: probe.statuses ?? 0,
        });
        this.state.set('found');
        this.searchAbort?.abort();
        return;
      }

      // An aborted probe is not a verdict — a cancelled hunt must not poison the
      // reject list with hosts we never really asked.
      if (this.searchAbort?.signal.aborted) {
        return;
      }
      this.recordRejection(domain, probe.status);
    }
  }

  private recordRejection(domain: string, status: SearchServerStatus): void {
    this.rejects.add(domain, status);
    const reason = rejectReason(status);
    this.attempts.update((list) => [{ domain, reason }, ...list].slice(0, VISIBLE_ATTEMPTS));
  }
}
