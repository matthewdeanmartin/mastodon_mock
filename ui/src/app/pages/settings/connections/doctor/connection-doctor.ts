import { Injectable, signal } from '@angular/core';
import { ProbeTarget, ProbeVerdict } from './connection-doctor-catalog';

/**
 * Runs the reachability probes.
 *
 * Deliberately a plain `fetch` rather than the app's `HttpClient`: the doctor
 * must work with no credentials, no interceptors and no proxy, precisely
 * because it is answering "would setting this up be a waste of my time?" before
 * any of those exist. It also needs `mode: 'no-cors'`, which `HttpClient`
 * cannot express.
 *
 * Probes run in parallel. Fifteen hosts at six seconds each would be a
 * minute and a half serially, and the browser's own connection limits already
 * throttle this to something reasonable.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionDoctor {
  /** Verdict per target id. Absent means never run. */
  readonly verdicts = signal<Readonly<Record<string, ProbeVerdict>>>({});
  readonly running = signal(false);
  /** When the last sweep finished, so the page can say how stale it is. */
  readonly lastRunAt = signal<number | null>(null);

  async runAll(targets: readonly ProbeTarget[], timeoutMs = 8000): Promise<void> {
    if (this.running()) {
      return;
    }
    this.running.set(true);
    // Reset to 'checking' in one write so every row turns over together rather
    // than trickling, which reads as the page being broken.
    this.verdicts.set(Object.fromEntries(targets.map((t) => [t.id, 'checking' as ProbeVerdict])));

    await Promise.all(
      targets.map(async (target) => {
        const verdict = await this.probe(target, timeoutMs);
        this.verdicts.update((current) => ({ ...current, [target.id]: verdict }));
      }),
    );

    this.lastRunAt.set(Date.now());
    this.running.set(false);
  }

  /**
   * One host.
   *
   * `no-cors` means the response is opaque: no status, no headers, no body. That
   * is not a limitation to work around — it is the entire mechanism. An opaque
   * response can only exist if the request reached the host and came back, so
   * its mere existence is the answer. `credentials: 'omit'` keeps cookies out
   * of a diagnostic request, and `cache: 'no-store'` stops a second run from
   * cheerfully reporting a cached success while the network is down.
   */
  private async probe(target: ProbeTarget, timeoutMs: number): Promise<ProbeVerdict> {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      await fetch(target.probeUrl, {
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: timeout,
      });
      return 'reachable';
    } catch {
      // Distinguishing the two is the only inference this class makes, and it
      // is a safe one: the abort came from our own timer, not from the network.
      return timeout.aborted ? 'timeout' : 'failed';
    }
  }
}
