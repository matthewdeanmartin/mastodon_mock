import { PreviewCard } from '../../models';

/**
 * Types for article expansion — fetching a remote page and turning it into
 * something readable inside the reader.
 *
 * See `sprint/reader-1-article-expansion.md`. The short version: metadata
 * extraction is the part that always works, and article extraction is the bonus
 * on top. That inversion is what makes the failure path acceptable, and it is
 * why {@link ArticleResult} always carries a card and only sometimes an
 * article.
 */

/**
 * Why an expansion produced what it produced.
 *
 * Every value here gets a human sentence in the UI. A generic "couldn't load"
 * is the one thing this feature will not ship: the pages that fail fail for
 * specific, nameable reasons, and naming them is the difference between "this
 * is broken" and "this publisher does not allow it".
 */
export type ArticleDiagnosis =
  /** A full article was extracted and passed the quality gate. */
  | 'ok'
  /** Extracted, but short or link-heavy. Rendered, with a caveat. */
  | 'partial'
  /** Paywall markers, or a JSON-LD `isAccessibleForFree: false`. */
  | 'paywall'
  /** A bot challenge page, or a 403. */
  | 'bot-check'
  /** The document is a cookie/consent dialog rather than the article. */
  | 'consent-wall'
  /** A framework shell with no server-rendered text. Out of scope by design. */
  | 'needs-js'
  /** Something was extracted and the quality gate rejected it. */
  | 'junk'
  /** The proxy refused the content type (PDF, image, …). */
  | 'not-html'
  /** Over the route's size cap. */
  | 'too-large'
  /** The proxy rate-limited us. */
  | 'rate-limited'
  /** The upstream redirected more times than the proxy will follow. */
  | 'redirect-loop'
  /** Everything else: DNS, TLS, timeout, offline. */
  | 'network';

/**
 * How good an extraction is, which decides whether it is shown at all.
 *
 * The three-way split matters: a `thin` result is genuinely worth rendering —
 * a lede and two paragraphs beat a bare link — while a `junk` result is worse
 * than nothing, because rendering navigation soup as an article teaches the
 * reader that the button lies.
 */
export type ArticleQuality = 'good' | 'thin' | 'junk';

/** The measurements the quality verdict is computed from. Surfaced for debugging. */
export interface ArticleMetrics {
  /** Words in the extracted body. */
  wordCount: number;
  /** Linked words ÷ total words. The single most useful signal. */
  linkDensity: number;
  /** Paragraphs with enough words to be prose rather than a caption. */
  paragraphCount: number;
  /** Text characters ÷ markup characters of the chosen subtree. */
  textToMarkupRatio: number;
}

/** The readable part of a page, when there is one. */
export interface ArticleBody {
  title: string;
  byline: string | null;
  siteName: string | null;
  /** The article as markdown. The reader renders this. */
  markdown: string;
  /** http(s) image URLs in document order, already absolute. */
  images: string[];
  quality: ArticleQuality;
  metrics: ArticleMetrics;
}

/**
 * What an expansion attempt yields.
 *
 * `card` is present whenever *any* metadata survived, which is most of the
 * time — publishers want their paywalled article to look good when shared, so
 * `og:title` and `og:description` are frequently intact on exactly the pages
 * that refuse extraction. `article` is absent when the quality gate said no.
 */
export interface ArticleResult {
  /** The URL the caller asked for. */
  requestedUrl: string;
  /**
   * The URL the content actually came from, after redirects.
   *
   * Relative links and images resolve against this, never against
   * {@link requestedUrl} — a shortened link would otherwise resolve every
   * image on the page to a 404.
   */
  finalUrl: string;
  /** Always present when metadata was recoverable. */
  card: PreviewCard | null;
  /** Present only when extraction produced something worth rendering. */
  article: ArticleBody | null;
  diagnosis: ArticleDiagnosis;
  /** ISO timestamp, for cache expiry and for showing "fetched 2 hours ago". */
  fetchedAt: string;
}
