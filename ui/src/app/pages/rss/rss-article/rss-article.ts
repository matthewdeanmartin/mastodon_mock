import { Component, computed, ElementRef, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { ComposeShareRequest, ShareDialog } from '../../../share-dialog/share-dialog';
import { selectionWithin } from '../../../share-dialog/share-selection';
import { Drafts } from '../../../drafts';
import { ArticleFetch } from '../../../providers/article/article-fetch';
import { ArticleQuota } from '../../../providers/article/article-quota';
import { ArticleReadingTally } from '../../../providers/article/article-reading-tally';
import { ArticleResult } from '../../../providers/article/article-models';
import { articleTarget } from '../../../providers/article/article-target';
import { renderMarkdown } from '../../../providers/article/markdown-render';
import { PageDiagnostics } from '../../../page-diagnostics';
import { Status } from '../../../models';
import { paginateMarkdown } from '../article-pages';

// i18n pages.rss.article.fullTextNeedsProxy: The full text of this item lives on the publisher's site. Fetching it needs a
// i18n pages.rss.article.corsProxy: CORS proxy
// i18n pages.rss.article.quotaReached: That's both of today's free articles. Mawkingbird Plus lifts the limit.
// i18n pages.rss.article.fetching: Fetching article…
// i18n pages.rss.article.fetchFull: 📄 Fetch full article
// i18n pages.rss.article.oneFreeLeft: One free article left today
// i18n pages.rss.article.fetchingPleaseWait: Fetching article, please wait.
// i18n pages.rss.article.couldntRead: Couldn't read the full article ({{diagnosis}}).
// i18n pages.rss.article.openOriginal: Open the original ↗
// i18n pages.rss.article.pages: Article pages
// i18n pages.rss.article.previous: ‹ Previous
// i18n pages.rss.article.pageOf: Page {{page}} of {{total}}
// i18n pages.rss.article.next: Next ›
// i18n pages.rss.article.share: Share this ↗
// i18n pages.rss.article.highlightFirst: Highlight a passage first to quote it.

/**
 * The full text of an RSS item, fetched on demand and shown a page at a time.
 *
 * ## One extraction pipeline, two entry points
 *
 * This does **not** extract anything itself. It calls `ArticleFetch.expand()` —
 * the same call reader mode makes from the thread view — and renders what comes
 * back. A second extractor would be a second set of quality gates, a second
 * cache, and a second thing to fix whenever a publisher changes their markup.
 * The only thing this adds on top is pagination, which is a presentation
 * decision over an already-extracted document (see `article-pages.ts`).
 *
 * ## Quota
 *
 * Spending follows the rule `thread.ts` established, for the same reason: only
 * the caller knows whether an article was actually *rendered*, so a cache hit, a
 * failure, and a page the quality gate rejected all cost nothing. `recordFetch`
 * before the request, `consume` only once `result.article` exists.
 *
 * Offered only for items the feed did not already give in full — `articleTarget`
 * returns null for a `rssFullContent` item, because there is nothing left to
 * fetch and offering the button would re-download text already on screen.
 */
@Component({
  selector: 'app-rss-article',
  imports: [RouterLink, ShareDialog, TranslocoPipe],
  templateUrl: './rss-article.html',
  styleUrl: './rss-article.css',
})
export class RssArticle {
  private articles = inject(ArticleFetch);
  private diagnostics = inject(PageDiagnostics);
  private host = inject(ElementRef<HTMLElement>);
  private drafts = inject(Drafts);
  private router = inject(Router);
  protected quota = inject(ArticleQuota);
  private tally = inject(ArticleReadingTally);

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

  readonly status = input.required<Status>();

  protected readonly expanding = signal(false);
  protected readonly result = signal<ArticleResult | null>(null);
  protected readonly page = signal(0);

  /** The URL to fetch, or null when the feed already gave the whole item. */
  protected readonly target = computed(() => articleTarget(this.status()));

  /** Whether expansion can be offered at all — it needs a CORS proxy. */
  protected readonly available = computed(() => this.articles.available());

  /** The extracted article split into pages. Empty until something is fetched. */
  protected readonly pages = computed(() => {
    const article = this.result()?.article;
    return article ? paginateMarkdown(article.markdown) : [];
  });

  protected readonly pageCount = computed(() => this.pages().length);

  /** The current page, rendered to HTML. */
  protected readonly pageHtml = computed(() => {
    const pages = this.pages();
    const index = Math.min(this.page(), pages.length - 1);
    return index >= 0 && pages[index] !== undefined ? renderMarkdown(pages[index]) : '';
  });

  /** 1-based, for "Page 2 of 5". */
  protected readonly pageNumber = computed(() => Math.min(this.page(), this.pageCount() - 1) + 1);

  protected readonly canPrev = computed(() => this.page() > 0);
  protected readonly canNext = computed(() => this.page() < this.pageCount() - 1);

  /** The failure explanation, when there is one worth showing. */
  protected readonly failure = computed(() => {
    const result = this.result();
    return result && !result.article ? result.diagnosis : null;
  });

  async expand(): Promise<void> {
    const url = this.target();
    if (!url || this.expanding() || !this.quota.allowed()) {
      return;
    }
    this.expanding.set(true);
    try {
      // Entitlement is deliberately not persisted, so it starts false on every
      // reload; settle it before the local counter can refuse a subscriber.
      if (!(await this.quota.authorize())) {
        return;
      }
      this.quota.recordFetch();
      const result = await this.articles.expand(url);
      this.result.set(result);
      this.page.set(0);
      if (result.article) {
        // Only a rendered article costs one of the day's free fetches. Through
        // the tally rather than the quota directly, so a supporter's running
        // total also reaches their account and is the same on their phone.
        this.tally.recordOne();
      }
      this.diagnostics.info('RssPage', 'article:expanded', {
        diagnosis: result.diagnosis,
        rendered: result.article !== null,
        pages: this.pageCount(),
      });
    } finally {
      this.expanding.set(false);
    }
  }

  protected prevPage(): void {
    this.page.update((n) => Math.max(0, n - 1));
  }

  protected nextPage(): void {
    this.page.update((n) => Math.min(this.pageCount() - 1, n + 1));
  }
}
