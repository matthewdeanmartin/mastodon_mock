import { Component, inject, signal } from '@angular/core';
import { BugReportDialog } from '../bug-report-dialog/bug-report-dialog';
import { InstanceStatus } from '../instance-status';
import { ServerHealth } from '../server-health';

/**
 * Full-screen overlay shown when the API server is unreachable. Recovery is on
 * demand: the user clicks "Try again", which pings the server once. There is no
 * background polling. When the unreachable instance has a known status page
 * (curated, administrator-provided, or third-party monitoring — see
 * {@link InstanceStatus}), a link to it is offered.
 */
@Component({
  selector: 'app-fail-whale',
  imports: [BugReportDialog],
  templateUrl: './fail-whale.html',
  styleUrl: './fail-whale.css',
})
export class FailWhale {
  protected health = inject(ServerHealth);
  protected status = inject(InstanceStatus);
  protected reporting = signal(false);

  retry(): void {
    this.health.recheck();
  }
}
