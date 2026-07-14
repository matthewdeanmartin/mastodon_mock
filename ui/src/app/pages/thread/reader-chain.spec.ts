import { describe, expect, it } from 'vitest';
import { Status } from '../../models';
import { readerChain } from './reader-chain';

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
