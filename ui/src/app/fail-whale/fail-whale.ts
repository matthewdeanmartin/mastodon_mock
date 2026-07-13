import { Component, inject } from '@angular/core';
import { ServerHealth } from '../server-health';

/**
 * Full-screen overlay shown when the API server is unreachable. Recovery is on
 * demand: the user clicks "Try again", which pings the server once. There is no
 * background polling.
 */
@Component({
  selector: 'app-fail-whale',
  imports: [],
  templateUrl: './fail-whale.html',
  styleUrl: './fail-whale.css',
})
export class FailWhale {
  protected health = inject(ServerHealth);

  retry(): void {
    this.health.recheck();
  }
}
