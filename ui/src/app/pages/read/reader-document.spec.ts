import { describe, expect, it } from 'vitest';
import { Status } from '../../models';
import { chainTextLength, DOCUMENT_MIN_CHARS, isDocument, readerChain } from './reader-document';

function makeStatus(id: string, accountId: string, inReplyToId: string | null = null): Status {
  return {
    id,
    in_reply_to_id: inReplyToId,
    account: { id: accountId, acct: `user${accountId}` },
    content: `<p>${id}</p>`,
  } as Status;
}

describe('readerChain', () => {
  it('returns empty for an empty thread', () => {
    expect(readerChain([])).toEqual([]);
  });

  it('returns just the root for a single post', () => {
    const root = makeStatus('1', 'a');
    expect(readerChain([root])).toEqual([root]);
  });

  it('follows the author replying to their own previous post', () => {
    const p1 = makeStatus('1', 'a');
    const p2 = makeStatus('2', 'a', '1');
    const p3 = makeStatus('3', 'a', '2');
    expect(readerChain([p1, p2, p3]).map((s) => s.id)).toEqual(['1', '2', '3']);
  });

  it("excludes other people's replies and continues the author chain past them", () => {
    const p1 = makeStatus('1', 'a');
    const other = makeStatus('2', 'b', '1');
    const p3 = makeStatus('3', 'a', '1');
    const p4 = makeStatus('4', 'a', '3');
    expect(readerChain([p1, other, p3, p4]).map((s) => s.id)).toEqual(['1', '3', '4']);
  });

  it("does not include the author's side-replies to other people", () => {
    const p1 = makeStatus('1', 'a');
    const other = makeStatus('2', 'b', '1');
    // The author replies to `other`, not to their own chain: not part of the article.
    const aside = makeStatus('3', 'a', '2');
    expect(readerChain([p1, other, aside]).map((s) => s.id)).toEqual(['1']);
  });

  it('handles storms where every self-reply points at the root', () => {
    const p1 = makeStatus('1', 'a');
    const p2 = makeStatus('2', 'a', '1');
    const p3 = makeStatus('3', 'a', '1');
    const p4 = makeStatus('4', 'a', '1');
    expect(readerChain([p1, p2, p3, p4]).map((s) => s.id)).toEqual(['1', '2', '3', '4']);
  });

  it('stops when a different account continues the thread', () => {
    const p1 = makeStatus('1', 'a');
    const p2 = makeStatus('2', 'a', '1');
    const hijack = makeStatus('3', 'b', '2');
    expect(readerChain([p1, p2, hijack]).map((s) => s.id)).toEqual(['1', '2']);
  });
});

/** `n` characters of prose, wrapped in a paragraph the way a real post is. */
function prose(n: number): string {
  return `<p>${'word '.repeat(Math.ceil(n / 5)).slice(0, n)}</p>`;
}

function contentPost(id: string, content: string, provider?: string): Status {
  return {
    id,
    content,
    provider,
    in_reply_to_id: null,
    account: { id: 'a', username: 'a', acct: 'a', display_name: 'A' },
  } as unknown as Status;
}

describe('what counts as a document', () => {
  it('a short single post is not a document', () => {
    expect(isDocument([contentPost('1', prose(120))], false)).toBe(false);
  });

  it('a long single post is a document', () => {
    expect(isDocument([contentPost('1', prose(DOCUMENT_MIN_CHARS + 50))], false)).toBe(true);
  });

  it('a chain of short posts is a document — a storm is one piece of writing', () => {
    const chain = [
      contentPost('1', prose(80)),
      contentPost('2', prose(80)),
      contentPost('3', prose(80)),
    ];
    expect(chainTextLength(chain)).toBeLessThan(DOCUMENT_MIN_CHARS);
    expect(isDocument(chain, false)).toBe(true);
  });

  it('an RSS item is a document however short its teaser', () => {
    expect(isDocument([contentPost('1', prose(30), 'rss')], false)).toBe(true);
  });

  it('a short post with an expanded article is a document', () => {
    // The post is a sentence and a link; the thing being read is the article.
    expect(isDocument([contentPost('1', prose(60))], true)).toBe(true);
  });

  it('an empty chain is not a document', () => {
    expect(isDocument([], false)).toBe(false);
    expect(isDocument([], true)).toBe(false);
  });

  /**
   * The threshold counts prose, not markup. A post padded out with mention and
   * hashtag anchors is still a short post, and shelving it would fill the
   * library with exactly the ordinary chatter the rule exists to keep out.
   */
  it('markup does not count toward the length', () => {
    const links = '<a href="https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">x</a>'.repeat(12);
    expect(isDocument([contentPost('1', `<p>short${links}</p>`)], false)).toBe(false);
  });
});
