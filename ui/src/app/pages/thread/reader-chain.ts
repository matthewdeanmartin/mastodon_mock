import { Status } from '../../models';

/**
 * Extract the author's own chain from a thread for reader mode: the thread's first
 * post plus every later post where the same author replied to any post already in
 * the chain. This covers both storm styles — replying to your own previous post
 * and replying repeatedly to the root. Posts by other people, and the author's
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
