import { Component, inject, signal } from '@angular/core';
import { BugReportDialog } from '../bug-report-dialog/bug-report-dialog';
import { InstanceStatus } from '../instance-status';
import { ServerHealth } from '../server-health';
import { ServerPicker } from '../server-picker/server-picker';
import { Auth } from '../auth';

/**
 * Full-screen overlay shown when the API server is unreachable. Recovery is on
 * demand: the user clicks "Try again", which pings the server once. There is no
 * background polling. When the unreachable instance has a known status page
 * (curated, administrator-provided, or third-party monitoring — see
 * {@link InstanceStatus}), a link to it is offered.
 *
 * Anonymous browsing isn't tied to any one instance, so if the anonymous user's
 * chosen server is the thing that's down (e.g. a network blocking
 * mastodon.social), the whale also offers the login page's instance picker to
 * hop to a reachable server without leaving the app.
 */
@Component({
  selector: 'app-fail-whale',
  imports: [BugReportDialog, ServerPicker],
  templateUrl: './fail-whale.html',
  styleUrl: './fail-whale.css',
})
export class FailWhale {
  protected health = inject(ServerHealth);
  protected status = inject(InstanceStatus);
  private auth = inject(Auth);
  protected reporting = signal(false);

  /** Only anonymous users can freely change instance from here — an authenticated
   *  session belongs to a specific server, so switching isn't a recovery for them. */
  protected get canChangeServer(): boolean {
    return this.auth.isAnonymous;
  }

  retry(): void {
    this.health.recheck();
  }

  /**
   * The anonymous user picked a reachable instance. Move the anonymous identity
   * there, then hard-reload — the same "invalidate everything and rebuild under
   * the new context" path the shell uses for account switches. The probe already
   * confirmed the server responds, so the reloaded app comes up on a live
   * instance and the whale is gone.
   */
  onServerPicked(baseUrl: string): void {
    this.auth.enterAnonymous(baseUrl);
    this.reload();
  }

  /** Seam so tests can assert the reload without navigating the test runner. */
  protected reload(): void {
    location.reload();
  }
}
