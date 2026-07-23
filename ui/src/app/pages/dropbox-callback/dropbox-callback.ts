import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DropboxSession } from '../../providers/dropbox/dropbox-session';

/** Completes Dropbox's browser-only PKCE callback before returning to Connections. */
@Component({
  selector: 'app-dropbox-callback',
  template: `
    <main class="callback-card" aria-live="polite">
      <h1>Connecting Dropbox…</h1>
      <p>{{ status() }}</p>
    </main>
  `,
  styles: `
    :host { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .callback-card { max-width: 480px; text-align: center; }
  `,
})
export class DropboxCallback implements OnInit {
  private dropbox = inject(DropboxSession);
  private router = inject(Router);
  protected status = signal('Finishing authorization with Dropbox.');

  async ngOnInit(): Promise<void> {
    try {
      await this.dropbox.finishAuthorization(new URLSearchParams(location.search));
      await this.router.navigate(['/settings/connections'], {
        queryParams: { dropbox: 'connected' },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Dropbox authorization failed.';
      await this.router.navigate(['/settings/connections'], {
        queryParams: { dropbox: 'error', message },
      });
    }
  }
}
