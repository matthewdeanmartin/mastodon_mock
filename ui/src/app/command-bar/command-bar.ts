import { Component, inject, input, output } from '@angular/core';
import { Auth } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { ProviderId } from '../models';
import { ProviderRegistry } from '../providers/provider-registry';

/**
 * The timeline command bar: Go Live (owned by the host page), plus the global
 * feed toggles — Reader mode, images on/off, and text size (shown in reader).
 * Reader/images are ClientPrefs, so every timeline honours them at once.
 * Pages that merge foreign providers (home) also get per-provider filter chips.
 */
@Component({
  selector: 'app-command-bar',
  template: `
    <div class="command-bar">
      @if (showLive()) {
        <button class="btn btn-outline" [class.active]="live()" (click)="toggleLive.emit()">
          {{ live() ? '● Live' : 'Go live' }}
        </button>
      }
      @if (showRefresh()) {
        <button
          class="btn btn-outline"
          (click)="refresh.emit()"
          title="Reload the feed from the newest posts"
        >
          🔄 More
        </button>
      }
      <button
        class="btn btn-outline"
        [class.active]="prefs.feedReader()"
        (click)="prefs.setFeedReader(!prefs.feedReader())"
        title="Reader mode for the feed: reader typography, no pictures"
      >
        📖 Reader
      </button>
      <button
        class="btn btn-outline"
        [class.active]="!prefs.showImages()"
        [disabled]="prefs.feedReader()"
        (click)="prefs.setShowImages(!prefs.showImages())"
        [title]="
          prefs.feedReader()
            ? 'Reader mode hides images — turn off Reader to control images'
            : prefs.showImages()
              ? 'Hide images (show 🖼️ chips instead)'
              : 'Show images'
        "
      >
        🖼️ {{ prefs.showImages() ? 'Images' : 'No images' }}
      </button>
      @if (providerChips() && (!auth.isAnonymous || registry.linked().length)) {
        @if (!auth.isAnonymous) {
          <button
            class="btn btn-outline"
            [class.active]="prefs.isProviderVisible('mastodon')"
            (click)="toggleProvider('mastodon')"
            title="Show or hide Mastodon posts"
          >
            🦣 Fedi
          </button>
        }
        @for (p of registry.linked(); track p.id) {
          <button
            class="btn btn-outline"
            [class.active]="prefs.isProviderVisible(p.id)"
            (click)="toggleProvider(p.id)"
            [title]="'Show or hide ' + p.label + ' posts'"
          >
            {{ p.badge }}
          </button>
        }
      }
      @if (prefs.feedReader()) {
        <span class="font-controls">
          <button
            class="btn btn-outline btn-sm"
            (click)="prefs.setReaderFontSize(prefs.readerFontSize() - 1)"
            title="Smaller text"
          >
            A−
          </button>
          <button
            class="btn btn-outline btn-sm"
            (click)="prefs.setReaderFontSize(prefs.readerFontSize() + 1)"
            title="Larger text"
          >
            A+
          </button>
        </span>
      }
    </div>
  `,
  styles: `
    .command-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
    }
    .font-controls {
      display: inline-flex;
      gap: 6px;
    }
    .btn-sm {
      padding: 4px 10px;
      font-size: 0.85em;
    }
  `,
})
export class CommandBar {
  protected readonly auth = inject(Auth);
  protected readonly prefs = inject(ClientPrefs);
  protected readonly registry = inject(ProviderRegistry);

  /** Whether the host page has a live stream to offer. */
  readonly showLive = input(true);
  readonly live = input(false);
  /**
   * Whether to show a manual refresh button — for pages where live streaming
   * is off by default and re-clicking the nav link is the only other way to
   * fetch newer posts.
   */
  readonly showRefresh = input(false);
  /** Whether this page merges foreign providers (home) — shows the filter chips. */
  readonly providerChips = input(false);
  readonly toggleLive = output<void>();
  readonly refresh = output<void>();
  /** A source filter changed; merged feeds need to refetch their active sources. */
  readonly providerVisibilityChanged = output<void>();

  protected toggleProvider(id: ProviderId): void {
    this.prefs.toggleProvider(id);
    this.providerVisibilityChanged.emit();
  }
}
