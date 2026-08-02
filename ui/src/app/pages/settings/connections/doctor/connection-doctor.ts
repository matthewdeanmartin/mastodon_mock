import { Injectable, signal } from '@angular/core';
import { CorsReadable, ProbeResult, ProbeTarget } from './connection-doctor-catalog';

/**
 * Runs the reachability probes.
 *
 * Deliberately a plain `fetch` rather than the app's `HttpClient`: the doctor
 * must work with no credentials, no interceptors and no proxy, precisely
 * because it is answering "would setting this up be a waste of my time?" before
 * any of those exist. It also needs `mode: 'no-cors'`, which `HttpClient`
 * cannot express.
 *
 * ## Two probes per host, and why
 *
 * Each host is asked two different questions, because they have different
 * answers and conflating them is what sends people to bad advice:
 *
 * 1. **`no-cors` — did the bytes arrive?** The response is opaque, so its mere
 *    existence is the answer. This is *reachability*, and nothing a browser
 *    extension does can change it.
 * 2. **`cors` — may this app read them?** Only meaningful if (1) succeeded. A
 *    failure here is the host declining to send `Access-Control-Allow-Origin`,
 *    which is a policy decision by that host, not a network fault.
 *
 * The pair is what makes the page able to say "your network is fine, that
 * service simply does not answer browsers" without asking the user anything —
 * and to correctly refuse to blame CORS when the host was never reached.
 *
 * Probes run in parallel. Fifteen hosts at eight seconds each would be two
 * minutes serially, and the browser's own connection limits already throttle
 * this to something reasonable.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionDoctor {
  /** Result per target id. Absent means never run. */
  readonly results = signal<Readonly<Record<string, ProbeResult>>>({});
  readonly running = signal(false);
  /** When the last sweep finished, so the page can say how stale it is. */
  readonly lastRunAt = signal<number | null>(null);

  async runAll(targets: readonly ProbeTarget[], timeoutMs = 8000): Promise<void> {
    if (this.running()) {
      return;
    }
    this.running.set(true);
    // Reset in one write so every row turns over together rather than
    // trickling, which reads as the page being broken.
    this.results.set(
      Object.fromEntries(
        targets.map((t) => [
          t.id,
          { verdict: 'checking', cors: 'unknown', ms: null } as ProbeResult,
        ]),
      ),
    );

    await Promise.all(
      targets.map(async (target) => {
        const result = await this.probe(target, timeoutMs);
        this.results.update((current) => ({ ...current, [target.id]: result }));
      }),
    );

    this.lastRunAt.set(Date.now());
    this.running.set(false);
  }

  /**
   * One host: reachability first, then readability.
   *
   * The CORS leg is skipped entirely when the host was never reached — a `cors`
   * request to an unreachable host fails for the same network reason, and
   * reporting that as "CORS blocked" would be exactly the misdiagnosis that
   * sends people installing extensions which cannot possibly help.
   */
  private async probe(target: ProbeTarget, timeoutMs: number): Promise<ProbeResult> {
    const started = performance.now();
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      await fetch(target.probeUrl, {
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: timeout,
      });
      const ms = Math.round(performance.now() - started);
      return { verdict: 'reachable', cors: await this.probeCors(target, timeoutMs), ms };
    } catch {
      const ms = Math.round(performance.now() - started);
      // Distinguishing the two is the only inference this method makes, and it
      // is a safe one: the abort came from our own timer, not from the network.
      return { verdict: timeout.aborted ? 'timeout' : 'failed', cors: 'unknown', ms };
    }
  }

  /**
   * Can this origin actually *read* the host's replies?
   *
   * A plain `cors`-mode GET. If it resolves, the host sent an
   * `Access-Control-Allow-Origin` covering us and the app can talk to it
   * directly. If it throws — having already proven reachable — the only
   * remaining explanation is that the host declined to, which is the one
   * failure a CORS proxy exists to solve.
   *
   * An HTTP error status still counts as readable: a readable 404 means the
   * browser was allowed to see the response, which is the question being asked.
   */
  private async probeCors(target: ProbeTarget, timeoutMs: number): Promise<CorsReadable> {
    try {
      await fetch(target.probeUrl, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return 'readable';
    } catch {
      return 'blocked';
    }
  }
}
