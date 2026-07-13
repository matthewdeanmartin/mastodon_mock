import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

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

  /** Flag the server as down (called by the HTTP error interceptor). */
  markDown(): void {
    this.down.set(true);
  }

  /** Clear the down state (called when any request succeeds). */
  markUp(): void {
    if (this.down()) {
      this.down.set(false);
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
      error: () => {
        // Still down — leave the whale up.
        this.checking.set(false);
      },
    });
  }
}
