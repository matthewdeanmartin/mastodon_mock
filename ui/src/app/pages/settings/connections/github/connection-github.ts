import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GitHubSession } from '../../../../providers/github/github-session';
import { expiryLabel } from '../expiry-label';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';

/** Settings → Connections → GitHub. Token paste, validation, and the API proof. */
@Component({
  selector: 'app-connection-github',
  imports: [FormsModule, RouterLink],
  templateUrl: './connection-github.html',
  styleUrls: ['../connection-page.css', './connection-github.css'],
})
export class ConnectionGitHub implements OnInit {
  protected github = inject(GitHubSession);

  protected githubToken = signal('');
  protected githubBusy = signal(false);
  protected githubError = signal<string | null>(null);
  protected githubNotice = signal<string | null>(null);

  protected readonly expiryLabel = expiryLabel;

  /** The storage-scope sentence shown under the heading. */
  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.account.detail;

  ngOnInit(): void {
    // The catalog page governs the whole set for the policy picker; this page
    // may have been reached by deep link, in which case nothing has re-checked
    // this credential against a policy the user shortened elsewhere.
    this.github.enforceLifetime();
  }

  async connectGitHub(): Promise<void> {
    if (this.githubBusy()) {
      return;
    }
    this.githubBusy.set(true);
    this.githubError.set(null);
    this.githubNotice.set(null);
    try {
      const user = await this.github.connect(this.githubToken());
      this.githubToken.set('');
      this.githubNotice.set(`GitHub connected as @${user.login}.`);
    } catch (error: unknown) {
      this.githubError.set(describeError(error, "Couldn't connect GitHub."));
    } finally {
      this.githubBusy.set(false);
    }
  }

  async proveGitHubConnection(): Promise<void> {
    if (this.githubBusy()) {
      return;
    }
    this.githubBusy.set(true);
    this.githubError.set(null);
    this.githubNotice.set(null);
    try {
      await this.github.runProof();
      this.githubNotice.set('GitHub API proof completed in this browser.');
    } catch (error: unknown) {
      this.githubError.set(describeError(error, "Couldn't call the GitHub API."));
    } finally {
      this.githubBusy.set(false);
    }
  }

  disconnectGitHub(): void {
    this.github.disconnect();
    this.githubNotice.set(null);
    this.githubError.set(null);
  }
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
