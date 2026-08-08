import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AnalyticsTracker } from './analytics-tracker';
import { ClientPrefs } from './client-prefs';
import { FailWhale } from './fail-whale/fail-whale';
import { InstanceStatus } from './instance-status';
import { RouteLog } from './observability/route-log';
import { ServerHealth } from './server-health';
import { UpdateOverlay } from './update-overlay/update-overlay';
import { UpdateRecovery } from './update-recovery';
import { ConfigSync } from './config-sync';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FailWhale, UpdateOverlay],
  template: `
    <router-outlet />
    @if (health.down()) {
      <app-fail-whale />
    }
    <app-update-overlay />
  `,
})
export class App {
  protected readonly health = inject(ServerHealth);
  /** Instantiated eagerly so theme/accent apply on every route, including login. */
  private readonly prefs = inject(ClientPrefs);
  /** Instantiated eagerly so status-page discovery runs while the instance is healthy. */
  private readonly instanceStatus = inject(InstanceStatus);
  private readonly recovery = inject(UpdateRecovery);
  private readonly analytics = inject(AnalyticsTracker);
  private readonly routeLog = inject(RouteLog);
  /** Checks an explicitly configured remote client config when its cadence is due. */
  private readonly configSync = inject(ConfigSync);

  constructor() {
    // Count page views on every router navigation (GoatCounter, no_onload).
    this.analytics.start();
    // The user's own copy of the same idea: per-route visits and time spent,
    // kept locally for the Observability page and never sent anywhere.
    this.routeLog.start();
    // Arm the deployment-recovery loop guard: if we got here after an
    // auto-reload, clear it once we've run cleanly for a bit.
    this.recovery.markApplicationStableAfterDelay();
    this.configSync.start();
  }
}
