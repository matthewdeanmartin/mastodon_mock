import { inspectHtml } from './article-diagnosis';
import { extractMetadata } from './article-metadata';
import { ArticleBody, ArticleResult } from './article-models';
import { judge, measure } from './article-quality';
import { findArticleRoot, stripFurniture } from './article-scoring';
import { htmlToMarkdown } from './html-to-markdown';

/**
 * Raw HTML → a renderable result.
 *
 * The one entry point for turning a fetched page into something the reader can
 * show. Pure: no HTTP, no Angular, no storage. Everything it needs is the bytes
 * and the URL they came from, which is what makes it testable against a corpus
 * of saved pages.
 *
 * ## Nothing here executes anything
 *
 * `DOMParser` builds a detached document: no script runs, no `<img>` fires, no
 * network request happens. The document is never attached to the live DOM. The
 * markdown conversion downstream then discards every construct that could carry
 * behaviour. A hostile page is, at worst, badly formatted prose.
 */

/**
 * Extract everything worth having from a fetched page.
 *
 * `finalUrl` must be where the content actually came from — the end of any
 * redirect chain, which the proxy reports in `X-Proxy-Final-Url`. Relative
 * links and images resolve against it.
 *
 * Always returns a result. Metadata is attempted first and independently, so a
 * page that refuses extraction still yields a card, which is what keeps the
 * failure path from being a dead end.
 */
export function extractArticle(
  html: string,
  finalUrl: string,
  requestedUrl: string = finalUrl,
): ArticleResult {
  const fetchedAt = new Date().toISOString();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Metadata comes first and from the untouched document: `stripFurniture`
  // removes `<header>`, which is where a fair number of pages keep their
  // `<h1>`, and it does not care about `<meta>` either way.
  const card = extractMetadata(doc, finalUrl);

  const base = (): Omit<ArticleResult, 'diagnosis' | 'article'> => ({
    requestedUrl,
    finalUrl,
    card,
    fetchedAt,
  });

  // Tier 1: is this page hostile or empty in a way we can name?
  const preVerdict = inspectHtml(doc, html);
  if (preVerdict) {
    return { ...base(), article: null, diagnosis: preVerdict };
  }

  stripFurniture(doc);

  const root = findArticleRoot(doc);
  if (!root) {
    return { ...base(), article: null, diagnosis: 'junk' };
  }

  const { markdown, images } = htmlToMarkdown(root.element, finalUrl);
  const metrics = measure(root.element, markdown);
  const quality = judge(metrics);

  if (quality === 'junk') {
    return { ...base(), article: null, diagnosis: 'junk' };
  }

  const title =
    card?.title ??
    doc.querySelector('h1')?.textContent?.trim() ??
    doc.querySelector('title')?.textContent?.trim() ??
    'Untitled';

  const article: ArticleBody = {
    title,
    byline: card?.author_name ?? null,
    siteName: card?.provider_name || null,
    markdown,
    images,
    quality,
    metrics,
  };

  return {
    ...base(),
    article,
    diagnosis: quality === 'thin' ? 'partial' : 'ok',
  };
}
