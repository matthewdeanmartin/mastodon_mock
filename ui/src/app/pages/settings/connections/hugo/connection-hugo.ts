import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ClientPrefs } from '../../../../client-prefs';
import { Drafts } from '../../../../drafts';
import { GitHubSession } from '../../../../providers/github/github-session';
import { HugoEditSession } from '../../../../providers/hugo/hugo-edit-session';
import { HugoPostRow } from '../../../../providers/hugo/hugo-listing';
import { HugoPosts } from '../../../../providers/hugo/hugo-posts';
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
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './connection-hugo.html',
  styleUrls: ['../connection-page.css', './connection-hugo.css'],
})
export class ConnectionHugo implements OnInit {
  protected readonly settings = inject(HugoSettings);
  protected readonly posts = inject(HugoPosts);
  private readonly validate = inject(HugoValidate);
  private readonly github = inject(GitHubSession);
  private readonly hugoEdit = inject(HugoEditSession);
  private readonly drafts = inject(Drafts);
  private readonly prefs = inject(ClientPrefs);
  private readonly router = inject(Router);

  /** The row whose file is being fetched, so only that row shows a spinner. */
  protected readonly opening = signal<string | null>(null);
  protected readonly openError = signal<string | null>(null);

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
      if (this.settings.connected()) {
        void this.posts.load();
      }
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
      void this.posts.load();
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

  /**
   * Open a post in the composer.
   *
   * Two handoffs are parked, not one. The text rides in the existing
   * `Drafts.handoff()` slot — the same mechanism "Edit for post" uses from
   * /drafts and /pastes — because the composer already knows how to drain that
   * on seed. The git half (path, sha, delimiter style, original date, unknown
   * front-matter keys) rides in {@link HugoEditSession}, because none of it
   * belongs in a `DraftSnapshot` that every other target shares.
   *
   * The file is re-read here rather than reusing the list's cached parse: an
   * edit needs the *current* sha to write back with, and this read is the last
   * chance to notice the file changed since the list was drawn.
   */
  async edit(row: HugoPostRow): Promise<void> {
    if (this.opening()) {
      return;
    }
    this.opening.set(row.path);
    this.openError.set(null);
    try {
      const { parsed, sha } = await this.posts.open(row.path);
      const title = parsed.title?.trim() || row.title;
      this.hugoEdit.start({
        path: row.path,
        sha,
        format: parsed.format,
        date: parsed.date,
        extraLines: parsed.extraLines,
        originalTitle: title,
      });
      this.drafts.handoff({
        segments: [parsed.body],
        spoilerText: title,
        sensitive: false,
        visibility: this.prefs.defaultVisibility(),
        poll: null,
        target: 'hugo',
      });
      await this.router.navigate(['/home']);
    } catch (error: unknown) {
      this.openError.set(
        error instanceof Error ? error.message : 'Could not open that post for editing.',
      );
    } finally {
      this.opening.set(null);
    }
  }

  refresh(): void {
    void this.posts.load();
  }

  showMore(): void {
    void this.posts.hydrate();
  }

  disconnect(): void {
    this.settings.disconnect();
    this.posts.reset();
    this.token.set('');
    this.notice.set(null);
    this.error.set(null);
    this.warning.set(null);
  }
}
