import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../auth';
import { Server } from '../../server';

/**
 * The end-of-feed footer. Feeds here are finite, so there is a bottom — and a
 * bottom deserves a footer: instance rules, the client's source, and a whale.
 */
@Component({
  selector: 'app-app-footer',
  imports: [RouterLink],
  template: `
    <footer class="app-footer muted">
      <a [href]="aboutUrl()" target="_blank" rel="noopener noreferrer">
        {{ host() || 'Server' }} rules &amp; terms
      </a>
      <span aria-hidden="true">·</span>
      <a
        href="https://github.com/matthewdeanmartin/mastodon_mock"
        target="_blank"
        rel="noopener noreferrer"
      >
        Mockingbird source
      </a>
      <span aria-hidden="true">·</span>
      <a routerLink="/fail-whale">Fail whale</a>
      <p class="footer-note">You reached the end. That's allowed here.</p>
    </footer>
  `,
  styles: `
    .app-footer {
      padding: 20px 16px 28px;
      border-top: 1px solid var(--border);
      font-size: 12.5px;
      text-align: center;
    }
    .app-footer a {
      color: var(--muted);
    }
    .app-footer a:hover {
      color: var(--accent);
    }
    .footer-note {
      margin: 8px 0 0;
      font-size: 11.5px;
    }
  `,
})
export class AppFooter {
  private auth = inject(Auth);
  private server = inject(Server);

  /** Same home-host inference as the right rail's donate link. */
  protected host = computed<string | null>(() => {
    const acct = this.auth.account()?.acct ?? '';
    const at = acct.indexOf('@');
    if (at > 0) {
      return acct.slice(at + 1);
    }
    const base = this.server.baseUrl();
    return base ? base.replace(/^https?:\/\//, '') : null;
  });

  protected aboutUrl = computed<string>(() => {
    const host = this.host();
    return host ? `https://${host}/about` : '/about';
  });
}
