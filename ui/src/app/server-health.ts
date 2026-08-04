import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

/**
 * What actually went wrong, kept so the fail whale can *show* it.
 *
 * There is no SRE team reading logs on the user's behalf — the person staring
 * at the whale is the one who has to work out whether it's their wifi, a
 * corporate proxy, or the instance genuinely being down. Everything here exists
 * to make that diagnosis possible without opening devtools.
 */
export interface HealthFailure {
  /** HTTP status, or 0 for "the request never got an answer". */
  status: number;
  /** The request that failed, path only — enough to place it, no query secrets. */
  url: string;
  /** Angular's message, or the server's own if it sent one. */
  message: string;
  /** When it happened, for "is this stale?" and for pasting into a bug report. */
  at: Date;
  /** navigator.onLine at failure time — separates "my network" from "their server". */
  online: boolean;
}

/**
 * Tracks whether the remote API server appears to be down.
 *
 * "Down" means the server was unreachable (network error / status 0) or
 * returned a 5xx. It is *not* an auth problem — a 401/403 means "log in",
 * which is handled elsewhere. When down, the app shows a full-screen fail
 * whale; recovery is on demand (the user clicks "Try again"), never a timer.
 */
@Injectable({ providedIn: 'root' })
export class ServerHealth {
  private http = inject(HttpClient);

  /** True while the server is considered unreachable. */
  readonly down = signal(false);
  /** True while a manual health re-check is in flight. */
  readonly checking = signal(false);
  /** Details of the failure that raised the whale, for the diagnostics box. */
  readonly failure = signal<HealthFailure | null>(null);

  /**
   * Flag the server as down (called by the HTTP error interceptor).
   *
   * The *first* failure is the one kept. A dead server produces a burst of
   * these as every in-flight request gives up, and the earliest one is the
   * closest to what the user was actually doing; later ones are just the
   * wreckage. Subsequent failures are ignored until something succeeds.
   */
  markDown(err?: HttpErrorResponse): void {
    this.down.set(true);
    if (err && !this.failure()) {
      this.failure.set({
        status: err.status,
        url: pathOf(err.url),
        message: describe(err),
        at: new Date(),
        online: navigator.onLine,
      });
    }
  }

  /** Clear the down state (called when any request succeeds). */
  markUp(): void {
    if (this.down()) {
      this.down.set(false);
    }
    if (this.failure()) {
      this.failure.set(null);
    }
  }

  /**
   * Ping a lightweight, unauthenticated endpoint once to see if the server is
   * back. On success the fail whale dismisses; on failure it stays. This is the
   * only place we poll, and only in response to a user action.
   */
  recheck(): void {
    if (this.checking()) {
      return;
    }
    this.checking.set(true);
    this.http.get('/api/v2/instance').subscribe({
      next: () => {
        this.down.set(false);
        this.checking.set(false);
      },
      error: (err) => {
        // Still down — leave the whale up, but refresh the evidence so the box
        // describes *this* attempt rather than the one from ten minutes ago.
        this.failure.set(null);
        this.markDown(err);
        this.checking.set(false);
      },
    });
  }
}

/**
 * Path (and query) of a failed request, with the origin dropped.
 *
 * The host is already shown separately as "which server", so repeating it in
 * every line is noise; the path is the part that says *what* was being asked
 * for. A relative or unparseable URL is passed through unchanged.
 */
function pathOf(url: string | null): string {
  if (!url) {
    return '(unknown request)';
  }
  try {
    const parsed = new URL(url, location.origin);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

/** The most human sentence available for this failure. */
function describe(err: HttpErrorResponse): string {
  const detail = String(err.error?.error ?? err.error?.message ?? '').trim();
  if (detail) {
    return detail;
  }
  if (err.status === 0) {
    // Status 0 is the browser refusing to tell us more: DNS failure, TLS
    // rejection, CORS block and "wifi is off" are indistinguishable from here.
    return 'The request never completed — no response reached the browser. This is usually a network, DNS, TLS or CORS problem rather than an error from the server.';
  }
  return err.message || `HTTP ${err.status}`;
}
