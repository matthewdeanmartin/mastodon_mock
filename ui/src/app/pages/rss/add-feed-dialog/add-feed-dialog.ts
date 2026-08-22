import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FocusTrap } from '../../../a11y/focus-trap';
import { CorsProxySettings } from '../../../providers/cors-proxy/cors-proxy-settings';
import { RssAddFeed } from '../../../providers/rss/rss-add-feed';
import { PageDiagnostics } from '../../../page-diagnostics';

/**
 * "Add a feed" — a paste-a-URL dialog over {@link RssAddFeed}, the same
 * validate-by-fetching flow Settings → RSS uses. Kept as its own small
 * component (rather than inlined in the RSS page) because it is a modal with
 * its own open/closed lifecycle, matching {@link ConfirmDialog}'s shape.
 */
@Component({
  selector: 'app-add-feed-dialog',
  imports: [FormsModule, FocusTrap],
  templateUrl: './add-feed-dialog.html',
  styleUrl: './add-feed-dialog.css',
})
export class AddFeedDialog {
  private addFeed = inject(RssAddFeed);
  protected proxySettings = inject(CorsProxySettings);
  private diagnostics = inject(PageDiagnostics);

  readonly closed = output<void>();
  /** Emitted once a feed is actually subscribed, so the host can drop the count/list refresh. */
  readonly added = output<void>();

  protected feedUrl = signal('');
  protected adding = signal(false);
  protected error = signal<string | null>(null);
  protected retryable = signal<string | null>(null);

  submit(): void {
    const url = this.feedUrl().trim();
    if (!url || this.adding()) {
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.error.set('Feed URLs start with http:// or https://.');
      return;
    }
    this.attempt(url, false);
  }

  retryViaProxy(): void {
    const url = this.retryable();
    if (url) {
      this.attempt(url, true);
    }
  }

  private attempt(url: string, useProxy: boolean): void {
    this.adding.set(true);
    this.error.set(null);
    this.retryable.set(null);

    this.addFeed.add(url, useProxy).subscribe({
      next: () => {
        this.diagnostics.info('RSS', 'add-feed-dialog:success', { viaProxy: useProxy });
        this.adding.set(false);
        this.added.emit();
        this.closed.emit();
      },
      error: (err: Error) => {
        this.diagnostics.warn('RSS', 'add-feed-dialog:error', { message: err.message });
        // A direct fetch just failed — almost always CORS. A Plus subscriber
        // who has never configured a proxy is entitled to one right now, and
        // asking them to find Settings -> Connections -> CORS proxy before a
        // feed they just tried to add can work is exactly the "still being
        // rate-limited at the free tier until they stumble across the right
        // screen" problem CorsProxySettings.adoptSupporterProxy already exists
        // to fix elsewhere (see the Plus welcome dialog and Plus settings
        // page). Adopt it here too, then retry immediately and silently —
        // no separate "try via proxy?" click for something already paid for.
        if (!useProxy && this.proxySettings.missingEntitledProxy()) {
          this.proxySettings.adoptSupporterProxy();
          this.attempt(url, true);
          return;
        }
        this.error.set(err.message);
        if (!useProxy && this.proxySettings.usable()) {
          this.retryable.set(url);
        }
        this.adding.set(false);
      },
    });
  }
}
