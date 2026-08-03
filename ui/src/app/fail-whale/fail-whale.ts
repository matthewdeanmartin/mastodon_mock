import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BuildInfo, BUILD_INFO } from '../build-info';
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
 *
 * Below all of that sits the **details box**: the actual error, the request that
 * produced it, and the context needed to tell "my network" apart from "their
 * server". Nobody else is going to look at this — no SRE is paged when a
 * client-side app can't reach a public instance — so the person in front of the
 * screen gets the raw material to troubleshoot, plus a route to the connection
 * doctor in case the instance isn't the culprit at all.
 */
@Component({
  selector: 'app-fail-whale',
  imports: [BugReportDialog, ServerPicker, RouterLink],
  templateUrl: './fail-whale.html',
  styleUrl: './fail-whale.css',
})
export class FailWhale {
  protected health = inject(ServerHealth);
  protected status = inject(InstanceStatus);
  private auth = inject(Auth);
  protected reporting = signal(false);
  /** Details box starts closed — it's for the curious, not the first thing read. */
  protected detailsOpen = signal(false);
  protected readonly build: BuildInfo = BUILD_INFO;
  protected copied = signal(false);

  /**
   * The browser thinks it has no network at all. Worth calling out loudly: it
   * reframes the whole page from "that instance is broken" to "you're offline",
   * which is a completely different thing to go fix.
   */
  protected readonly offline = computed(() => this.health.failure()?.online === false);

  /** One pasteable block for a forum post or bug report. */
  protected diagnosticsText(): string {
    const f = this.health.failure();
    const lines = [
      `Server:  ${this.status.currentDomain() || '(unknown)'}`,
      `Status:  ${f ? (f.status === 0 ? '0 (no response)' : f.status) : '(none recorded)'}`,
      `Request: ${f?.url ?? '(none recorded)'}`,
      `Error:   ${f?.message ?? '(none recorded)'}`,
      `Time:    ${f?.at.toISOString() ?? '(none recorded)'}`,
      `Online:  ${f ? f.online : navigator.onLine}`,
      `Build:   ${this.build.commit ?? 'dev'}`,
    ];
    return lines.join('\n');
  }

  protected async copyDiagnostics(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.diagnosticsText());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard denied (insecure context, permissions). The text is on screen
      // and selectable anyway, so there is nothing to recover from.
    }
  }

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
