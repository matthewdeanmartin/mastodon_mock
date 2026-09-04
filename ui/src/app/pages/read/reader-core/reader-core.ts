import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslocoService } from '@jsverse/transloco';
import { ClientPrefs } from '../../../client-prefs';
import { toNitterUrl } from '../../../providers/twitter/nitter';
import { serverKnowsStatus } from '../../../providers/provider';
import { DocumentIdentity, ReaderLibrary } from '../../../providers/read/reader-library';
import { isDocument } from '../reader-document';
import { Status } from '../../../models';
import { HumanTimePipe } from '../../../human-time.pipe';
import { PreviewCardComponent } from '../../../preview-card/preview-card';
import { ArticleExpansion } from '../article-expansion';
import { articleTarget } from '../../../providers/article/article-target';
import { renderMarkdown } from '../../../providers/article/markdown-render';
import { paginateMarkdown } from '../../rss/article-pages';
import { ReadToolbar } from '../read-toolbar/read-toolbar';

// i18n reader.article.blocker: Fetching the full text needs a CORS proxy, which isn't set up on this device.
// i18n reader.article.chooseProxy: Choose a proxy
// i18n reader.article.fetch: Fetch article
// i18n reader.article.fetchRest: Fetch the rest
// i18n reader.article.fetching: Fetching article…
// i18n reader.article.fetchingWait: Fetching the article, please wait.
// i18n reader.article.tryAgain: Try again
// i18n reader.article.whatWentWrong: What went wrong?
// i18n reader.article.openHost: Open on {{host}}
// i18n reader.article.readOriginal: Read the original
// i18n reader.article.refetch: Fetch again
// i18n reader.article.collapse: Put it away
// i18n reader.article.from: from {{host}}
// i18n reader.article.wordCount: {{count}} words
// i18n reader.article.quotaExhausted: That's both of today's free articles. Mawkingbird Plus lifts the limit.
// i18n reader.article.quotaOneLeft: One free article left today
// i18n reader.article.expandedLabel: {{title}}
// i18n reader.article.note.partial: Only part of this page came through — the rest may need JavaScript or a subscription.
// i18n reader.article.note.paywall: This publisher requires a subscription to read the article.
// i18n reader.article.note.botCheck: The site asked us to prove we're not a robot, which we can't do from a browser tab.
// i18n reader.article.note.consentWall: The site served a cookie-consent dialog instead of the article.
// i18n reader.article.note.needsJs: This page builds itself with JavaScript, so there's no text to extract.
// i18n reader.article.note.junk: We fetched the page but couldn't find an article in it.
// i18n reader.article.note.notHtml: That link isn't a web page.
// i18n reader.article.note.tooLarge: That page is bigger than the reader will fetch.
// i18n reader.article.note.rateLimited: We've fetched a lot of pages recently. Waiting a moment should fix it.
// i18n reader.article.note.siteRateLimited: The site is rate-limiting readers right now. Waiting may or may not help.
// i18n reader.article.note.siteError: The site answered with an error of its own.
// i18n reader.article.note.notFound: That page is gone.
// i18n reader.article.note.upstreamTimeout: The site accepted the connection and then never answered.
// i18n reader.article.note.blockedDestination: The proxy won't fetch that destination.
// i18n reader.article.note.routeUnavailable: The proxy doesn't recognise the route we asked for — it may be misconfigured.
// i18n reader.article.note.redirectLoop: That link redirects more times than we'll follow.
// i18n reader.article.note.network: We couldn't reach that page at all.
// i18n reader.article.debug.upstream: The site itself refused.
// i18n reader.article.debug.upstreamStatus: The site itself answered {{status}}.
// i18n reader.article.debug.proxy: Our proxy wrote this response.
// i18n reader.article.debug.status: HTTP {{status}}.
// i18n reader.article.debug.textFound: {{count}} words of text found in the document.
// i18n reader.article.debug.previewReadable: Preview metadata was readable.
// i18n reader.article.debug.noPreview: No preview metadata either.
// i18n reader.article.debug.elapsed: Took {{seconds}}s.
// i18n reader.article.debug.url: URL: {{url}}
// i18n reader.core.by: by {{author}}
// i18n reader.core.postCount: {{count}} posts
// i18n reader.core.resumedApproximately: Picking up roughly where you left off — this article has a different number of pages than last time.
// i18n reader.core.readOn.nitter: Read on Nitter
// i18n reader.core.readOn.originalSite: Read on the original site

/**
 * How long a page turn waits before the position is written.
 *
 * Long enough that flipping through five pages is one write, short enough that
 * an ordinary pause between pages commits. The tab-hide flush covers the rest.
 */
const POSITION_SAVE_DELAY_MS = 2_000;

/**
 * One document, rendered for reading.
 *
 * ## What this is
 *
 * The single reading surface. It takes a chain of posts (one long post, a
 * tweetstorm, or an RSS item) and renders it as a document: header, the prose,
 * and — when the post links out to an article and the reader asks — the fetched
 * article below it.
 *
 * It replaces two implementations that had drifted apart: the `@if (readerMode())`
 * block inside `thread.ts`, and `pages/rss/rss-article`. Both called the same
 * extraction pipeline and then disagreed about everything downstream of it —
 * one paginated and one did not, one explained failures in twenty sentences and
 * one printed the diagnosis slug in parentheses. See
 * `sprint/kindle-1-page-and-shell.md` §1b.
 *
 * ## What it does not do
 *
 * Load anything by id (that is `ThreadLoader`), decide what a document is (that
 * is `reader-document.ts`), or own the route. It is given a chain and renders
 * it, which is what lets the RSS pane and the reader page share it without
 * either one pretending to be the other.
 *
 * ## `layout`
 *
 * `page` is the reader route: the full measure, an Exit button, the library.
 * `pane` is the RSS split pane: narrower, no Exit (there is nothing to exit
 * *to* — the pane is the page), and no library sheet, which would cover the
 * subscription rail beside it.
 */
@Component({
  selector: 'app-reader-core',
  imports: [RouterLink, TranslocoPipe, HumanTimePipe, PreviewCardComponent, ReadToolbar],
  templateUrl: './reader-core.html',
  styleUrl: './reader-core.css',
  providers: [ArticleExpansion],
})
export class ReaderCore {
  protected readonly prefs = inject(ClientPrefs);
  protected readonly expansion = inject(ArticleExpansion);
  private readonly transloco = inject(TranslocoService);
  private readonly library = inject(ReaderLibrary);

  /** The author's own chain: one post, or a storm, or an RSS item. */
  readonly chain = input.required<Status[]>();

  /** Where this is being rendered. See the class comment. */
  readonly layout = input<'page' | 'pane'>('page');

  /** Emitted when the reader asks to leave. Only the page acts on it. */
  readonly exit = output<void>();

  /** Whether the library sheet is showing, and the request to toggle it. */
  readonly libraryOpen = input(false);
  readonly toggleLibrary = output<void>();

  /** The article region, so focus can move to it when it appears. */
  private articleRef = viewChild<ElementRef<HTMLElement>>('expandedArticle');

  /** Zero-based index of the page being read. */
  private readonly pageIndex = signal(0);

  protected readonly root = computed<Status | null>(() => this.chain()[0] ?? null);

  protected readonly isRss = computed(() => this.root()?.provider === 'rss');

  /** The URL this document would expand, when the post names exactly one. */
  protected readonly articleUrl = computed(() => {
    const root = this.root();
    return root ? articleTarget(root) : null;
  });

  /**
   * Whether the fetch control is offered at all.
   *
   * Deliberately **not** conditioned on a proxy being configured. It used to be,
   * and that was a silent failure: the proxy selection lives in `localStorage`
   * and does not travel between devices, so the same account on a phone simply
   * had no button and no explanation — indistinguishable from the feature not
   * existing. The section renders and `expansion.blocker` says what is missing.
   */
  protected readonly canExpand = computed(() => this.articleUrl() !== null);

  /**
   * Whether the offered fetch fills in the *rest* of an already-partial RSS
   * item rather than fetching an article from scratch. Purely a label decision.
   */
  protected readonly expandsRssTeaser = computed(() => {
    const root = this.root();
    return root?.provider === 'rss' && root.rssFullContent === false;
  });

  /** The extracted article split into pages, empty until something is fetched. */
  protected readonly pages = computed<string[]>(() => {
    const article = this.expansion.result()?.article;
    if (!article) {
      return [];
    }
    return this.prefs.readerPageFlip() ? paginateMarkdown(article.markdown) : [article.markdown];
  });

  protected readonly pageCount = computed(() => this.pages().length);

  /**
   * How far through, 0 to 1, for the hairline bar under the toolbar.
   *
   * Peripheral information: it should read at a glance without being looked
   * at, which is why it carries no number and no label. Null when there is
   * nothing to report — one page is not progress, it is a page.
   */
  protected readonly progress = computed<number | null>(() => {
    const pages = this.pageCount();
    if (pages < 2 || !this.prefs.readerPageFlip()) {
      return null;
    }
    return (this.pageNumber() - 1) / (pages - 1);
  });

  /** 1-based, for the toolbar. */
  protected readonly pageNumber = computed(() =>
    this.pageCount() ? Math.min(this.pageIndex(), this.pageCount() - 1) + 1 : 0,
  );

  /** The current page, rendered to HTML. */
  protected readonly pageHtml = computed(() => {
    const pages = this.pages();
    if (!pages.length) {
      return null;
    }
    const index = Math.min(this.pageIndex(), pages.length - 1);
    return renderMarkdown(pages[index] ?? '');
  });

  /**
   * Minutes of reading left, or null when it is not worth saying.
   *
   * 240 wpm, fixed. Measuring an individual's pace means timing how long they
   * dwell on each page, which is precisely the reading-history surveillance
   * `article-reading-tally.ts` already declined to build — and the number is
   * decoration, not navigation, so being wrong by a third costs nothing.
   */
  protected readonly minutesLeft = computed<number | null>(() => {
    const pages = this.pages();
    if (pages.length < 2) {
      return null;
    }
    const remaining = pages
      .slice(Math.min(this.pageIndex(), pages.length - 1) + 1)
      .join(' ')
      .trim();
    if (!remaining) {
      return null;
    }
    const minutes = Math.round(remaining.split(/\s+/).length / 240);
    return minutes >= 1 ? minutes : null;
  });

  /**
   * Reset to the first page whenever the document changes.
   *
   * Without this, opening a second, shorter article from page 9 of the first
   * one lands past its end — `pageHtml` clamps, so the reader sees the last
   * page of something they just started.
   */
  /**
   * Take up a new document: shelve it if it qualifies, and resume where the
   * reader left off.
   */
  private readonly onNewDocument = effect(() => {
    const documentId = this.root()?.id ?? '';
    if (documentId === this.lastDocumentId) {
      return;
    }
    this.lastDocumentId = documentId;
    this.pageIndex.set(0);
    this.approximateResume.set(false);
    if (!documentId) {
      return;
    }
    const identity = this.identity();
    if (!identity) {
      return;
    }
    this.library.open(identity);
    // The stored page is applied once the document has actually paginated —
    // `pages()` is empty until an article is fetched. See `restoreIfPending`.
    this.resumePending = this.layout() === 'page';
  });

  /** The document the page index currently belongs to. */
  private lastDocumentId = '';

  /** True until the stored position has been applied to this document. */
  private resumePending = false;

  /** True when the resume landed proportionally rather than exactly. */
  protected readonly approximateResume = signal(false);

  /**
   * How this document is identified in the library.
   *
   * Null when it is not a document — a short post read in the reader is still
   * rendered, it is simply not shelved. The operator's rule, stated plainly:
   * short or never-viewed tweets are never tracked.
   */
  private identity(): DocumentIdentity | null {
    const root = this.root();
    if (!root) {
      return null;
    }
    const result = this.expansion.result();
    const article = result?.article ?? null;
    if (!isDocument(this.chain(), article !== null)) {
      return null;
    }
    return {
      id: root.id,
      url: (article ? result?.finalUrl : root.url) ?? root.url ?? '',
      title: article?.title || this.fallbackTitle(root),
      siteName: article?.siteName ?? (this.expansion.host() || null),
    };
  }

  /**
   * A title for a document that has none of its own.
   *
   * A tweetstorm has no headline; its first sentence is the closest thing, and
   * is what the author would have written as one had the medium had a field
   * for it.
   */
  private fallbackTitle(root: Status): string {
    const text = (root.content ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      return root.url ?? '';
    }
    const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
    return firstSentence.length > 90 ? firstSentence.slice(0, 87) + '\u2026' : firstSentence;
  }

  /**
   * Apply the stored position once the document has pages to apply it to.
   *
   * Split from `onNewDocument` because pagination arrives later: a post's
   * article is fetched on demand, so at the moment the document is taken up
   * there is exactly one page and nothing to restore into.
   */
  private readonly restoreIfPending = effect(() => {
    const pages = this.pageCount();
    if (!this.resumePending || pages < 1) {
      return;
    }
    const identity = this.identity();
    this.resumePending = false;
    if (!identity) {
      return;
    }
    const { page, approximate } = this.library.restorePage(identity.id, pages);
    this.approximateResume.set(approximate && page > 1);
    this.pageIndex.set(page - 1);
  });

  /**
   * Write the position back, at most once every few seconds.
   *
   * A `localStorage` write per arrow press is a synchronous serialization of
   * the whole library on the main thread — and someone paging through a long
   * article presses that arrow a lot. Debounced, and flushed on
   * `visibilitychange`, because a reader who closes the tab mid-article must
   * not lose their position, which is the one thing this feature promises.
   *
   * Never from the pane: reading there shelves the document (reading an article
   * is reading it) but the pane is a preview strip beside a list, not the
   * surface that owns a position.
   */
  private savePosition(): void {
    if (this.layout() === 'pane') {
      return;
    }
    const identity = this.identity();
    if (!identity) {
      return;
    }
    this.pendingSave = { id: identity.id, page: this.pageNumber(), pages: this.pageCount() };
    if (this.saveTimer !== null) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushPosition();
    }, POSITION_SAVE_DELAY_MS);
  }

  private pendingSave: { id: string; page: number; pages: number } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Write any pending position immediately. */
  flushPosition(): void {
    const pending = this.pendingSave;
    this.pendingSave = null;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (pending) {
      this.library.recordPosition(pending.id, pending.page, pending.pages);
    }
  }

  private readonly onHide = (): void => {
    if (document.visibilityState === 'hidden') {
      this.flushPosition();
    }
  };

  constructor() {
    document.addEventListener('visibilitychange', this.onHide);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', this.onHide);
      this.flushPosition();
    });
  }

  prevPage(): void {
    this.pageIndex.update((n) => Math.max(0, n - 1));
    this.savePosition();
  }

  nextPage(): void {
    this.pageIndex.update((n) => Math.min(Math.max(0, this.pageCount() - 1), n + 1));
    this.savePosition();
  }

  /** Jump to a page by 1-based number. Used by the keyboard bindings. */
  goToPage(number: number): void {
    const clamped = Math.min(Math.max(1, number), Math.max(1, this.pageCount()));
    this.pageIndex.set(clamped - 1);
    this.savePosition();
  }

  async expandArticle(force = false): Promise<void> {
    const result = await this.expansion.expand(this.articleUrl(), force);
    if (result?.article) {
      this.pageIndex.set(0);
      this.focusArticle();
    }
  }

  /**
   * Move focus to the article that just appeared.
   *
   * Without this, a keyboard or screen-reader user presses "Fetch article",
   * hears nothing, and is still on a button while several pages of new content
   * have been inserted below them. The region is `tabindex="-1"` so it can take
   * focus programmatically without joining the tab order.
   *
   * A microtask rather than `afterNextRender`: the element does not exist until
   * the signal write above is flushed to the DOM, and a microtask is the
   * smallest thing that reliably lands after it.
   */
  private focusArticle(): void {
    queueMicrotask(() => {
      this.articleRef()?.nativeElement.focus({ preventScroll: false });
    });
  }

  /**
   * The "read it at the source" link, for a document that lives elsewhere.
   *
   * Offered when no server we can talk to knows this post — an RSS item, a
   * tweet, a paste. For those the original site is not a footnote, it is where
   * the thing actually is.
   *
   * `serverKnowsStatus` rather than a provider list, and rather than the
   * capability table: the question here is "does this exist somewhere we can
   * reach", not "may this reader interact with it". A signed-out reader on an
   * ordinary Mastodon post cannot favourite it either, and does not need to be
   * sent off-site to read what is already on screen.
   *
   * Tweets go to Nitter rather than x.com, matching the card toolbar — sending
   * a reader to a login wall is the thing this app exists to avoid. Everything
   * else keeps its own URL, because an RSS item's original site is the whole
   * point of the link.
   */
  protected readonly originalLink = computed<{ url: string; label: string } | null>(() => {
    const post = this.root();
    if (!post || serverKnowsStatus(post.provider)) {
      return null;
    }
    if (post.provider === 'twitter') {
      const url = toNitterUrl(post.url);
      return url ? { url, label: this.transloco.translate('reader.core.readOn.nitter') } : null;
    }
    return post.url
      ? { url: post.url, label: this.transloco.translate('reader.core.readOn.originalSite') }
      : null;
  });

  protected collapseArticle(): void {
    this.expansion.collapse();
    this.pageIndex.set(0);
  }
}
