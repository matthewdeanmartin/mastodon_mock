import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslocoService } from '@jsverse/transloco';
import { ClientPrefs } from '../../../client-prefs';
import { toNitterUrl } from '../../../providers/twitter/nitter';
import { serverKnowsStatus } from '../../../providers/provider';
import { DocumentIdentity, ReaderLibrary } from '../../../providers/read/reader-library';
import { documentTitle, isDocument } from '../reader-document';
import { readerRouteId } from '../reader-route-id';
import { Status } from '../../../models';
import { HumanTimePipe } from '../../../human-time.pipe';
import { PreviewCardComponent } from '../../../preview-card/preview-card';
import { ArticleExpansion } from '../article-expansion';
import { articleTarget } from '../../../providers/article/article-target';
import { renderMarkdown } from '../../../providers/article/markdown-render';
import { paginateMarkdown } from '../../rss/article-pages';
import { fitToPages } from '../fit-to-viewport';
import { chainBlocks, PostBlock } from '../post-blocks';
import { documentBlocks } from '../reader-anchor';
import { ReadToolbar } from '../read-toolbar/read-toolbar';
import { DocumentSearchDialog } from '../document-search/document-search-dialog';
import { SearchMatch } from '../document-search';
import { NotesRail, RailNote } from '../notes-rail/notes-rail';
import { SelectionPoint, SelectionTools } from '../selection-tools/selection-tools';
import { markPassages } from '../mark-passages';
import { ReadingTools } from '../reading-tools';

// i18n reader.note.label: Your note on this passage
// i18n reader.note.placeholder: What did you want to remember?
// i18n reader.note.save: Save
// i18n reader.note.cancel: Cancel
// i18n reader.article.blocker: Fetching the full text needs a CORS proxy, which isn't set up on this device.
// i18n reader.article.chooseProxy: Choose a proxy
// i18n reader.article.fetch: Fetch article
// i18n reader.article.fetchRest: Fetch the rest
// i18n reader.article.fetching: Fetching article…
// i18n reader.article.fetchingWait: Fetching the article, please wait.
// i18n reader.article.tryAgain: Try again
// i18n reader.article.tryAnyway: Try anyway
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
 * Breathing room below the last line of a page.
 *
 * Mirrors the reading column's own bottom padding so a page ends the way the
 * document does, rather than with text flush against the edge of the screen.
 */
const READER_PAGE_BOTTOM_GAP = 24;

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
  imports: [
    RouterLink,
    TranslocoPipe,
    FormsModule,
    HumanTimePipe,
    PreviewCardComponent,
    ReadToolbar,
    SelectionTools,
    DocumentSearchDialog,
    NotesRail,
  ],
  templateUrl: './reader-core.html',
  styleUrl: './reader-core.css',
  providers: [ArticleExpansion, ReadingTools],
})
export class ReaderCore {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly prefs = inject(ClientPrefs);
  protected readonly expansion = inject(ArticleExpansion);
  private readonly transloco = inject(TranslocoService);
  private readonly library = inject(ReaderLibrary);
  protected readonly tools = inject(ReadingTools);
  /**
   * Declared with the other injections, above the effect that uses it: class
   * fields initialise in source order, so an `inject` below the effect would be
   * `undefined` at the moment the effect is created.
   */
  private readonly injector = inject(Injector);

  /** The author's own chain: one post, or a storm, or an RSS item. */
  readonly chain = input.required<Status[]>();

  /**
   * The id this document was opened with — the one in the address bar.
   *
   * **The library keys on this, and must not re-derive it.** Rebuilding an id
   * from the loaded status produces a key that need not match the URL it was
   * reached by, and then clicking a library row shelves a *second* entry for a
   * document already on the shelf — reported as the library re-adding the same
   * item over and over. Two ways that happens:
   *
   * - A post read from a server we hold no account on is addressable two ways —
   *   the feed's `anonymous-mastodon:<host>:<id>` and the route's base64 blob —
   *   and `ThreadLoader` accepts both.
   * - When the home server resolves such a post, what comes back is an
   *   **ordinary local status**: a local id, no `anonymous-mastodon` provider,
   *   nothing to rebuild the blob from. After resolution the status in hand is
   *   simply not the status the URL names.
   *
   * Empty only from a host that does not know its route (the RSS pane passes
   * the item id it opened); `readerRouteId` remains the fallback so nothing
   * regresses to shelving a feed id that 404s.
   */
  readonly routeId = input('');

  /** Where this is being rendered. See the class comment. */
  readonly layout = input<'page' | 'pane'>('page');

  /** Emitted when the reader asks to leave. Only the page acts on it. */
  readonly exit = output<void>();

  /** Whether the library sheet is showing, and the request to toggle it. */
  readonly libraryOpen = input(false);
  readonly toggleLibrary = output<void>();

  /**
   * A passage the reader wants to share, as a quote.
   *
   * An output rather than a dialog of its own: the share dialog belongs to the
   * host — the RSS pane already owns one — and two of them on one screen would
   * be two things that could be open at once. The host decides; this only says
   * what was quoted.
   */
  readonly shareQuote = output<string>();

  /** The article region, so focus can move to it when it appears. */
  private articleRef = viewChild<ElementRef<HTMLElement>>('expandedArticle');

  /**
   * The prose itself, which is the container selections are scoped to.
   *
   * Deliberately narrower than `articleRef`: that section also holds the title,
   * the byline and the action row, and a selection dragged across the byline is
   * not a passage from the article.
   */
  private articleBodyRef = viewChild<ElementRef<HTMLElement>>('articleBody');

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
   * What we can say about this URL before spending a fetch on it.
   *
   * Two sources, one answer: the shipped host list and what this device has
   * observed. Deliberately indistinguishable to the reader — see
   * `observed-failures.ts`.
   */
  protected readonly fetchWarning = computed(() => this.expansion.beforeFetch(this.articleUrl()));

  /** False only for the cases no amount of trying fixes, like a PDF. */
  protected readonly fetchWorthTrying = computed(() => this.fetchWarning()?.worthTrying !== false);

  /**
   * Whether the offered fetch fills in the *rest* of an already-partial RSS
   * item rather than fetching an article from scratch. Purely a label decision.
   */
  protected readonly expandsRssTeaser = computed(() => {
    const root = this.root();
    return root?.provider === 'rss' && root.rssFullContent === false;
  });

  /**
   * The height one page has to fit in, measured from the viewport.
   *
   * Re-measured on resize and on any typography change, because every one of
   * those changes what fits. Zero until the first measurement, which
   * `fitToPages` reads as "unmeasured" and answers with a single page.
   */
  private readonly available = signal(0);

  /**
   * The extracted article, split into pages that actually fit the screen.
   *
   * ## Why this is measured rather than counted
   *
   * It used to be `paginateMarkdown`, which slices at ~500 words — "about a
   * screenful and a half" by its own comment. That is the bug the operator
   * found: in page-flip mode the reader still had to scroll, so turning the
   * page bought nothing and the two modes were indistinguishable. A page is not
   * a quantity of words, it is what fits, and what fits depends on the type
   * size, the line height, the measure and the window.
   *
   * `paginateMarkdown` is still the fallback for the first render, before
   * anything has been measured: it gives a sensible shape immediately, and the
   * measured pass replaces it as soon as the browser has laid the blocks out.
   */
  protected readonly pages = computed<string[]>(() => {
    const article = this.expansion.result()?.article;
    if (!article) {
      return [];
    }
    if (!this.prefs.readerPageFlip()) {
      return [article.markdown];
    }
    const measured = this.measuredPages();
    return measured ?? paginateMarkdown(article.markdown);
  });

  /**
   * The document's blocks grouped by what fits, or null before measurement.
   *
   * Depends on `available` and on every typography preference, so changing the
   * type size re-paginates rather than leaving pages sized for the old one.
   */
  private readonly measuredPages = computed<string[] | null>(() => {
    const article = this.expansion.result()?.article;
    const available = this.available();
    const heights = this.blockHeights();
    if (!article || !available || !heights.length) {
      return null;
    }
    const list = documentBlocks(article.markdown).markdown;
    if (heights.length !== list.length) {
      // The measurement is of a different document than the one we are about to
      // slice — a re-fetch landed between the two. Wait for the next pass
      // rather than pairing heights with the wrong blocks.
      return null;
    }
    return fitToPages(
      heights.map((height, index) => ({ index, height })),
      available,
    ).map((page) => page.blocks.map((index) => list[index]).join('\n\n'));
  });

  /** Rendered height of each block, filled in by the measuring pass. */
  private readonly blockHeights = signal<number[]>([]);

  /** Rendered height of each post in the chain, from the same pass. */
  private readonly postHeights = signal<number[]>([]);

  /** The room a page of *posts* has, which is not the room the article has. */
  private readonly chainAvailable = signal(0);

  /**
   * The posts on the current page, when the chain itself paginates.
   *
   * ## Why the chain needs pages at all
   *
   * This is the case the epic exists for — "a Kindle app for tweetstorms" — and
   * it was the one page mode never covered. `pages()` is derived from the
   * *fetched article*, so a storm with nothing to fetch had zero pages, no
   * controls, and page mode was indistinguishable from scrolling. A forty-post
   * storm is exactly the document someone wants to turn pages through.
   *
   * A post is the unit, never split: posts were written as separate things and
   * a page break between two of them is a seam the author already put there.
   */
  /** Every block of every post, which is the unit a page is built from. */
  protected readonly chainBlockList = computed<PostBlock[]>(() => chainBlocks(this.chain()));

  /**
   * The chain's blocks grouped into pages that fit.
   *
   * **A block, not a post.** Paginating post-by-post works for a tweetstorm and
   * does nothing for a single long tweet — one post is one unit, so it lands on
   * one page and that page is as tall as the post. A paragraph is the unit that
   * makes both cases work, and it is the same unit the article pagination and
   * the highlight anchors already use.
   */
  protected readonly postPages = computed<PostBlock[][]>(() => {
    const blocks = this.chainBlockList();
    if (!this.prefs.readerPageFlip() || blocks.length < 2) {
      return [blocks];
    }
    const heights = this.postHeights();
    const available = this.chainAvailable();
    if (!available || heights.length !== blocks.length) {
      return [blocks];
    }
    return fitToPages(
      heights.map((height, index) => ({ index, height })),
      available,
    ).map((page) => page.blocks.map((index) => blocks[index]));
  });

  /** The blocks to render right now. */
  protected readonly visibleBlocks = computed<PostBlock[]>(() => {
    const pages = this.postPages();
    if (pages.length < 2) {
      return pages[0] ?? [];
    }
    return pages[Math.min(this.pageIndex(), pages.length - 1)] ?? [];
  });

  /**
   * Media for the posts represented on this page.
   *
   * Attached to the page its post's *last* block falls on, so a picture arrives
   * after the words that introduce it rather than on the page where the post
   * happened to start.
   */
  protected readonly visibleMedia = computed(() => {
    const all = this.chainBlockList();
    const visible = this.visibleBlocks();
    const chain = this.chain();
    // A post's media belongs on the page holding its last block: a picture
    // should arrive after the words that introduce it, not on the page where
    // the post happened to begin.
    return chain.flatMap((status, post) => {
      const lastBlock = all.filter((block) => block.post === post).at(-1);
      const ends = lastBlock ? visible.includes(lastBlock) : false;
      // A post with no blocks at all (media-only) rides with whatever page its
      // neighbours put it on; showing it once beats never showing it.
      const mediaOnly = !lastBlock && visible.length > 0 && post === chain.length - 1;
      return ends || mediaOnly ? (status.media_attachments ?? []) : [];
    });
  });

  /**
   * How many pages this document has.
   *
   * The article's, when one was fetched. Otherwise the chain's — which is what
   * makes page mode work on a tweetstorm, the document this reader was built
   * for. Never both: an article replaces the chain as the thing being read.
   */
  protected readonly pageCount = computed(() =>
    this.pages().length ? this.pages().length : this.postPages().length,
  );

  /**
   * How many pages the document came out as.
   *
   * Exposed for tests: jsdom has no layout, so a spec cannot reach the measured
   * pagination through the DOM and has to ask.
   */
  pageCountForTest(): number {
    return this.pageCount();
  }

  /** Whether the page-turn affordances belong on screen at all. */
  protected readonly paging = computed(() => this.prefs.readerPageFlip() && this.pageCount() > 1);

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

  /**
   * The current page, rendered to HTML and marked.
   *
   * Marking happens here, over the renderer's output, because that output is
   * the safe HTML — see `mark-passages.ts` for why wrapping DOM nodes rather
   * than building markup is what keeps it safe.
   */
  protected readonly pageHtml = computed(() => {
    const pages = this.pages();
    if (!pages.length) {
      return null;
    }
    const index = Math.min(this.pageIndex(), pages.length - 1);
    const rendered = renderMarkdown(pages[index] ?? '');
    return markPassages(rendered, this.tools.intactQuotes(), this.tools.markedText());
  });

  /**
   * Keep the reading tools pointed at the document on screen.
   *
   * The tools need the *source* markdown (anchors index into it) and the page
   * slices (so a highlight's page is a lookup). Both change when an article is
   * fetched or the type size changes the pagination.
   */
  private readonly feedTools = effect(() => {
    const article = this.expansion.result()?.article;
    this.tools.setDocument(this.documentKey(), article?.markdown ?? '', this.pages());
  });

  /** The key annotations are stored under: the id this document was opened with. */
  private readonly documentKey = computed(() => {
    const root = this.root();
    return this.routeId() || (root ? readerRouteId(root) : '');
  });

  /** Notes for the rail, which only appears when something is written in it. */
  protected readonly railNotes = computed(() => (this.tools.hasNotes() ? this.tools.notes() : []));

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
    // ReaderCore now stays mounted while the library loads the next document.
    // Its per-document article state therefore has to be cleared explicitly
    // when the replacement lands; previously destruction did this by accident.
    this.expansion.collapse();
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
      // The id the address bar actually holds. Only when a host cannot supply
      // one do we derive it — see `reader-route-id.ts` for why `Status.id` is
      // not always the answer, and `routeId` for why deriving it is not either.
      id: this.routeId() || readerRouteId(root),
      url: (article ? result?.finalUrl : root.url) ?? root.url ?? '',
      title: article?.title || documentTitle(root),
      siteName: article?.siteName ?? (this.expansion.host() || null),
    };
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

  /**
   * Keyboard selection, caught at the document.
   *
   * Not a `(keyup)` on the article body: prose is a selection surface, not a
   * control, and giving it a key handler would mean giving it a tab stop —
   * putting a focusable element with no purpose in front of every reader who
   * navigates by keyboard. Shift+arrow selection still has to raise the tools,
   * so the listener lives here and checks that the selection is inside the body
   * before doing anything.
   */
  /**
   * Read the selection after a pointer gesture.
   *
   * At the document rather than on the body, for the same reason as
   * `onSelectionKey`: prose is a selection surface, not a control, and an
   * element with interaction handlers is one that ought to be focusable. The
   * container passed to `selectionWithin` is still the **article body** — a
   * selection in the notes rail must not become a quote from the article, which
   * is the trap `share-selection.ts` exists to document.
   */
  private readonly onSelectionPointer = (event: MouseEvent): void => {
    const body = this.articleBodyRef()?.nativeElement;
    if (!body) {
      return;
    }
    this.tools.captureSelection(body, this.selectionPoint(body, event));
  };

  private readonly onSelectionKey = (event: KeyboardEvent): void => {
    if (!event.shiftKey && event.key !== 'Escape') {
      return;
    }
    const body = this.articleBodyRef()?.nativeElement;
    if (!body) {
      return;
    }
    if (event.key === 'Escape') {
      this.tools.dismiss();
      return;
    }
    this.tools.captureSelection(body, this.selectionPoint(body, event));
  };

  /**
   * Measure one page's worth of room, and how tall each block renders in it.
   *
   * ## Why it measures offscreen rather than the live page
   *
   * The live body only ever holds the *current* page, so measuring it would
   * tell us about the blocks we already decided to show — circular. Instead the
   * whole document is rendered into a hidden element that inherits the reading
   * column's width and typography, every block is measured there, and the
   * result decides the pagination. The element is `visibility: hidden` rather
   * than `display: none` because a `display: none` subtree has no layout and
   * every height comes back zero.
   */
  private readonly measure = (): void => {
    this.measureChain();
    const body = this.articleBodyRef()?.nativeElement;
    const gauge = this.gaugeRef()?.nativeElement;
    if (!body || !gauge) {
      return;
    }
    // What is left of the window once the toolbar and the column's own padding
    // have taken their share. `getBoundingClientRect().top` is where the prose
    // actually starts, which accounts for the header, the byline and anything
    // else above it without this needing to know they exist.
    const available = this.roomBelow(body);

    const heights = [...gauge.children].map((child) => {
      const rect = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      // Margins count: they are the space between paragraphs, and a page fitted
      // without them overflows by exactly the gaps it ignored.
      return rect.height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    });

    // Only write when something actually changed. The measurement runs after
    // every render, and a write with the same values would schedule another
    // render that measures again — a loop that never settles, and in dev mode
    // an `ExpressionChangedAfterItHasBeenChecked` on the first turn of it.
    if (this.available() !== available) {
      this.available.set(available);
    }
    const previous = this.blockHeights();
    if (
      previous.length !== heights.length ||
      heights.some((height, index) => Math.abs(height - previous[index]) > 0.5)
    ) {
      this.blockHeights.set(heights);
    }
  };

  /**
   * The same measurement for the post chain.
   *
   * Separate because the two can be on screen at once — a post that links to an
   * article shows both — and because the room available differs: the posts
   * start higher up the column than the article does.
   */
  private measureChain(): void {
    const body = this.postBodyRef()?.nativeElement;
    const gauge = this.postGaugeRef()?.nativeElement;
    if (!body || !gauge) {
      return;
    }
    const available = this.roomBelow(body);
    const heights = [...gauge.children].map((child) => {
      const rect = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      return rect.height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    });
    // Its own height signal, not `available`: the posts and the article start at
    // different points down the column and can be on screen together, so one
    // shared number would be whichever measurement ran last.
    if (this.chainAvailable() !== available) {
      this.chainAvailable.set(available);
    }
    const previous = this.postHeights();
    if (
      previous.length !== heights.length ||
      heights.some((height, index) => Math.abs(height - previous[index]) > 0.5)
    ) {
      this.postHeights.set(heights);
    }
  }

  /**
   * How much room a page of this element has, independent of scroll position.
   *
   * `getBoundingClientRect().top` is relative to the **viewport**, so on a
   * scrolled page it goes negative and `viewport - top` comes out larger than
   * the screen — pages then grow the further down you are, which is one of the
   * two reasons page mode still overflowed. Adding the scroll offset back
   * converts it to a document coordinate, and subtracting the scroll position
   * gives where the element sits on screen *when the page is at the top*, which
   * is where a page turn always leaves it.
   */
  private roomBelow(element: HTMLElement): number {
    const viewport = window.innerHeight || 0;
    const host = this.host.nativeElement;
    const article = this.articleRef()?.nativeElement;
    const isArticle = element === this.articleBodyRef()?.nativeElement && article !== undefined;
    const anchor = isArticle ? article : host;
    const contentOffset = Math.max(
      0,
      element.getBoundingClientRect().top - anchor.getBoundingClientRect().top,
    );

    // A page is measured for the position a page turn actually puts it in, not
    // for wherever its RSS row happens to sit in a long feed. The shell header
    // remains visible in the RSS pane; the full-page reader hides it. An
    // expanded article is itself the page anchor, so its sticky reader toolbar
    // also occupies the top of the viewport.
    const shellHeight =
      this.layout() === 'pane'
        ? (document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().height ?? 0)
        : 0;
    const toolbarHeight = isArticle
      ? ((host.querySelector('.read-toolbar-outer') as HTMLElement | null)?.getBoundingClientRect()
          .height ?? 0)
      : 0;
    // The bottom breathing room mirrors the column's own padding, so the last
    // line of a page is not flush against the edge of the screen.
    return Math.max(
      0,
      viewport - shellHeight - toolbarHeight - contentOffset - READER_PAGE_BOTTOM_GAP,
    );
  }

  /** The hidden element the whole document is laid out in, for measuring. */
  private gaugeRef = viewChild<ElementRef<HTMLElement>>('gauge');

  /** The same, for the post chain. */
  private postGaugeRef = viewChild<ElementRef<HTMLElement>>('postGauge');

  /** Where the posts render, so the room left for them can be measured. */
  private postBodyRef = viewChild<ElementRef<HTMLElement>>('postBody');

  /** Whether the chain is worth measuring: any multi-block document can paginate. */
  protected readonly chainGauge = computed(
    () => this.prefs.readerPageFlip() && this.chainBlockList().length > 1,
  );

  /** The whole document as HTML, for the gauge only. Never shown to anyone. */
  protected readonly gaugeHtml = computed(() => {
    const article = this.expansion.result()?.article;
    if (!article || !this.prefs.readerPageFlip()) {
      return null;
    }
    return documentBlocks(article.markdown)
      .markdown.map((block) => renderMarkdown(block))
      .join('');
  });

  /**
   * Re-measure whenever anything that changes what fits changes.
   *
   * Every typography preference is read so the effect depends on it: a reader
   * who presses `A+` must get pages sized for the new type, not the old.
   */
  private readonly remeasure = effect(() => {
    // Read the dependencies explicitly; the measurement itself is imperative.
    this.gaugeHtml();
    this.chainGauge();
    this.chain();
    this.prefs.readerFontSize();
    this.prefs.readerFontFamily();
    this.prefs.readerLineHeight();
    this.prefs.readerLetterSpacing();
    this.prefs.readerWordSpacing();
    this.prefs.readerPageFlip();
    this.libraryOpen();
    // After the browser has laid the gauge out, not during this tick.
    afterNextRender(
      () => {
        this.observeGauges();
        this.measure();
      },
      { injector: this.injector },
    );
  });

  /**
   * Images and web fonts can change a gauge after its first render. Observe its
   * actual box so that late layout does not silently make a fitted page taller
   * than the viewport.
   */
  private readonly gaugeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.measure());

  private observeGauges(): void {
    this.gaugeObserver?.disconnect();
    const article = this.gaugeRef()?.nativeElement;
    const posts = this.postGaugeRef()?.nativeElement;
    if (article) {
      this.gaugeObserver?.observe(article);
    }
    if (posts) {
      this.gaugeObserver?.observe(posts);
    }
  }

  constructor() {
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('resize', this.measure);
    document.addEventListener('keyup', this.onSelectionKey);
    document.addEventListener('mouseup', this.onSelectionPointer);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', this.onHide);
      window.removeEventListener('resize', this.measure);
      document.removeEventListener('keyup', this.onSelectionKey);
      document.removeEventListener('mouseup', this.onSelectionPointer);
      this.gaugeObserver?.disconnect();
      this.flushPosition();
    });
  }

  prevPage(): void {
    this.turnTo(this.pageIndex() - 1);
  }

  nextPage(): void {
    this.turnTo(this.pageIndex() + 1);
  }

  /** Jump to a page by 1-based number. Used by the keyboard bindings. */
  goToPage(number: number): void {
    this.turnTo(Math.min(Math.max(1, number), Math.max(1, this.pageCount())) - 1);
  }

  /**
   * Every page turn goes through here.
   *
   * Because every page turn has to dismiss the selection popover. It is
   * anchored to coordinates in the page that just left, so leaving it up points
   * it at whatever happens to be there now — and a stale popover whose buttons
   * still work would highlight the wrong passage.
   */
  private turnTo(index: number): void {
    this.tools.dismiss();
    this.tools.markedText.set('');
    this.pageIndex.set(Math.min(Math.max(0, index), Math.max(0, this.pageCount() - 1)));
    this.savePosition();
    // A page turn puts you at the top of the new page. Without this the reader
    // keeps whatever scroll position the last page left them at, so page two
    // opens halfway down — and the measurement, which assumes a page starts at
    // the top, would be describing a layout nobody is looking at.
    if (typeof window !== 'undefined') {
      this.scrollToPageStart();
    }
  }

  /** Put the page at the same viewport position it was measured for. */
  private scrollToPageStart(): void {
    const article = this.expansion.result()?.article ? this.articleRef()?.nativeElement : null;
    const anchor = article ?? this.host.nativeElement;
    const shellHeight =
      this.layout() === 'pane'
        ? (document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().height ?? 0)
        : 0;
    const toolbarHeight = article
      ? ((
          this.host.nativeElement.querySelector('.read-toolbar-outer') as HTMLElement | null
        )?.getBoundingClientRect().height ?? 0)
      : 0;
    const top = window.scrollY + anchor.getBoundingClientRect().top - shellHeight - toolbarHeight;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior });
  }

  /**
   * Where to put the popover: centred over the selection, in coordinates
   * relative to the article body, which is the positioned ancestor.
   */
  private selectionPoint(body: HTMLElement, event: MouseEvent | KeyboardEvent): SelectionPoint {
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    const container = body.getBoundingClientRect();
    if (selection && selection.rangeCount) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width || rect.height) {
        return {
          x: rect.left + rect.width / 2 - container.left,
          y: rect.top - container.top,
        };
      }
    }
    // No measurable rect — jsdom, or a keyboard selection. Fall back to the
    // pointer when there is one, and to the top of the body when there is not.
    const fallbackX = event instanceof MouseEvent ? event.clientX - container.left : 0;
    const fallbackY = event instanceof MouseEvent ? event.clientY - container.top : 0;
    return { x: fallbackX, y: fallbackY };
  }

  /**
   * Open the configured dictionary in a new tab.
   *
   * `noopener` because we are handing a tab to a third-party site and it has no
   * business reaching back into this one.
   */
  protected define(word: string): void {
    const url = this.tools.defineUrl(word);
    this.tools.dismiss();
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  /** Whether Ctrl/Cmd+F should be taken over. See {@link openSearch}. */
  canSearch(): boolean {
    return this.pageCount() > 1;
  }

  /**
   * Open in-document search.
   *
   * Only offered when the document actually paginated: on a single page the
   * browser's own find is strictly better than ours — it marks every hit live
   * and it is the tool the reader already knows — and taking it away would be
   * hostile for no gain.
   */
  openSearch(): void {
    if (!this.canSearch()) {
      return;
    }
    this.tools.dismiss();
    this.tools.searchOpen.set(true);
  }

  /** Go to a match: turn to its page, then mark it there. */
  protected goToMatch(match: SearchMatch): void {
    this.tools.searchOpen.set(false);
    this.turnTo(match.page - 1);
    this.tools.markedText.set(match.text);
  }

  /** Go to a note's passage from the rail. */
  protected goToNote(note: RailNote): void {
    if (note.page === null) {
      return;
    }
    this.turnTo(note.page - 1);
  }

  /** Open or close in-document search from the toolbar. */
  protected toggleSearch(): void {
    if (this.tools.searchOpen()) {
      this.tools.searchOpen.set(false);
      return;
    }
    this.openSearch();
  }

  /**
   * Share the selected passage.
   *
   * The selection is read *before* anything else happens, because opening a
   * dialog moves focus and collapses it — the trap `share-selection.ts` exists
   * to document. Here the text is already captured in `tools.selection`, so the
   * ordering is safe by construction rather than by care.
   */
  protected shareSelection(): void {
    const quote = this.tools.selection().trim();
    this.tools.dismiss();
    if (quote) {
      this.shareQuote.emit(quote);
    }
  }

  /** Share a note's passage from the rail, quoting what it was made on. */
  protected shareNote(note: RailNote): void {
    this.shareQuote.emit(note.annotation.anchor.quote);
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
      // The first fetched page follows the same positioning contract as every
      // later page turn. Native focus scrolling only makes the region visible;
      // it does not account for either sticky toolbar.
      this.scrollToPageStart();
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
