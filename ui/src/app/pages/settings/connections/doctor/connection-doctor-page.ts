import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Server } from '../../../../server';
import { ConnectionDoctor } from './connection-doctor';
import {
  CATEGORY_LABELS,
  corsHint,
  homeServerTarget,
  interpret,
  PROBE_TARGETS,
  ProbeCategory,
  ProbeTarget,
  ProbeVerdict,
  REPORTED_OPTIONS,
  ReportedOutcome,
  timingHint,
} from './connection-doctor-catalog';

/** A target joined to its verdict and whatever the user reported about it. */
export interface DoctorRow {
  target: ProbeTarget;
  verdict: ProbeVerdict;
  /** How long the probe took, already formatted. Null before a run. */
  timing: string | null;
  /** What that duration suggests, when it suggests anything. */
  timingHint: string | null;
  /** Whether this app may read the host's replies, once it is reachable. */
  corsHint: string | null;
  /** True when the host answers but refuses to be read — the proxy case. */
  corsBlocked: boolean;
  reported: ReportedOutcome | null;
  /** The combined reading, once both halves are in. */
  interpretation: string | null;
}

interface DoctorGroup {
  category: ProbeCategory;
  label: string;
  rows: DoctorRow[];
}

/**
 * Connection doctor: one sweep that says which hosts this network will let the
 * browser reach, before you invest in setting any of them up.
 *
 * The failure it exists to prevent is expensive and entirely silent: register
 * for a service, generate a key, sometimes buy credits, paste it in, watch it
 * fail with a network error that could mean anything, and have no way to tell
 * "the key is wrong" from "this network drops that host". Then do it again for
 * the next connector.
 *
 * Deliberately reachable without connecting anything, and it never reads a
 * stored credential — see the note in `connection-doctor-catalog.ts`.
 */
@Component({
  selector: 'app-connection-doctor-page',
  imports: [RouterLink],
  templateUrl: './connection-doctor-page.html',
  styleUrls: ['../connection-page.css', './connection-doctor-page.css'],
})
export class ConnectionDoctorPage {
  protected doctor = inject(ConnectionDoctor);
  private server = inject(Server);

  protected readonly reportedOptions = REPORTED_OPTIONS;

  /** What the user says they saw, per target id. */
  private reports = signal<Readonly<Record<string, ReportedOutcome>>>({});
  /** Which rows have the "what did you see?" panel open. */
  private expanded = signal<ReadonlySet<string>>(new Set());

  /**
   * The home server first, then the fixed catalog. Computed rather than
   * constant because the Mastodon instance is whatever the user picked, and the
   * built-in mock contributes no row at all.
   */
  protected readonly targets = computed<ProbeTarget[]>(() => {
    const home = homeServerTarget(this.server.baseUrl());
    return home ? [home, ...PROBE_TARGETS] : [...PROBE_TARGETS];
  });

  protected readonly groups = computed<DoctorGroup[]>(() => {
    const results = this.doctor.results();
    const reports = this.reports();
    const groups = new Map<ProbeCategory, DoctorGroup>();

    for (const target of this.targets()) {
      const result = results[target.id] ?? {
        verdict: 'idle' as ProbeVerdict,
        cors: 'unknown' as const,
        ms: null,
      };
      const verdict = result.verdict;
      const reported = reports[target.id] ?? null;
      const row: DoctorRow = {
        target,
        verdict,
        timing: result.ms !== null && verdict !== 'checking' ? formatDuration(result.ms) : null,
        timingHint: timingHint(result),
        corsHint: corsHint(result),
        corsBlocked: verdict === 'reachable' && result.cors === 'blocked',
        reported,
        // Only meaningful once the probe has actually run: pairing a report
        // with 'idle' would let the page state a cause it has not tested.
        interpretation:
          reported && (verdict === 'reachable' || verdict === 'failed' || verdict === 'timeout')
            ? interpret(verdict, reported)
            : null,
      };
      const existing = groups.get(target.category);
      if (existing) {
        existing.rows.push(row);
      } else {
        groups.set(target.category, {
          category: target.category,
          label: CATEGORY_LABELS[target.category],
          rows: [row],
        });
      }
    }
    return [...groups.values()];
  });

  protected readonly hasRun = computed(() => this.doctor.lastRunAt() !== null);

  protected readonly reachableCount = computed(
    () => this.allRows().filter((row) => row.verdict === 'reachable').length,
  );

  protected readonly blockedCount = computed(
    () =>
      this.allRows().filter((row) => row.verdict === 'failed' || row.verdict === 'timeout').length,
  );

  /**
   * Hosts that answer but refuse to be read — the population a CORS proxy
   * exists for, and the one a "disable CORS" extension would appear to fix
   * while breaking a browser-wide protection to do it.
   */
  protected readonly corsBlockedRows = computed(() =>
    // The control is excluded deliberately: it exists only to prove the test
    // works, so telling the reader it needs a proxy is advice about a host
    // they will never connect to.
    this.allRows().filter((row) => row.corsBlocked && row.target.category !== 'control'),
  );

  /**
   * True when the control host failed, which invalidates everything else on the
   * page: if `example.com` is unreachable then the browser is offline or the
   * whole network is down, and every other red row is that same fact repeated.
   */
  protected readonly controlFailed = computed(() => {
    const control = this.allRows().find((row) => row.target.category === 'control');
    return !!control && (control.verdict === 'failed' || control.verdict === 'timeout');
  });

  private allRows(): DoctorRow[] {
    return this.groups().flatMap((group) => group.rows);
  }

  protected run(): void {
    // Reports describe a previous sweep; keeping them would pair a fresh
    // verdict with a stale observation and state a conclusion for neither.
    this.reports.set({});
    this.expanded.set(new Set());
    void this.doctor.runAll(this.targets());
  }

  protected isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  /**
   * Open the host in a new tab and reveal the self-report panel.
   *
   * `noopener` matters beyond the usual hygiene here: without it the opened
   * page gets a handle on this one, and a diagnostic that hands a possibly
   * hostile intermediary a reference to the app is a poor trade for a tab.
   */
  protected openInTab(row: DoctorRow): void {
    window.open(row.target.openUrl, '_blank', 'noopener,noreferrer');
    this.expand(row.target.id);
  }

  protected expand(id: string): void {
    this.expanded.update((current) => new Set(current).add(id));
  }

  protected report(id: string, outcome: ReportedOutcome): void {
    this.reports.update((current) => ({ ...current, [id]: outcome }));
  }

  protected verdictLabel(verdict: ProbeVerdict): string {
    return VERDICT_LABELS[verdict];
  }
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Verdict copy. "Blocked or unreachable" is wordy on purpose — the browser
 * genuinely cannot tell a firewall from a dead host, and a bare "Blocked"
 * would be the page asserting something it did not observe.
 */
const VERDICT_LABELS: Record<ProbeVerdict, string> = {
  idle: 'Not checked',
  checking: 'Checking…',
  reachable: 'Reachable',
  failed: 'Blocked or unreachable',
  timeout: 'Timed out',
};
