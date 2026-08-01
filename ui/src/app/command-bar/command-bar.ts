import { Component, inject, input, output } from '@angular/core';
import { Auth } from '../auth';
import { ClientPrefs } from '../client-prefs';
import { ProviderId } from '../models';
import { ProviderRegistry } from '../providers/provider-registry';

/** What the host page is showing in place of its timeline. */
export type FeedView = 'feed' | 'members' | 'analytics';

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
      <!-- "Go live" used to sit here. It is now Blue → "Auto-refresh timeline",
           opt-in and off by default: a feed that rewrites itself under you is an
           antipattern, and this row's space is worth more than a toggle most
           people never want. Home reads the pref directly. -->
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
        [class.active]="imagesHidden()"
        (click)="toggleImages()"
        [title]="imagesHidden() ? 'Show images' : 'Hide images (show 🖼️ chips instead)'"
      >
        🖼️ {{ imagesHidden() ? 'No images' : 'Images' }}
      </button>
      @if (showLangFilter()) {
        <button
          class="btn btn-outline"
          [class.active]="prefs.hideForeignLangPosts()"
          (click)="prefs.setHideForeignLangPosts(!prefs.hideForeignLangPosts())"
          title="Hide posts that are confidently in a language you don't know, or that mislabel their own language. Never hides posts whose language is unclear. Set which languages you know under Settings → Internationalization."
        >
          🌐 {{ prefs.hideForeignLangPosts() ? 'My languages' : 'All languages' }}
        </button>
      }
      @if (showCalm()) {
        <button
          class="btn btn-outline"
          [class.active]="prefs.algoCalm()"
          (click)="prefs.setAlgoCalm(!prefs.algoCalm())"
          title="Calm mode: hide posts that read as inflammatory — heated wording, quote-dunks, and ratioed posts (all detected on-device)"
        >
          😌 Calm
        </button>
      }
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
      @if (showFeedViews()) {
        <!-- Views over the feed the page already has, not navigation: they swap
             what the timeline area shows, so they read as toggles like the rest
             of the bar. -->
        <button
          class="btn btn-outline"
          [class.active]="view() === 'members'"
          [attr.aria-pressed]="view() === 'members'"
          (click)="setView('members')"
          title="Who is in this feed — the accounts whose posts are loaded"
        >
          👥 Members
        </button>
        <button
          class="btn btn-outline"
          [class.active]="view() === 'analytics'"
          [attr.aria-pressed]="view() === 'analytics'"
          (click)="setView('analytics')"
          title="Analytics for the posts currently loaded in this feed"
        >
          📊 Analytics
        </button>
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

  /**
   * Whether to show a manual refresh button — for pages where live streaming
   * is off by default and re-clicking the nav link is the only other way to
   * fetch newer posts.
   */
  readonly showRefresh = input(false);
  /** Whether this page merges foreign providers (home) — shows the filter chips. */
  readonly providerChips = input(false);
  /** Show the 🌐 foreign-language filter toggle (Home). */
  readonly showLangFilter = input(false);
  /** Show the 😌 Calm toggle (Home; Algo has its own chip). */
  readonly showCalm = input(false);
  /** Show the 👥 Members / 📊 Analytics view toggles (Home). */
  readonly showFeedViews = input(false);
  /** Which view the host page is currently showing. */
  readonly view = input<FeedView>('feed');
  readonly refresh = output<void>();
  /** A source filter changed; merged feeds need to refetch their active sources. */
  readonly providerVisibilityChanged = output<void>();
  /** The viewer picked a different view of the feed. */
  readonly viewChange = output<FeedView>();

  /** Clicking the active view returns to the feed, so both buttons toggle. */
  protected setView(view: FeedView): void {
    this.viewChange.emit(this.view() === view ? 'feed' : view);
  }

  protected toggleProvider(id: ProviderId): void {
    this.prefs.toggleProvider(id);
    this.providerVisibilityChanged.emit();
  }

  /**
   * Images are effectively hidden when the viewer turned them off OR reader mode
   * is on (reader mode suppresses pictures). The button reflects reality so it
   * never looks inert.
   */
  protected imagesHidden(): boolean {
    return !this.prefs.showImages() || this.prefs.feedReader();
  }

  /**
   * One button, always recoverable: if images are hidden for any reason, reveal
   * them — turning images on AND leaving reader mode (whose whole point is no
   * pictures). Otherwise hide them. This avoids the trap where reader mode
   * silently overrode the images toggle, leaving no obvious way back.
   */
  protected toggleImages(): void {
    if (this.imagesHidden()) {
      this.prefs.setShowImages(true);
      if (this.prefs.feedReader()) {
        this.prefs.setFeedReader(false);
      }
    } else {
      this.prefs.setShowImages(false);
    }
  }
}
