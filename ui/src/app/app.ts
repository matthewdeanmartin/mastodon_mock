import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { environment } from '../environments/environment';
import { FailWhale } from './fail-whale/fail-whale';
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

  constructor() {
    // Set the tab title from the build flavor (mastodon_mock vs Mocking Bird).
    this.title.setTitle(environment.brand);
  }
}
