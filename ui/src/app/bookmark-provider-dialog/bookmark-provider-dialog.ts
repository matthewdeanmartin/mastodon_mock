import { Component, input, output } from '@angular/core';

export type BookmarkChoice = 'mastodon' | 'raindrop-post' | 'raindrop-link';

/** Chooses between native and Raindrop.io bookmark destinations. */
@Component({
  selector: 'app-bookmark-provider-dialog',
  templateUrl: './bookmark-provider-dialog.html',
  styleUrl: './bookmark-provider-dialog.css',
})
export class BookmarkProviderDialog {
  readonly nativeBookmarked = input(false);
  readonly anonymous = input(false);
  readonly externalUrl = input<string | null>(null);
  readonly chosen = output<BookmarkChoice>();
  readonly closed = output<void>();

  protected hostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }
}
