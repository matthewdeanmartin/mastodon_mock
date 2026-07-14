import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { environment } from '../environments/environment';
import { ClientPrefs } from './client-prefs';
import { FailWhale } from './fail-whale/fail-whale';
import { InstanceStatus } from './instance-status';
import { ServerHealth } from './server-health';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FailWhale],
  template: `
    <router-outlet />
    @if (health.down()) {
      <app-fail-whale />
    }
  `,
})
export class App {
  private readonly title = inject(Title);
  protected readonly health = inject(ServerHealth);
  /** Instantiated eagerly so theme/accent apply on every route, including login. */
  private readonly prefs = inject(ClientPrefs);
  /** Instantiated eagerly so status-page discovery runs while the instance is healthy. */
  private readonly instanceStatus = inject(InstanceStatus);

  constructor() {
    // Set the tab title from the build flavor (mastodon_mock vs Mocking Bird).
    this.title.setTitle(environment.brand);
  }
}
