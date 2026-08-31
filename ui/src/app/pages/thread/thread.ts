import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../api';
import { Auth } from '../../auth';
import { Terminology } from '../../terminology';
import {
  ClientPrefs,
  ReaderFontFamily,
  ReaderTheme,
  READER_FONT_OPTIONS,
} from '../../client-prefs';
import { Account, Status } from '../../models';
import { Compose } from '../../compose/compose';
import { StatusCard } from '../../status-card/status-card';
import { HumanTimePipe } from '../../human-time.pipe';
import { readerChain } from './reader-chain';
import { ReadingZen } from '../../reading-zen';
import { BlueskyApi } from '../../providers/bluesky/bluesky-api';
import { BlueskySession } from '../../providers/bluesky/bluesky-session';
import { adaptPost } from '../../providers/bluesky/bluesky-adapter';
import { BskyRef, BskyThreadNode } from '../../providers/bluesky/bluesky-types';
import { BskyReply } from '../../providers/bluesky/bluesky-reply';
import { StatusActions } from '../../providers/status-actions';
import { serverKnowsStatus, capabilitiesFor } from '../../providers/provider';
import { RssProvider } from '../../providers/rss/rss-provider';
import { TwitterApi } from '../../providers/twitter/twitter-api';
import { TwitterFeed } from '../../providers/twitter/twitter-feed';
import { nitterHost, toNitterUrl } from '../../providers/twitter/nitter';
import { Subscription } from 'rxjs';
import { AnonymousPublicApi } from '../../providers/anonymous/anonymous-public-api';
import {
  AnonymousPublicRef,
  parseAnonymousStatusRouteRef,
} from '../../providers/anonymous/anonymous-route-ref';
import { AnonymousBookmarks } from '../../providers/anonymous/anonymous-bookmarks';
import { ElizaService } from '../../eliza/eliza.service';
import { LocalPostStore } from '../../eliza/local-post-store';
import { LocalCompose } from '../../eliza/local-compose';
import { isElizaId } from '../../eliza/eliza-identity';
import { messageStatus, parseMessageStatusRouteRef } from '../../providers/paste/message-payload';

import { ArticleFetch } from '../../providers/article/article-fetch';
import { ArticleQuota } from '../../providers/article/article-quota';
import { ArticleReadingTally } from '../../providers/article/article-reading-tally';
import { articleTarget, outboundLinks } from '../../providers/article/article-target';
import { ArticleDiagnosis, ArticleResult } from '../../providers/article/article-models';
import { renderMarkdown } from '../../providers/article/markdown-render';
import { PreviewCardComponent } from '../../preview-card/preview-card';
import { PageDiagnostics } from '../../page-diagnostics';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

// i18n pages.thread.loading: Loading…
// i18n pages.thread.reader.smallerText: Smaller text
// i18n pages.thread.reader.largerText: Larger text
// i18n pages.thread.reader.fontSize: {{size}}px
// i18n pages.thread.reader.fontFamily: Font family
// i18n pages.thread.reader.articleTheme: Article theme
// i18n pages.thread.reader.articleThemeTitle: Article theme — colours this article only
// i18n pages.thread.reader.theme.matchApp: Match app
// i18n pages.thread.reader.theme.light: Light
// i18n pages.thread.reader.theme.sepia: Sepia
// i18n pages.thread.reader.theme.dark: Dark
// i18n pages.thread.reader.theme.solarized: Solarized
// i18n pages.thread.reader.viewAsThread: View as thread
// i18n pages.thread.reader.exit: Exit reader
// i18n pages.thread.reader.withCount: Reader ({{count}} {{posts}})
// i18n pages.thread.reader.reader: Reader
// i18n pages.thread.reader.postCount: {{count}} {{posts}}
// i18n pages.thread.rss.return: ← Return to RSS reader
// i18n pages.thread.chat.continueTitle: Continue this conversation in chat
// i18n pages.thread.chat.open: Open in chat
// i18n pages.thread.chat.unavailableTitle: Chat is only available for a two-person thread (you and one other)
// i18n pages.thread.article.chooseProxy: Choose a proxy
// i18n pages.thread.article.whatWentWrong: What went wrong?
// i18n pages.thread.article.openHost: Open {{host}}
// i18n pages.thread.article.tryAgain: Try again
// i18n pages.thread.article.fetching: Fetching article…
// i18n pages.thread.article.fetchRest: Fetch rest of article
// i18n pages.thread.article.fetch: Fetch article
// i18n pages.thread.article.fetchingWait: Fetching article, please wait.
// i18n pages.thread.article.quotaExhausted: That's both of today's free articles. Mawkingbird Plus lifts the limit — or come back tomorrow.
// i18n pages.thread.article.quotaOneLeft: One free article left today
// i18n pages.thread.bookmark.bookmarked: Bookmarked
// i18n pages.thread.bookmark.bookmark: Bookmark
// i18n pages.thread.reply.title: Reply
// i18n pages.thread.actions.undoFavourite: Undo favourite
// i18n pages.thread.actions.favourite: Favourite
// i18n pages.thread.actions.removeBookmark: Remove bookmark
// i18n pages.thread.actions.bookmark: Bookmark
// i18n pages.thread.reply.placeholder: Post your reply
// i18n pages.thread.article.expandedLabel: Expanded article: {{title}}
// i18n pages.thread.article.expandedFrom: Expanded from {{host}}
// i18n pages.thread.article.wordCount: {{count}} words
// i18n pages.thread.article.collapse: Collapse article
// i18n pages.thread.article.refetch: Re-fetch
// i18n pages.thread.article.readOriginal: Read on the original site
// i18n pages.thread.comments.one: {{count}} comment
// i18n pages.thread.comments.other: {{count}} comments
// i18n pages.thread.comments.loading: Loading comments…
// i18n pages.thread.comments.loadFailed: Comments couldn't be loaded from this feed. Read and join the discussion on the original site.
// i18n pages.thread.comments.noFeed: This feed doesn't publish comments. Read the discussion on the original site.
// i18n pages.thread.anonymous.contextUnavailable: This server did not make the surrounding conversation available anonymously. The post is still readable below.
// i18n pages.thread.anonymous.openOriginal: Open the original
// i18n pages.thread.twitter.repliesOnly: Replies only — Mawkingbird cannot post to Twitter.
// i18n pages.thread.twitter.readConversation: Read the full conversation on {{host}}
// i18n pages.thread.error.openOriginal: Open the original post
// i18n pages.thread.error.home: Go to your home feed
// i18n pages.thread.error.notFound: Status not found.
// i18n pages.thread.article.expansionBlocker: Article expansion needs a CORS proxy. Choose one in Settings › Connections.
// i18n pages.thread.article.note.partial: This may be only part of the article — open the original if it stops short.
// i18n pages.thread.article.note.paywall: This publisher asks for a subscription, so only the opening is readable here.
// i18n pages.thread.article.note.botCheck: This site refuses automated requests. Opening it directly should work.
// i18n pages.thread.article.note.consentWall: This site served a cookie notice instead of the article.
// i18n pages.thread.article.note.needsJs: This page builds itself with JavaScript, so there is nothing to read yet.
// i18n pages.thread.article.note.junk: Couldn't find an article on this page — it may be a homepage or an index.
// i18n pages.thread.article.note.notHtml: This link is a file rather than a web page.
// i18n pages.thread.article.note.tooLarge: This page is too big to expand. Open it on the original site.
// i18n pages.thread.article.note.rateLimited: Too many requests through the shared proxy. Try again in a minute.
// i18n pages.thread.article.note.siteRateLimited: This site is limiting how often it will answer. Try again later.
// i18n pages.thread.article.note.siteError: This site answered with an error of its own. It may be having trouble.
// i18n pages.thread.article.note.notFound: This page is gone — the link may be broken or the post removed.
// i18n pages.thread.article.note.upstreamTimeout: This site took too long to answer.
// i18n pages.thread.article.note.blockedDestination: This address can't be fetched.
// i18n pages.thread.article.note.routeUnavailable: The article service is unavailable. Try again shortly.
// i18n pages.thread.article.note.redirectLoop: This link redirects in a loop and never arrives anywhere.
// i18n pages.thread.article.note.network: Couldn't reach this page. It may be down, or you may be offline.
// i18n pages.thread.article.debug.upstream: The site answered.
// i18n pages.thread.article.debug.upstreamStatus: The site answered (HTTP {{status}}).
// i18n pages.thread.article.debug.proxy: The proxy refused this before contacting the site.
// i18n pages.thread.article.debug.status: HTTP status: {{status}}
// i18n pages.thread.article.debug.textFound: Text found on the page: {{count}} words
// i18n pages.thread.article.debug.previewReadable: Link preview data was readable.
// i18n pages.thread.article.debug.noPreview: No link preview data.
// i18n pages.thread.article.debug.elapsed: Took {{seconds}}s
// i18n pages.thread.article.debug.url: URL: {{url}}
// i18n pages.thread.actions.like: like this post
// i18n pages.thread.actions.repost: repost this post
// i18n pages.thread.actions.bookmarkPost: bookmark this post
// i18n pages.thread.actions.failureBluesky: Couldn't {{action}} on Bluesky — your link may have expired. Re-link in Settings → Connections.
// i18n pages.thread.actions.failureMastodon: Couldn't {{action}} on Mastodon — try again.
// i18n pages.thread.error.postNotOnServer: This post isn’t on the server you’re browsing. Post links only work on the server that hosts them.
// i18n pages.thread.error.loadPost: Could not load this post.
// i18n pages.thread.twitter.loadPost: Could not load this post.
// i18n pages.thread.twitter.loadReplies: Could not load replies.
// i18n pages.thread.readerOriginal.nitter: Read on Nitter
// i18n pages.thread.readerOriginal.originalSite: Read on the original site
/**
 * How many times "Try again" may re-fetch one article.
 *
 * A failure is never edge-cached (a cached refusal would strand a reader past a
 * transient one), so each forced retry is a full origin round trip. Two is
 * enough for the genuinely intermittent case and few enough that a permanently
 * refusing site stops being asked.
 */
const MAX_MANUAL_RETRIES = 2;

/** A hostname safe for diagnostics even when an RSS item carries a malformed URL. */
function hostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-thread',
  imports: [
    StatusCard,
    Compose,
    BskyReply,
    HumanTimePipe,
    RouterLink,
    LocalCompose,
    PreviewCardComponent,
    TranslocoPipe,
  ],
  templateUrl: './thread.html',
  styleUrl: './thread.css',
})
export class Thread implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private bsky = inject(BlueskyApi);
  private bskySession = inject(BlueskySession);
  private rss = inject(RssProvider);
  private twitterApi = inject(TwitterApi);
  private twitterFeed = inject(TwitterFeed);
  private anonymousPublic = inject(AnonymousPublicApi);
  private anonymousBookmarks = inject(AnonymousBookmarks);
  private eliza = inject(ElizaService);
  private localPosts = inject(LocalPostStore);
  private actions = inject(StatusActions);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private log = inject(PageDiagnostics);
  private readingZen = inject(ReadingZen);
  private transloco = inject(TranslocoService);
  private loadSub = new Subscription();
  protected readonly readerFonts = READER_FONT_OPTIONS;

  protected readonly prefs = inject(ClientPrefs);
  protected words = inject(Terminology).words;

  protected status = signal<Status | null>(null);
  protected ancestors = signal<Status[]>([]);
  protected descendants = signal<Status[]>([]);
  protected loading = signal(true);
  /** Why the post could not be loaded, when it could not be. */
  protected loadError = signal<string | null>(null);
  protected isAnonymousPublic = signal(false);
  /** True while viewing a message serialized into the URL: a synthetic, read-only
   *  post with no network identity — no replies, boosts, favourites or bookmarks. */
  protected isMessageStatus = signal(false);
  /** Reader-mode action failures belong beside the controls that caused them. */
  protected readerActionError = signal<string | null>(null);
  protected publicContextUnavailable = signal(false);
  protected publicOriginalUrl = signal<string | null>(null);

  /** Reader mode: distraction-free article view of the author's own chain. */
  protected readerMode = signal(false);
  /** Releases this page's hold on the rails. Non-null exactly while reader mode is on. */
  private releaseZen: (() => void) | null = null;

  /** True while viewing an RSS article: interactions are read-only, comments come from a feed. */
  protected isRss = signal(false);
  /**
   * The feed this RSS item came from, so the reader can go back to it.
   *
   * Without this, leaving an article stranded the reader on the thread page —
   * which looks like a timeline and has no route back to `/rss`. Returning to
   * the *specific* feed rather than the pane's default keeps their place.
   */
  protected rssFeedUrl = signal<string | null>(null);
  /** True when this thread is a tweet and its replies. */
  protected isTwitter = signal(false);
  /** Why the X replies could not be loaded, if they could not. */
  protected twitterError = signal<string | null>(null);
  /** Whether the RSS item declared a comment feed we could load (informs the empty state). */
  protected rssHasCommentFeed = signal(false);
  /** True once a declared RSS comment feed came back empty or failed to load. */
  protected rssCommentsUnavailable = signal(false);

  /**
   * The conversation on Nitter, when this is a Twitter thread.
   *
   * Ancestors are deliberately not fetched (one request per level, unknown
   * depth), so this is how a reader reaches the rest of the conversation — and
   * it is free, because it leaves the app.
   */
  /** The mirror's host, so the link names where it actually goes. */
  protected nitterLabel = nitterHost();

  protected nitterThreadUrl = computed(() => {
    const status = this.status();
    return this.isTwitter() && status ? toNitterUrl(status.url) : null;
  });

  /** The whole thread in display order. */
  private thread = computed<Status[]>(() => {
    const s = this.status();
    return s ? [...this.ancestors(), s, ...this.descendants()] : [];
  });

  /** The author chain reader mode renders (root post + same-author self-replies). */
  protected chain = computed<Status[]>(() => readerChain(this.thread()));

  // ---- Article expansion -------------------------------------------------
  //
  // Reader mode can pull the linked article in and render it below the post, so
  // a "here is my new blog post" link becomes something readable without
  // leaving for a page of newsletter popups. Deliberately per-thread and
  // manual: nobody wants their whole feed expanded, and each expansion is a
  // fetch of a third-party page.

  private articles = inject(ArticleFetch);
  protected quota = inject(ArticleQuota);
  private tally = inject(ArticleReadingTally);

  /** The URL reader mode would expand, when the post names exactly one. */
  protected articleUrl = computed(() => {
    const root = this.chain()[0];
    return root ? articleTarget(root) : null;
  });

  /**
   * Explain why the expansion control exists or disappeared.
   *
   * Target selection is heuristic and sits before every visible error state.
   * Without this event, a false negative produces literally nothing: no
   * button, no request, and no later entitlement/fetch logs.
   */
  private articleTargetDiagnostics = effect(() => {
    if (!this.readerMode()) {
      return;
    }
    const root = this.chain()[0];
    if (!root) {
      return;
    }
    const candidates = outboundLinks(root.content ?? '');
    const target = this.articleUrl();
    this.log.info('Article', 'target:decided', {
      statusId: root.id,
      provider: root.provider ?? 'mastodon',
      candidateCount: candidates.length,
      selected: target !== null,
      selectedHost: target ? hostname(target) : null,
      reason: target
        ? root.provider === 'rss'
          ? 'rss-item-url'
          : 'single-outbound-link'
        : candidates.length === 0
          ? 'no-outbound-link'
          : 'ambiguous-outbound-links',
    });
  });

  /** True while a fetch is in flight. */
  protected expanding = signal(false);

  /** Forced retries spent on this post, bounded by `MAX_MANUAL_RETRIES`. */
  private retries = signal(0);

  /** The expanded-article region, so focus can be moved to it when it appears. */
  private expandedArticleRef = viewChild<ElementRef<HTMLElement>>('expandedArticle');

  /** The last expansion attempt's result, or null before the first. */
  protected expansion = signal<ArticleResult | null>(null);

  /** The host an expanded article came from, for the attribution line. */
  protected expandedHost = computed(() => {
    const result = this.expansion();
    if (!result) {
      return '';
    }
    try {
      return new URL(result.finalUrl).hostname.replace(/^www\./, '');
    } catch {
      return result.finalUrl;
    }
  });

  /** The expanded article as HTML, ready for `[innerHTML]`. */
  protected expandedHtml = computed(() => {
    const article = this.expansion()?.article;
    return article ? renderMarkdown(article.markdown) : null;
  });

  /** Whether the button should be offered at all. */
  /**
   * Whether this post has an article worth offering to expand.
   *
   * Deliberately **not** conditioned on a proxy being configured. It used to be,
   * and that was a silent failure: the proxy selection lives in `localStorage`
   * and does not travel between devices, so the same account on a phone simply
   * had no button and no explanation — indistinguishable from the feature not
   * existing. Now the section renders and {@link expansionBlocker} says what is
   * missing.
   */
  protected canExpand = computed(() => this.articleUrl() !== null);

  /**
   * Whether the offered fetch is filling in the *rest* of an already-partial
   * RSS item, rather than fetching an article from scratch. Purely a label
   * decision — `articleTarget()` already refuses to offer expansion at all for
   * a full-content RSS item, so by the time this is read the button is either
   * a normal "Fetch article" (non-RSS, or an RSS teaser with nothing shown
   * yet — same label works because nothing of the article is visible) or a
   * teaser continuation, which reads as "Fetch article" too until you notice
   * you already have half of it. Rendered as its own boolean rather than
   * folding the string into the template, to keep the copy in one place.
   */
  protected expandsRssTeaser = computed(() => {
    const root = this.chain()[0];
    return root?.provider === 'rss' && root.rssFullContent === false;
  });

  /**
   * Why expansion cannot run right now, if it cannot.
   *
   * Separate from the diagnosis messages, which describe a *fetch* that already
   * happened. This is about the state of the app before any fetch is possible.
   */
  protected expansionBlocker = computed<string | null>(() => {
    if (!this.articles.available()) {
      return this.transloco.translate('pages.thread.article.expansionBlocker');
    }
    return null;
  });

  /**
   * What to say about a result that is not a clean article.
   *
   * Every diagnosis gets its own sentence. A generic "couldn't load" would be
   * the one thing this feature promised not to ship: these pages fail for
   * specific, nameable reasons, and "this publisher requires a subscription"
   * is a different fact from "this page needs JavaScript".
   */
  protected expansionNote = computed<string | null>(() => {
    const result = this.expansion();
    if (!result) {
      return null;
    }
    // Each of these names the actual cause and points somewhere. "Open it on
    // the original site" is not filler: the link is right there, and for most
    // of these it is genuinely the answer.
    const notes: Record<ArticleDiagnosis, string | null> = {
      ok: null,
      partial: 'pages.thread.article.note.partial',
      paywall: 'pages.thread.article.note.paywall',
      'bot-check': 'pages.thread.article.note.botCheck',
      'consent-wall': 'pages.thread.article.note.consentWall',
      'needs-js': 'pages.thread.article.note.needsJs',
      junk: 'pages.thread.article.note.junk',
      'not-html': 'pages.thread.article.note.notHtml',
      'too-large': 'pages.thread.article.note.tooLarge',
      'rate-limited': 'pages.thread.article.note.rateLimited',
      // Distinguished from ours deliberately: waiting fixes our limit, and does
      // not necessarily fix theirs.
      'site-rate-limited': 'pages.thread.article.note.siteRateLimited',
      'site-error': 'pages.thread.article.note.siteError',
      'not-found': 'pages.thread.article.note.notFound',
      'upstream-timeout': 'pages.thread.article.note.upstreamTimeout',
      'blocked-destination': 'pages.thread.article.note.blockedDestination',
      // Should never reach a reader: the fetch retries on the older route when
      // it sees this. Worded for the case where that retry also fails, which
      // means the proxy is genuinely misconfigured rather than merely behind.
      'route-unavailable': 'pages.thread.article.note.routeUnavailable',
      'redirect-loop': 'pages.thread.article.note.redirectLoop',
      network: 'pages.thread.article.note.network',
    };
    const key = notes[result.diagnosis];
    return key ? this.transloco.translate(key) : null;
  });

  /**
   * The technical detail behind a failure, as lines for the disclosure.
   *
   * Shown in the page rather than only logged to the console. "It didn't work"
   * is not something anyone can act on, and requiring devtools to find out why
   * puts the answer out of reach of exactly the people most likely to report
   * the problem. Folded away by default so it costs nothing to ignore.
   */
  protected expansionDebug = computed<string[]>(() => {
    const result = this.expansion();
    const debug = result?.debug;
    if (!result || !debug || result.article) {
      return [];
    }
    const lines: string[] = [];
    if (debug.source === 'upstream') {
      lines.push(
        debug.upstreamStatus
          ? this.transloco.translate('pages.thread.article.debug.upstreamStatus', {
              status: debug.upstreamStatus,
            })
          : this.transloco.translate('pages.thread.article.debug.upstream'),
      );
    } else if (debug.source === 'proxy') {
      lines.push(this.transloco.translate('pages.thread.article.debug.proxy'));
    }
    if (debug.status) {
      lines.push(
        this.transloco.translate('pages.thread.article.debug.status', { status: debug.status }),
      );
    }
    if (debug.detail) {
      lines.push(debug.detail);
    }
    if (debug.documentWords !== undefined) {
      lines.push(
        this.transloco.translate('pages.thread.article.debug.textFound', {
          count: debug.documentWords,
        }),
      );
    }
    if (debug.hadMetadata !== undefined) {
      lines.push(
        this.transloco.translate(
          debug.hadMetadata
            ? 'pages.thread.article.debug.previewReadable'
            : 'pages.thread.article.debug.noPreview',
        ),
      );
    }
    if (debug.elapsedMs !== undefined) {
      lines.push(
        this.transloco.translate('pages.thread.article.debug.elapsed', {
          seconds: (debug.elapsedMs / 1000).toFixed(1),
        }),
      );
    }
    lines.push(
      this.transloco.translate('pages.thread.article.debug.url', { url: result.finalUrl }),
    );
    return lines;
  });

  /**
   * Fetch and render the linked article.
   *
   * Quota is spent here rather than in `ArticleFetch`, because only this point
   * knows whether an article was actually rendered. A cache hit, a failure, and
   * a page the quality gate rejected all cost nothing.
   */
  async expandArticle(force = false): Promise<void> {
    const url = this.articleUrl();
    if (!url || this.expanding()) {
      return;
    }
    if (!this.quota.allowed()) {
      return;
    }
    // A forced retry bypasses the cache, and therefore also bypasses the
    // failure cooldown that exists to stop a permanently-refusing site being
    // re-fetched forever. Bounded so that "Try again" stays a deliberate act:
    // a failure on this route is never cached at the edge, so every retry is a
    // full origin round trip that costs us and the publisher alike.
    if (force && this.retries() >= MAX_MANUAL_RETRIES) {
      return;
    }

    this.expanding.set(true);
    try {
      // `isSupporter()` starts at false on every reload because entitlement is
      // deliberately not persisted. Settle it before enforcing the local
      // counter; otherwise an exhausted subscriber is disabled before the
      // request that could discover their subscription is ever made.
      if (!(await this.quota.authorize())) {
        return;
      }
      if (force) {
        this.retries.update((n) => n + 1);
        await this.articles.forget(url);
      }
      this.quota.recordFetch();
      const result = await this.articles.expand(url, force);
      this.expansion.set(result);
      // Only a rendered article counts against the daily limit.
      if (result.article) {
        this.retries.set(0);
        // Through the tally rather than the quota directly, so a supporter's
        // running total also reaches their account. See `article-reading-tally`.
        this.tally.recordOne();
        this.focusExpandedArticle();
      }
    } finally {
      this.expanding.set(false);
    }
  }

  /** Whether another manual retry is allowed for this post. */
  protected retriesLeft = computed(() => MAX_MANUAL_RETRIES - this.retries());

  /**
   * Move focus to the article that just appeared.
   *
   * Without this, a keyboard or screen-reader user presses "Fetch article",
   * hears nothing, and is still on a button while several pages of new content
   * have been inserted below them. The region is `tabindex="-1"` so it can take
   * focus programmatically without joining the tab order, and its
   * `aria-label` is what gets announced on arrival.
   *
   * `afterNextRender` is not used because the element does not exist until the
   * signal write above has been flushed to the DOM; a microtask is the smallest
   * thing that reliably lands after it.
   */
  private focusExpandedArticle(): void {
    queueMicrotask(() => {
      this.expandedArticleRef()?.nativeElement.focus({ preventScroll: false });
    });
  }

  /** Put the article away, keeping it cached for a second look. */
  collapseArticle(): void {
    this.expansion.set(null);
  }

  /**
   * Whether the focused post can be written to at all.
   *
   * Derived from {@link capabilitiesFor} rather than from a list of provider
   * flags. Reader mode previously chose its action row with
   * `isRss() || isAnonymousPublic()`, which is a denylist — so tweets, added
   * long afterwards, fell into the writable branch and offered Reply, Boost and
   * Favourite buttons for actions that cannot exist, plus a composer that would
   * have POSTed a `twitter:` id to the Mastodon API. Asking the capability
   * table means the next read-only provider is handled before it is written.
   */
  protected readOnlyPost = computed(() => {
    const post = this.status();
    if (!post) {
      return false;
    }
    if (this.isMessageStatus()) {
      return true;
    }
    const caps = capabilitiesFor(post.provider, this.canActOn(post.provider));
    return !caps.reply && !caps.favourite && !caps.reblog;
  });

  /**
   * Whether this session holds credentials for the network a post came from.
   *
   * Not one flag but a pairing, because "am I signed in?" stopped being a single
   * question once Bluesky could be the identity. A Bluesky-primary account can
   * act on a `bluesky` post and not on a `mastodon` one; a Mastodon account is
   * the mirror image; Anonymous can act on neither. Asking `!isAnonymous` gave a
   * Bluesky-primary reader Reply and Favourite buttons on Mastodon posts, wired
   * to an API it has no token for.
   */
  private canActOn(provider: Status['provider']): boolean {
    if (this.auth.isAnonymous) {
      return false;
    }
    if (this.auth.isBlueskyPrimary) {
      return provider === 'bluesky';
    }
    // Mastodon-primary: Bluesky posts are writable when the connector is linked,
    // which is what the capability table already assumes for a linked provider.
    return true;
  }

  /** Everything in the thread that is not part of the author chain: the comments. */
  protected comments = computed<Status[]>(() => {
    const chainIds = new Set(this.chain().map((s) => s.id));
    return this.thread().filter((s) => !chainIds.has(s.id));
  });

  /**
   * The single other participant when this thread is a 1:1 conversation —
   * exactly the current user and one other person across every post in the
   * thread. Null for a solo thread, or the moment a third voice appears.
   *
   * The chat tab has no multi-person UI yet, and we don't want to make it easy
   * to stumble into a 20-way "chat" that reads badly — so "open in chat" is only
   * offered (and enabled) when it maps cleanly onto a two-person DM. Bluesky/RSS/
   * anonymous threads don't participate: those don't have a Mastodon DM to open.
   */
  protected chatPartner = computed(() => {
    // Read-only posts have no Mastodon DM to open: there is no account on this
    // server to message. Asking readOnlyPost() rather than listing providers
    // means X was covered the moment it was added, instead of offering "Open in
    // chat" for an account that exists only on Twitter.
    if (this.isAnonymousPublic() || this.readOnlyPost()) {
      return null;
    }
    const me = this.auth.account();
    const posts = this.thread();
    if (!me || !posts.length) {
      return null;
    }
    // Bluesky posts route to a different DM system; if any post is bsky this
    // isn't a Mastodon 1:1 chat we can open here.
    if (posts.some((p) => this.isBluesky(p))) {
      return null;
    }
    const others = new Map<string, Account>();
    for (const p of posts) {
      const acc = p.account;
      if (acc.id !== me.id) {
        others.set(acc.id, acc);
      }
    }
    // Exactly one other voice → a clean two-person chat. Zero (a solo thread) or
    // two-plus (a group) both disqualify.
    return others.size === 1 ? [...others.values()][0] : null;
  });

  /** The conversations-tab key for a 1:1 chat, matching how public chats group
   *  by the other person (see notifications' `chatKey`). Null when not eligible. */
  protected chatKey = computed(() => {
    const partner = this.chatPartner();
    return partner ? `pub:${partner.acct}` : null;
  });

  /**
   * Query params for the "open in chat" link. `open` selects (or, on the chat
   * page, seeds) the 1:1 chat by its public key; `with` carries the partner's
   * account id so the chat page can fetch the full record and draft a fresh chat
   * even when no message history exists yet; `context` identifies the post the
   * user clicked, so the transcript never opens as an unexplained blank. Null
   * when not eligible.
   */
  protected chatQueryParams = computed<Record<string, string> | null>(() => {
    const partner = this.chatPartner();
    const key = this.chatKey();
    const context = this.status()?.id;
    return partner && key && context ? { open: key, with: partner.id, context } : null;
  });

  /** Id of the chain post whose inline reply composer is open (reader mode). */
  protected replyingTo = signal<string | null>(null);

  toggleReaderReply(id: string): void {
    this.replyingTo.update((current) => (current === id ? null : id));
  }

  onReaderReplied(status: Status): void {
    this.replyingTo.set(null);
    this.onReply(status);
  }

  /** Patch a status wherever it lives (focused post, ancestors, or descendants). */
  patch(updated: Status): void {
    if (this.status()?.id === updated.id) {
      this.status.set(updated);
    }
    this.onContextChanged(updated);
  }

  toggleFavourite(post: Status): void {
    this.readerActionError.set(null);
    this.actions.toggleFavourite(post).subscribe({
      next: (updated) => this.patch(updated),
      error: () => this.readerActionError.set(this.actionFailureMessage(post, 'like')),
    });
  }

  toggleReblog(post: Status): void {
    this.readerActionError.set(null);
    this.actions.toggleReblog(post).subscribe({
      next: (updated) => this.patch(updated.reblog ?? updated),
      error: () => this.readerActionError.set(this.actionFailureMessage(post, 'repost')),
    });
  }

  private actionFailureMessage(post: Status, action: 'like' | 'repost' | 'bookmark'): string {
    const actionKey =
      action === 'like'
        ? 'pages.thread.actions.like'
        : action === 'repost'
          ? 'pages.thread.actions.repost'
          : 'pages.thread.actions.bookmarkPost';
    const actionText = this.transloco.translate(actionKey);
    return this.transloco.translate(
      post.provider === 'bluesky'
        ? 'pages.thread.actions.failureBluesky'
        : 'pages.thread.actions.failureMastodon',
      { action: actionText },
    );
  }

  /**
   * Bookmark locally or on the server, depending on where the post lives.
   *
   * See `StatusCard.toggleNativeBookmark` for the reasoning. The provider list
   * here is the same one: an X, RSS or paste id names nothing the home server
   * has ever seen, so a bookmark call could only 404 and lose the bookmark.
   */
  toggleBookmark(post: Status): void {
    const provider = post.provider ?? 'mastodon';
    this.readerActionError.set(null);
    if (provider === 'bluesky' && this.bskySession.linked()) {
      const ref = post.providerRef as BskyRef;
      const call = post.bookmarked
        ? this.bsky.deleteBookmark(ref.uri)
        : this.bsky.createBookmark(ref.uri, ref.cid);
      call.subscribe({
        next: () => this.patch({ ...post, bookmarked: !post.bookmarked }),
        error: () => this.readerActionError.set(this.actionFailureMessage(post, 'bookmark')),
      });
      return;
    }
    if (
      this.auth.isAnonymous ||
      provider === 'bluesky' ||
      provider === 'anonymous-mastodon' ||
      !serverKnowsStatus(provider)
    ) {
      this.patch(this.anonymousBookmarks.toggle(post));
      return;
    }
    const call = post.bookmarked ? this.api.unbookmark(post.id) : this.api.bookmark(post.id);
    call.subscribe({
      next: (updated) => this.patch(updated),
      error: () => this.readerActionError.set(this.actionFailureMessage(post, 'bookmark')),
    });
  }

  /** Latest route id and `?reader` value, tracked so either stream can recompute reader mode. */
  private currentId = '';
  private readerParam: string | null = null;

  ngOnInit(): void {
    // Navigating away from an article must give the rails back, including the
    // routes that leave reader mode on (an in-reader link to another page).
    this.destroyRef.onDestroy(() => {
      this.releaseZen?.();
      this.releaseZen = null;
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.currentId = id;
        this.applyReaderMode();
        this.load(id);
      }
    });
    // Deep link: status cards link here with ?reader=1 to open straight into
    // reader mode. RSS items are articles, so they default to reader ON unless
    // the link explicitly opts out with ?reader=0.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.readerParam = params.get('reader');
      this.applyReaderMode();
    });
  }

  private applyReaderMode(): void {
    const rssDefault = this.currentId.startsWith('rss:') && this.readerParam !== '0';
    this.setReaderMode(this.readerParam === '1' || rssDefault);
  }

  /**
   * The only place `readerMode` is written, so the rails can never get out of
   * step with it.
   *
   * Reader mode is a reading surface, so it hides the rails for as long as it is
   * open — the same effect as zen mode, taken as a hold rather than by setting
   * the preference. Setting `prefs.setZenMode()` here would persist, and exiting
   * would then switch zen *off* for someone who arrived with it on. A hold has
   * no such state to restore: dropping it returns the rails to whatever the
   * preference always said.
   */
  private setReaderMode(on: boolean): void {
    if (this.readerMode() === on) {
      return;
    }
    this.readerMode.set(on);
    if (on) {
      this.releaseZen = this.readingZen.hold();
    } else {
      this.releaseZen?.();
      this.releaseZen = null;
    }
  }

  load(id: string): void {
    this.loadSub.unsubscribe();
    this.loadSub = new Subscription();
    this.loading.set(true);
    this.loadError.set(null);
    this.status.set(null);
    this.ancestors.set([]);
    this.descendants.set([]);
    this.isRss.set(false);
    this.rssFeedUrl.set(null);
    this.isTwitter.set(false);
    this.twitterError.set(null);
    this.isAnonymousPublic.set(false);
    this.isMessageStatus.set(false);
    this.publicContextUnavailable.set(false);
    this.publicOriginalUrl.set(null);
    this.rssHasCommentFeed.set(false);
    this.rssCommentsUnavailable.set(false);
    if (id.startsWith('bsky:')) {
      this.loadBsky(id.slice('bsky:'.length));
      return;
    }
    if (id.startsWith('rss:')) {
      this.loadRss(id);
      return;
    }
    if (id.startsWith('twitter:')) {
      this.loadTwitter(id.slice('twitter:'.length));
      return;
    }
    if (isElizaId(id) || id.startsWith('local:')) {
      this.loadLocal(id);
      return;
    }
    const messagePayload = parseMessageStatusRouteRef(id);
    if (messagePayload) {
      // A self-contained message serialized into the URL: render it as a native
      // post with no network and no thread context. It's read-only — there's no
      // real status to reply to, boost, favourite or bookmark.
      this.isMessageStatus.set(true);
      this.status.set(messageStatus(messagePayload, this.messagePermalink(id)));
      this.loading.set(false);
      return;
    }
    const publicRef = parseAnonymousStatusRouteRef(id);
    if (publicRef) {
      this.loadAnonymousPublic(publicRef);
      return;
    }
    this.loadSub.add(
      this.api.getStatus(id).subscribe({
        next: (s) => {
          this.status.set(s);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          // Without a handler the spinner never stopped. Unlike an account,
          // there is no recovery to attempt: post ids are per-server and a
          // post has no portable identifier to re-resolve it by, so the honest
          // move is to say so and point somewhere that works.
          const status = (error as { status?: number })?.status;
          this.loading.set(false);
          this.loadError.set(
            status === 404
              ? this.transloco.translate('pages.thread.error.postNotOnServer')
              : this.transloco.translate('pages.thread.error.loadPost'),
          );
        },
      }),
    );
    this.loadSub.add(
      this.api.getContext(id).subscribe((ctx) => {
        this.ancestors.set(ctx.ancestors);
        this.descendants.set(ctx.descendants);
      }),
    );
  }

  /** Public Mastodon status and context; a blocked context endpoint never hides the post itself. */
  private loadAnonymousPublic(ref: AnonymousPublicRef): void {
    this.isAnonymousPublic.set(true);
    this.publicOriginalUrl.set(ref.originalUrl ?? null);
    this.loadSub.add(
      this.anonymousPublic.getStatus(ref).subscribe({
        next: (status) => {
          const saved = this.anonymousBookmarks.has(status);
          this.status.set(saved ? { ...status, bookmarked: true } : status);
          this.publicOriginalUrl.set(status.url ?? ref.originalUrl ?? null);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      }),
    );
    this.loadSub.add(
      this.anonymousPublic.getContext(ref).subscribe({
        next: (context) => {
          this.ancestors.set(context.ancestors);
          this.descendants.set(context.descendants);
        },
        error: () => this.publicContextUnavailable.set(true),
      }),
    );
  }

  /**
   * A browser-local practice thread: Eliza's posts and the viewer's own local
   * posts, assembled from the local stores with no network. Missing ids (e.g. a
   * stale link after unfollow cleared the feed) fall through to the empty state.
   */
  private loadLocal(id: string): void {
    this.localPosts.refresh();
    const thread = this.localPosts.thread(id, this.eliza.timeline());
    if (!thread) {
      this.loading.set(false);
      return;
    }
    this.status.set(thread.status);
    this.ancestors.set(thread.ancestors);
    this.descendants.set(thread.descendants);
    this.loading.set(false);
  }

  /** The canonical in-app permalink for a URL-serialized message: this very page. */
  private messagePermalink(id: string): string | null {
    try {
      return new URL(`statuses/${id}`, document.baseURI).toString();
    } catch {
      return null;
    }
  }

  /** Bluesky thread: `getPostThread` mapped onto the same ancestors/descendants shape. */
  private loadBsky(uri: string): void {
    this.loadSub.add(
      this.bsky.getPostThread(uri).subscribe({
        next: ({ thread }) => {
          if (!thread.post) {
            this.loading.set(false);
            return;
          }
          this.status.set(adaptPost(thread.post));
          const ancestors: Status[] = [];
          for (let node = thread.parent; node; node = node.parent) {
            if (node.post) {
              ancestors.unshift(adaptPost(node.post));
            }
          }
          this.ancestors.set(ancestors);
          this.descendants.set(flattenReplies(thread.replies ?? []));
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      }),
    );
  }

  /**
   * A tweet and its direct replies.
   *
   * Costs **one** request, for the replies. The focus post itself comes out of
   * the feed cache — the reader was looking at it a moment ago — so clicking
   * into a thread does not pay twice for something already on screen.
   *
   * Deliberately no ancestors. Walking to the conversation root costs one
   * request per level with the depth unknowable in advance, which is the
   * unbounded chain the spec warns about (§6.10). A reply's parent is instead
   * reachable through the "full conversation" link the template offers, which
   * costs nothing because it leaves the app.
   */
  private loadTwitter(tweetId: string): void {
    this.isTwitter.set(true);
    this.ancestors.set([]);
    this.descendants.set([]);

    // Wait for the saved timelines to load before deciding to pay. On a reload
    // this is the difference between the post being already in hand and buying
    // it again — the cache used to die with the tab, so this path always spent
    // a request.
    void this.twitterFeed.hydrated.then(() => this.showTwitterPost(tweetId));
  }

  private showTwitterPost(tweetId: string): void {
    const cached = this.twitterFeed.findCached(`twitter:${tweetId}`);
    if (cached) {
      this.status.set(cached);
      this.loading.set(false);
    } else {
      // Genuinely not held: a link to a post from an account nobody here
      // follows. One request, paid only on this path.
      this.loadSub.add(
        this.twitterApi.getPost(tweetId).subscribe({
          next: (status) => {
            this.status.set(status);
            this.loading.set(false);
          },
          error: (error: unknown) => {
            this.twitterError.set(
              error instanceof Error
                ? error.message
                : this.transloco.translate('pages.thread.twitter.loadPost'),
            );
            this.loading.set(false);
          },
        }),
      );
    }

    this.loadSub.add(
      this.twitterApi.getReplies(tweetId).subscribe({
        next: (page) => {
          this.descendants.set(page.statuses);
          // A cold load (reload, shared link) has no cached focus post. The
          // replies carry `inReplyToId` but not the parent itself, so rather
          // than spend a second request the page shows the replies under a
          // note — see `twitterFocusMissing` in the template.
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.twitterError.set(
            error instanceof Error
              ? error.message
              : this.transloco.translate('pages.thread.twitter.loadReplies'),
          );
          this.loading.set(false);
        },
      }),
    );
  }

  /**
   * RSS article: resolve the item from its feed, then (if the publisher declares
   * a comment feed) load the comments as descendants. Ids are `rss:<feedUrl>::<guid>`.
   */
  private loadRss(id: string): void {
    this.isRss.set(true);
    const body = id.slice('rss:'.length);
    const sep = body.indexOf('::');
    if (sep === -1) {
      this.loading.set(false);
      return;
    }
    const feedUrl = body.slice(0, sep);
    const guid = body.slice(sep + 2);
    this.rssFeedUrl.set(feedUrl);
    this.ancestors.set([]);
    this.descendants.set([]);
    this.loadSub.add(
      this.rss.getFeedItem(feedUrl, guid).subscribe({
        next: (view) => {
          this.status.set(view.status);
          this.loading.set(false);
          if (view.commentsFeedUrl) {
            this.rssHasCommentFeed.set(true);
            this.loadRssComments(view.commentsFeedUrl, feedUrl, view.status.id);
          }
        },
        error: () => this.loading.set(false),
      }),
    );
  }

  private loadRssComments(commentsFeedUrl: string, feedUrl: string, parentId: string): void {
    this.loadSub.add(
      this.rss.getComments(commentsFeedUrl, feedUrl, parentId).subscribe({
        next: (comments) => {
          this.descendants.set(comments);
          this.rssCommentsUnavailable.set(comments.length === 0);
        },
        // A declared comment feed that won't load (CORS, 404) is common; note it.
        error: () => this.rssCommentsUnavailable.set(true),
      }),
    );
  }

  /**
   * The "read it at the source" link for a read-only post in reader mode.
   *
   * tweets go to Nitter rather than x.com, matching the card toolbar — sending
   * a reader to a login wall is the thing this app exists to avoid. Everything
   * else keeps its own URL, because an RSS item's original site is the whole
   * point of the link.
   */
  protected readerOriginalLink(post: Status): { url: string; label: string } | null {
    if (post.provider === 'twitter') {
      const url = toNitterUrl(post.url);
      return url
        ? { url, label: this.transloco.translate('pages.thread.readerOriginal.nitter') }
        : null;
    }
    return post.url
      ? {
          url: post.url,
          label: this.transloco.translate('pages.thread.readerOriginal.originalSite'),
        }
      : null;
  }

  toggleReader(): void {
    this.setReaderMode(!this.readerMode());
  }

  bumpReaderFont(delta: number): void {
    this.prefs.setReaderFontSize(this.prefs.readerFontSize() + delta);
  }

  setReaderFont(event: Event): void {
    this.prefs.setReaderFontFamily((event.target as HTMLSelectElement).value as ReaderFontFamily);
  }

  setReaderTheme(event: Event): void {
    this.prefs.setReaderTheme((event.target as HTMLSelectElement).value as ReaderTheme);
  }

  onReply(status: Status): void {
    // Local practice replies also draw an Eliza answer into the store, so
    // re-assemble the whole thread rather than only appending the viewer's line.
    const focused = this.status();
    if (focused && this.isLocal(focused)) {
      this.loadLocal(focused.id);
      return;
    }
    this.descendants.update((d) => [...d, status]);
  }

  onChanged(updated: Status): void {
    this.status.set(updated);
  }

  onContextChanged(updated: Status): void {
    const patch = (list: Status[]) => list.map((s) => (s.id === updated.id ? updated : s));
    this.ancestors.update(patch);
    this.descendants.update(patch);
  }

  onContextDeleted(removed: Status): void {
    const drop = (list: Status[]) => list.filter((s) => s.id !== removed.id);
    this.ancestors.update(drop);
    this.descendants.update(drop);
  }

  /** The focused status was deleted: leave the thread. */
  onFocusedDeleted(): void {
    this.router.navigateByUrl('/home');
  }

  protected isBluesky(post: Status): boolean {
    return post.provider === 'bluesky';
  }

  /** True for a browser-local practice post (Eliza's or the viewer's) — its reply
   *  box is the local composer, never the network one. */
  protected isLocal(post: Status): boolean {
    return isElizaId(post.id) || post.id.startsWith('local:');
  }
}

/** Depth-first flatten of a bsky reply tree into Mastodon-style descendants order. */
function flattenReplies(nodes: BskyThreadNode[]): Status[] {
  const out: Status[] = [];
  for (const node of nodes) {
    if (node.post) {
      out.push(adaptPost(node.post));
    }
    if (node.replies?.length) {
      out.push(...flattenReplies(node.replies));
    }
  }
  return out;
}
