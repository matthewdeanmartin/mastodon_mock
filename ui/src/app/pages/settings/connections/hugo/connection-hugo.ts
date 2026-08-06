import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GitHubSession } from '../../../../providers/github/github-session';
import {
  DEFAULT_CONTENT_PATH,
  HugoSettings,
  normalizeSiteUrl,
  parseRepoInput,
} from '../../../../providers/hugo/hugo-settings';
import { HugoValidate } from '../../../../providers/hugo/hugo-validate';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';
import { expiryLabel } from '../expiry-label';

/** Settings → Connections → Blog (Hugo). */
@Component({
  selector: 'app-connection-hugo',
  imports: [FormsModule, RouterLink],
  templateUrl: './connection-hugo.html',
  styleUrls: ['../connection-page.css', './connection-hugo.css'],
})
export class ConnectionHugo implements OnInit {
  protected readonly settings = inject(HugoSettings);
  private readonly validate = inject(HugoValidate);
  private readonly github = inject(GitHubSession);

  protected readonly token = signal('');
  protected readonly repoInput = signal('');
  protected readonly branch = signal('main');
  protected readonly contentPath = signal(DEFAULT_CONTENT_PATH);
  protected readonly siteUrl = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Set when the repo connected but does not look like a Hugo site. */
  protected readonly warning = signal<string | null>(null);

  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.account.detail;
  protected readonly expiryLabel = expiryLabel;
  protected readonly canSubmit = computed(
    () => !!this.token().trim() && !!this.repoInput().trim() && !this.busy(),
  );

  /**
   * The repo half without the token half — the state a machine is in after
   * importing settings. Publishing is impossible until a token is pasted, and
   * saying so beats rendering an empty form that looks like a fresh setup.
   */
  protected readonly needsToken = computed(
    () => this.settings.repo() !== null && this.settings.token() === null,
  );

  ngOnInit(): void {
    this.settings.enforceLifetime();
    const repo = this.settings.repo();
    if (repo) {
      this.repoInput.set(`${repo.owner}/${repo.repo}`);
      this.branch.set(repo.branch);
      this.contentPath.set(repo.contentPath);
      this.siteUrl.set(repo.siteUrl ?? '');
      return;
    }
    // A convenience, never a dependency: if the read-only GitHub connector is
    // linked we know the likely owner, so the user types one word instead of two.
    const login = this.github.user()?.login;
    if (login) {
      this.repoInput.set(`${login}/`);
    }
  }

  async connect(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.error.set(null);
    this.notice.set(null);
    this.warning.set(null);

    const parsed = parseRepoInput(this.repoInput());
    if (!parsed) {
      this.error.set('Enter your repository as owner/name, or paste its GitHub address.');
      return;
    }
    let siteUrl: string | null;
    try {
      siteUrl = normalizeSiteUrl(this.siteUrl());
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Check the site address.');
      return;
    }

    const candidate = {
      ...parsed,
      branch: this.branch().trim() || 'main',
      contentPath: this.contentPath().trim() || DEFAULT_CONTENT_PATH,
      siteUrl,
      includeInProfile: this.settings.includeInProfile(),
    };

    this.busy.set(true);
    try {
      const result = await this.validate.check(this.token(), candidate);
      if (!result.ok) {
        this.error.set(result.problem);
        return;
      }
      this.settings.connect(this.token(), candidate);
      this.token.set('');
      this.notice.set(
        result.postCount
          ? `Connected. Found ${result.postCount} post${result.postCount === 1 ? '' : 's'} in ${candidate.contentPath}. Hugo is now a target in the composer.`
          : `Connected. ${candidate.contentPath} is empty — your first post will be the first file in it.`,
      );
      if (!result.looksLikeHugo) {
        this.warning.set(
          "We couldn't find a Hugo config file at the root of this repository. Publishing will still commit your posts, but check this is the right repo.",
        );
      }
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : "Couldn't reach GitHub.");
    } finally {
      this.busy.set(false);
    }
  }

  setProfileFeed(include: boolean): void {
    this.settings.setIncludeInProfile(include);
  }

  disconnect(): void {
    this.settings.disconnect();
    this.token.set('');
    this.notice.set(null);
    this.error.set(null);
    this.warning.set(null);
  }
}
