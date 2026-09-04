import { Component, computed, ElementRef, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Router } from '@angular/router';
import { ComposeShareRequest, ShareDialog } from '../../../share-dialog/share-dialog';
import { selectionWithin } from '../../../share-dialog/share-selection';
import { Drafts } from '../../../drafts';
import { Status } from '../../../models';
import { ReaderCore } from '../../read/reader-core/reader-core';

// i18n pages.rss.article.share: Share this ↗
// i18n pages.rss.article.highlightFirst: Highlight a passage first to quote it.

/**
 * An RSS item read inside the split pane.
 *
 * ## What is left here
 *
 * Sharing, and nothing else. Everything about *reading* — fetching the full
 * text, explaining a refusal, paginating, the typography controls — moved to
 * `ReaderCore`, which the reader page also uses. This component is now the
 * pane's local wrapper around it.
 *
 * That is the whole point of the change. This file and the thread page's reader
 * mode were two implementations of the same feature that had quietly drifted:
 * this one paginated and printed the raw diagnosis slug in parentheses
 * ("Couldn't read the full article (bot-check)"); the other explained every
 * diagnosis in a sentence and never paginated at all. Neither was wrong about
 * its own surface; having two was wrong. See
 * `sprint/kindle-1-page-and-shell.md` §1b.
 *
 * ## Why `layout="pane"`
 *
 * The pane is ~700px beside a 290px subscription rail. The core drops its own
 * measure and padding there (the pane already provides both) and hides Exit,
 * because in the pane there is nothing to exit *to* — the pane is the page.
 */
@Component({
  selector: 'app-rss-article',
  imports: [ShareDialog, TranslocoPipe, ReaderCore],
  templateUrl: './rss-article.html',
  styleUrl: './rss-article.css',
})
export class RssArticle {
  private host = inject(ElementRef<HTMLElement>);
  private drafts = inject(Drafts);
  private router = inject(Router);

  readonly status = input.required<Status>();

  /** The core reads a chain; an RSS item is a chain of one. */
  protected readonly chain = computed<Status[]>(() => [this.status()]);

  protected showShare = signal(false);
  protected shareQuote = signal('');

  /**
   * Share what was just read, quoting any highlighted passage.
   *
   * The selection is captured here rather than inside the dialog: opening a
   * modal moves focus and collapses it. This is also the most likely place
   * anyone highlights anything — they have the full article in front of them.
   */
  protected openShare(): void {
    this.shareQuote.set(selectionWithin(this.host.nativeElement));
    this.showShare.set(true);
  }

  /**
   * Park a prefilled draft and send the reader to the composer.
   *
   * There is no composer on this page to open inline, and dropping the request
   * would leave the user with a closed dialog and nothing to show for the
   * destination they just picked. `Drafts.handoff` is the existing mechanism for
   * exactly this — it seeds once and is already filtered through
   * `restorableTarget`, so a target that stopped being usable in between falls
   * back rather than opening an empty picker.
   */
  protected composeShare(request: ComposeShareRequest): void {
    this.drafts.handoff({
      segments: [request.text],
      spoilerText: '',
      sensitive: false,
      visibility: '',
      poll: null,
      target: request.target === 'both' ? 'fedi' : request.target,
    });
    this.showShare.set(false);
    void this.router.navigate(['/write']);
  }
}
