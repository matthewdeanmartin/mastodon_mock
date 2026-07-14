import { Status } from '../../models';

/**
 * Extract the author's own chain from a thread for reader mode: starting at the
 * thread's first post, follow replies that the same author made to their own
 * previous post (the classic 1/n thread shape). Posts by other people, and the
 * author's side-replies to them, are not part of the article.
 */
export function readerChain(thread: Status[]): Status[] {
  if (!thread.length) {
    return [];
  }
  const root = thread[0];
  const chain = [root];
  const authorId = root.account.id;
  const remaining = thread.slice(1);
  let tailId = root.id;
  for (;;) {
    const next = remaining.find((s) => s.account.id === authorId && s.in_reply_to_id === tailId);
    if (!next) {
      return chain;
    }
    chain.push(next);
    tailId = next.id;
  }
}
