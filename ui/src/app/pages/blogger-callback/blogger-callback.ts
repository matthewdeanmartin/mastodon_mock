import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BloggerSession } from '../../providers/blogger/blogger-session';

/** Completes Google's browser-only PKCE callback before returning to Connections. */
@Component({
  selector: 'app-blogger-callback',
  template: `
    <main class="callback-card" aria-live="polite">
      <h1>Connecting Blogger…</h1>
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
export class BloggerCallback implements OnInit {
  private blogger = inject(BloggerSession);
  private router = inject(Router);
  protected status = signal('Finishing authorization with Google.');

  async ngOnInit(): Promise<void> {
    try {
      await this.blogger.finishAuthorization(new URLSearchParams(location.search));
      await this.router.navigate(['/settings/connections/blogger'], {
        queryParams: { blogger: 'connected' },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Blogger authorization failed.';
      await this.router.navigate(['/settings/connections/blogger'], {
        queryParams: { blogger: 'error', message },
      });
    }
  }
}
