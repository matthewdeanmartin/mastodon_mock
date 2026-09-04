import { Status } from '../../models';
import { plainText } from '../search/search-refine';

/**
 * What counts as a document, and how one is assembled from posts.
 *
 * The reader will open anything it is pointed at — refusing to render is never
 * the right answer to "I wanted to read this". But *the library* only shelves
 * documents, and the difference has to be decided somewhere both the reader and
 * the library agree on. That is here.
 *
 * See `sprint/kindle-1-page-and-shell.md` §1c.
 */

/**
 * Long enough to be worth reading as a document rather than as a post.
 *
 * Deliberately not derived from any server's post limit. Mastodon's default is
 * 500 characters but instances routinely raise it, and some of the posts this
 * feature exists for are single 2,000-character essays on such a server. The
 * threshold is about reading effort — roughly a minute — not about what a
 * particular admin configured.
 */
export const DOCUMENT_MIN_CHARS = 500;

/**
 * Extract the author's own chain from a thread: the first post plus every later
 * post where the same author replied to any post already in the chain.
 *
 * This covers both storm styles — replying to your own previous post, and
 * replying repeatedly to the root. Posts by other people, and the author's
 * side-replies to them, are not part of the article.
 */
export function readerChain(thread: Status[]): Status[] {
  if (!thread.length) {
    return [];
  }
  const root = thread[0];
  const chain = [root];
  const chainIds = new Set([root.id]);
  const authorId = root.account.id;
  for (const s of thread.slice(1)) {
    if (s.account.id === authorId && s.in_reply_to_id !== null && chainIds.has(s.in_reply_to_id)) {
      chain.push(s);
      chainIds.add(s.id);
    }
  }
  return chain;
}

/** Characters of actual prose across a chain, tags and markup excluded. */
export function chainTextLength(chain: Status[]): number {
  return chain.reduce((total, post) => total + plainText(post.content ?? '').length, 0);
}

/**
 * Whether this is a document — something the library should remember.
 *
 * Four ways to qualify, any one of which is enough:
 *
 * - **An RSS item.** It is an article by construction; that is what a feed is.
 * - **An expanded article.** The reader fetched a page and got prose back.
 * - **A chain of more than one post.** A tweetstorm is a document even when
 *   each individual post is short — the whole point is that it was written as
 *   one thing and split by a character limit.
 * - **A single post over {@link DOCUMENT_MIN_CHARS}.** The long-tweet case.
 *
 * Everything else is an ordinary post: read it, react to it, and let it go. The
 * operator's rule, stated plainly — short or never-viewed tweets are never
 * tracked — is this function returning false.
 */
export function isDocument(chain: Status[], hasExpandedArticle: boolean): boolean {
  if (!chain.length) {
    return false;
  }
  if (hasExpandedArticle) {
    return true;
  }
  if (chain[0].provider === 'rss') {
    return true;
  }
  if (chain.length > 1) {
    return true;
  }
  return chainTextLength(chain) >= DOCUMENT_MIN_CHARS;
}
