import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BloggerApi, BloggerBlog } from '../../../../providers/blogger/blogger-api';
import {
  BLOGGER_CALLBACK_PATH,
  BloggerSession,
} from '../../../../providers/blogger/blogger-session';
import { appCallbackUrl } from '../../../../pkce';
import { CONNECTION_SCOPE_COPY } from '../connection-catalog';
import { PageDiagnostics } from '../../../../page-diagnostics';

/**
 * Settings → Connections → Blog (Blogger).
 *
 * Two steps, and the second is not optional: signing in with Google proves who
 * you are, but a Google account can own several blogs, so nothing can be
 * published until one is chosen. The composer keys off that choice rather than
 * the session, so a half-finished setup never presents a target that would fail
 * on send.
 */
@Component({
  selector: 'app-connection-blogger',
  imports: [RouterLink],
  templateUrl: './connection-blogger.html',
  styleUrls: ['../connection-page.css', './connection-blogger.css'],
})
export class ConnectionBlogger implements OnInit {
  protected readonly session = inject(BloggerSession);
  private readonly api = inject(BloggerApi);
  private readonly route = inject(ActivatedRoute);
  private readonly diagnostics = inject(PageDiagnostics);

  protected readonly blogs = signal<BloggerBlog[]>([]);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly scopeDetail = CONNECTION_SCOPE_COPY.account.detail;

  /** Draft of the "use my own Google project" field. */
  protected readonly clientIdDraft = signal('');
  /** The advanced section stays closed unless it is already in use. */
  protected readonly showAdvanced = signal(false);
  /** Where the user must register the callback on their own OAuth client. */
  protected readonly callbackUrl = appCallbackUrl(BLOGGER_CALLBACK_PATH);

  ngOnInit(): void {
    this.clientIdDraft.set(this.session.ownClientId());
    // Already using an override, or no shipped id to fall back on — either way
    // the advanced section is the relevant part of this page, so open it.
    this.showAdvanced.set(!!this.session.ownClientId() || !this.session.hasShippedClientId);

    // The OAuth callback bounces back here with its outcome in the query.
    const params = this.route.snapshot.queryParamMap;
    if (params.get('blogger') === 'error') {
      this.error.set(params.get('message') ?? 'Blogger authorization failed.');
    } else if (params.get('blogger') === 'connected') {
      this.notice.set('Connected to Google. Choose which blog to publish to.');
    }
    if (this.session.connected()) {
      void this.loadBlogs();
    }
  }

  async connect(): Promise<void> {
    this.error.set(null);
    try {
      await this.session.connect();
    } catch (error: unknown) {
      this.diagnostics.error('Blogger', 'connect:error', error);
      this.error.set(error instanceof Error ? error.message : "Couldn't start Google sign-in.");
    }
  }

  async loadBlogs(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const blogs = await this.api.listBlogs();
      this.blogs.set(blogs);
      if (!blogs.length) {
        this.error.set(
          'This Google account has no Blogger blogs. Create one at blogger.com, then reload.',
        );
      }
    } catch (error: unknown) {
      this.diagnostics.error('Blogger', 'load-blogs:error', error);
      this.error.set(error instanceof Error ? error.message : "Couldn't load your blogs.");
    } finally {
      this.busy.set(false);
    }
  }

  choose(blog: BloggerBlog): void {
    this.session.chooseBlog(blog.id, blog.name, blog.url);
    this.notice.set(`Posts will publish to ${blog.name}.`);
  }

  toggleIncludeInProfile(include: boolean): void {
    this.session.setIncludeInProfile(include);
  }

  saveClientId(): void {
    const next = this.clientIdDraft().trim();
    this.session.setOwnClientId(next);
    this.blogs.set([]);
    this.error.set(null);
    this.notice.set(
      next
        ? 'Saved. Sign in again to use your own Google project.'
        : "Cleared. Signing in will use this app's own Google project.",
    );
  }

  disconnect(): void {
    // Signs out of Google but keeps the blog choice and profile-feed opt-in:
    // the feed is public and needs no session, so signing out should stop
    // publishing, not empty the user's profile.
    this.session.disconnect();
    this.blogs.set([]);
    this.notice.set('Signed out of Google. Your blog is still shown on your profile.');
  }

  forget(): void {
    this.session.forget();
    this.blogs.set([]);
    this.notice.set('Disconnected from Blogger and removed the blog.');
  }
}
