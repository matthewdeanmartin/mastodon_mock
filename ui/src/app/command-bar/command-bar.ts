import { Component, inject, input, output } from '@angular/core';
import { ClientPrefs } from '../client-prefs';
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
        (click)="prefs.setShowImages(!prefs.showImages())"
        [title]="prefs.showImages() ? 'Hide images (show 🖼️ chips instead)' : 'Show images'"
      >
        🖼️ {{ prefs.showImages() ? 'Images' : 'No images' }}
      </button>
      @if (providerChips() && registry.linked().length) {
        <button
          class="btn btn-outline"
          [class.active]="prefs.isProviderVisible('mastodon')"
          (click)="prefs.toggleProvider('mastodon')"
          title="Show or hide Mastodon posts"
        >
          🦣 Fedi
        </button>
        @for (p of registry.linked(); track p.id) {
          <button
            class="btn btn-outline"
            [class.active]="prefs.isProviderVisible(p.id)"
            (click)="prefs.toggleProvider(p.id)"
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
  protected readonly prefs = inject(ClientPrefs);
  protected readonly registry = inject(ProviderRegistry);

  /** Whether the host page has a live stream to offer. */
  readonly showLive = input(true);
  readonly live = input(false);
  /** Whether this page merges foreign providers (home) — shows the filter chips. */
  readonly providerChips = input(false);
  readonly toggleLive = output<void>();
}
