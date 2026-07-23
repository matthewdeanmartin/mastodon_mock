import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BlueskySession } from '../../../providers/bluesky/bluesky-session';
import { RssFetch } from '../../../providers/rss/rss-fetch';
import { RssFeedSub, RssSubscriptions } from '../../../providers/rss/rss-subscriptions';
import { AnonymousCapabilities } from '../../../providers/anonymous/anonymous-capabilities';
import { DropboxEntry, DropboxSession } from '../../../providers/dropbox/dropbox-session';
import { RaindropSession } from '../../../providers/raindrop/raindrop-session';
import { GitHubSession } from '../../../providers/github/github-session';

/**
 * Connections: the other places your people post. Mastodon is home; everything
 * here is merged into the home timeline as a guest. Client-side only — feeds
 * are fetched straight from the browser and the list lives in localStorage.
 */
@Component({
  selector: 'app-settings-connections',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-connections.html',
  styleUrl: './settings-connections.css',
})
export class SettingsConnections implements OnInit {
  protected capabilities = inject(AnonymousCapabilities);
  private rssFetch = inject(RssFetch);
  protected subs = inject(RssSubscriptions);
  protected bsky = inject(BlueskySession);
  protected dropbox = inject(DropboxSession);
  protected raindrop = inject(RaindropSession);
  protected github = inject(GitHubSession);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected feedUrl = signal('');
  protected adding = signal(false);
  protected error = signal<string | null>(null);

  // Bluesky link form.
  protected bskyHandle = signal('');
  protected bskyPassword = signal('');
  protected bskyLinking = signal(false);
  protected bskyError = signal<string | null>(null);

  protected dropboxBusy = signal(false);
  protected dropboxError = signal<string | null>(null);
  protected dropboxNotice = signal<string | null>(null);
  protected dropboxEntries = signal<DropboxEntry[] | null>(null);

  protected raindropToken = signal('');
  protected raindropError = signal<string | null>(null);
  protected raindropNotice = signal<string | null>(null);

  protected githubToken = signal('');
  protected githubBusy = signal(false);
  protected githubError = signal<string | null>(null);
  protected githubNotice = signal<string | null>(null);

  ngOnInit(): void {
    const result = this.route.snapshot.queryParamMap.get('dropbox');
    if (result === 'connected') {
      this.dropboxNotice.set('Dropbox connected.');
    } else if (result === 'error') {
      this.dropboxError.set(
        this.route.snapshot.queryParamMap.get('message') ?? 'Dropbox authorization failed.',
      );
    }
    if (result) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  connectRaindrop(): void {
    this.raindropError.set(null);
    this.raindropNotice.set(null);
    try {
      this.raindrop.connect(this.raindropToken());
      this.raindropToken.set('');
      this.raindropNotice.set('Raindrop.io connected. Bookmark buttons now offer both providers.');
    } catch (error: unknown) {
      this.raindropError.set(describeError(error, "Couldn't connect Raindrop.io."));
    }
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

  disconnectRaindrop(): void {
    this.raindrop.disconnect();
    this.raindropNotice.set(null);
  }

  async connectDropbox(): Promise<void> {
    this.dropboxError.set(null);
    this.dropboxNotice.set(null);
    try {
      await this.dropbox.connect();
    } catch (error: unknown) {
      this.dropboxError.set(describeError(error, "Couldn't start Dropbox authorization."));
    }
  }

  async listDropbox(): Promise<void> {
    if (this.dropboxBusy()) {
      return;
    }
    this.dropboxBusy.set(true);
    this.dropboxError.set(null);
    try {
      this.dropboxEntries.set(await this.dropbox.listRoot());
    } catch (error: unknown) {
      this.dropboxError.set(describeError(error, "Couldn't list your Dropbox files."));
    } finally {
      this.dropboxBusy.set(false);
    }
  }

  disconnectDropbox(): void {
    this.dropbox.disconnect();
    this.dropboxEntries.set(null);
    this.dropboxNotice.set(null);
  }

  linkBluesky(): void {
    const handle = this.bskyHandle().trim().replace(/^@/, '');
    const password = this.bskyPassword();
    if (!handle || !password || this.bskyLinking()) {
      return;
    }
    this.bskyLinking.set(true);
    this.bskyError.set(null);
    this.bsky.login(handle, password).subscribe({
      next: () => {
        this.bskyLinking.set(false);
        this.bskyHandle.set('');
        this.bskyPassword.set('');
      },
      error: (err: unknown) => {
        this.bskyLinking.set(false);
        this.bskyError.set(describeBskyError(err));
      },
    });
  }

  unlinkBluesky(): void {
    this.bsky.unlink();
  }

  addFeed(): void {
    const url = this.feedUrl().trim();
    if (!url || this.adding()) {
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.error.set('Feed URLs start with http:// or https://.');
      return;
    }
    if (this.subs.has(url)) {
      this.error.set("You're already subscribed to that feed.");
      return;
    }
    this.adding.set(true);
    this.error.set(null);
    // Validate by actually fetching: proves reachability + CORS + parseability,
    // and captures the feed's title in one go.
    this.rssFetch.fetchFeed(url).subscribe({
      next: (feed) => {
        const limitError = this.subs.add(url, feed.title);
        if (limitError) {
          this.error.set(limitError);
          this.adding.set(false);
          return;
        }
        this.feedUrl.set('');
        this.adding.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.adding.set(false);
      },
    });
  }

  remove(feed: RssFeedSub): void {
    this.subs.remove(feed.url);
  }

  toggle(feed: RssFeedSub): void {
    this.subs.setEnabled(feed.url, !feed.enabled);
  }
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function describeBskyError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 401) {
      return 'Bluesky rejected that handle/app password combination.';
    }
    const message = (err.error as { message?: string } | null)?.message;
    if (message) {
      return message;
    }
    if (err.status === 0) {
      return "Couldn't reach bsky.social — network problem?";
    }
  }
  return 'Linking failed — check the handle and app password.';
}
