import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RaindropSession } from '../../providers/raindrop/raindrop-session';

/** Completes Raindrop.io OAuth before returning to Connections. */
@Component({
  selector: 'app-raindrop-callback',
  template: `
    <main class="callback-card" aria-live="polite">
      <h1>Connecting Raindrop.io…</h1>
      <p>{{ status() }}</p>
    </main>
  `,
  styles: `
    :host {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .callback-card {
      max-width: 480px;
      text-align: center;
    }
  `,
})
export class RaindropCallback implements OnInit {
  private raindrop = inject(RaindropSession);
  private router = inject(Router);
  protected status = signal('Finishing authorization with Raindrop.io.');

  async ngOnInit(): Promise<void> {
    try {
      await this.raindrop.finishAuthorization(new URLSearchParams(location.search));
      await this.router.navigate(['/settings/connections'], {
        queryParams: { raindrop: 'connected' },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Raindrop.io authorization failed.';
      await this.router.navigate(['/settings/connections'], {
        queryParams: { raindrop: 'error', message },
      });
    }
  }
}
