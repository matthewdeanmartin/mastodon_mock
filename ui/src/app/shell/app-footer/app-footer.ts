import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../auth';
import { BugReportDialog } from '../../bug-report-dialog/bug-report-dialog';
import { BUILD_INFO } from '../../build-info';
import { Server } from '../../server';

/**
 * The end-of-feed footer. Feeds here are finite, so there is a bottom — and a
 * bottom deserves a footer: instance rules, the client's source, and a whale.
 */
@Component({
  selector: 'app-app-footer',
  imports: [DatePipe, RouterLink, BugReportDialog],
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
      <button class="link" type="button" (click)="reporting.set(true)">Report a bug</button>
      <span aria-hidden="true">·</span>
      <a routerLink="/fail-whale">Fail whale</a>
      <p class="footer-note">You reached the end. That's allowed here.</p>
      @if (build.builtAt) {
        <p class="build-info">
          Built {{ build.builtAt | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC
          @if (build.commitUrl) {
            <span aria-hidden="true">·</span>
            <a [href]="build.commitUrl" target="_blank" rel="noopener noreferrer">
              {{ build.commit!.slice(0, 7) }}
            </a>
          }
          @if (build.runUrl) {
            <span aria-hidden="true">·</span>
            <a [href]="build.runUrl" target="_blank" rel="noopener noreferrer">build log</a>
          }
        </p>
      }
    </footer>
    @if (reporting()) {
      <app-bug-report-dialog (closed)="reporting.set(false)" />
    }
  `,
  styles: `
    .app-footer {
      padding: 20px 16px 28px;
      border-top: 1px solid var(--border);
      font-size: 12.5px;
      text-align: center;
    }
    .app-footer a,
    .app-footer .link {
      color: var(--muted);
    }
    .app-footer a:hover,
    .app-footer .link:hover {
      color: var(--accent);
    }
    .app-footer .link {
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      cursor: pointer;
      text-decoration: underline;
    }
    .footer-note {
      margin: 8px 0 0;
      font-size: 11.5px;
    }
    .build-info {
      margin: 4px 0 0;
      font-size: 11px;
    }
  `,
})
export class AppFooter {
  private auth = inject(Auth);
  private server = inject(Server);

  /** CI-stamped build metadata; the placeholder (null builtAt) hides the line. */
  protected build = BUILD_INFO;

  /** Whether the "Report a bug" dialog is open. */
  protected reporting = signal(false);

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
