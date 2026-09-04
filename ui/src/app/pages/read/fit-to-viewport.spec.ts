import { describe, expect, it } from 'vitest';
import { fitToPages, MeasuredBlock, pageOfMeasuredBlock } from './fit-to-viewport';

/** `n` blocks of the given height, numbered from 0. */
const blocks = (heights: number[]): MeasuredBlock[] =>
  heights.map((height, index) => ({ index, height }));

describe('fitting blocks to a page', () => {
  /**
   * The whole point of measuring: a page is what fits on the screen, so page
   * mode does not still make the reader scroll.
   */
  it('fills a page and starts a new one when the next block would overflow', () => {
    const pages = fitToPages(blocks([300, 300, 300, 300]), 700);

    expect(pages.map((page) => page.blocks)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('puts everything on one page when it all fits', () => {
    expect(fitToPages(blocks([100, 100, 100]), 700)).toEqual([{ blocks: [0, 1, 2] }]);
  });

  /**
   * A paragraph split across a page turn loses your place at the seam and gains
   * nothing. A slightly short page is the better trade.
   */
  it('never splits inside a block', () => {
    const pages = fitToPages(blocks([400, 400]), 700);
    expect(pages).toEqual([{ blocks: [0] }, { blocks: [1] }]);
  });

  /**
   * A long code listing or a tall image is taller than the page. Refusing to
   * show it is not an option, so it gets a page and is allowed to overflow.
   */
  it('gives an oversized block its own page rather than dropping it', () => {
    const pages = fitToPages(blocks([100, 2000, 100]), 700);

    // Nothing else is added to the already-overflowing block. Upstream block
    // splitting is responsible for making prose blocks small enough to fit.
    expect(pages.map((page) => page.blocks)).toEqual([[0], [1], [2]]);
  });

  it('never combines blocks when their measured height exceeds the viewport', () => {
    const pages = fitToPages(blocks([300, 500]), 700);
    expect(pages).toEqual([{ blocks: [0] }, { blocks: [1] }]);

    expect(fitToPages(blocks([500, 500]), 700).map((page) => page.blocks)).toEqual([[0], [1]]);
  });

  /**
   * A height we could not measure. One scrolling page is honest; a pagination
   * invented from a guess would land every page turn somewhere arbitrary.
   */
  it('returns a single page when the viewport could not be measured', () => {
    for (const height of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fitToPages(blocks([100, 100]), height)).toEqual([{ blocks: [0, 1] }]);
    }
  });

  it('always returns at least one page', () => {
    expect(fitToPages([], 700)).toEqual([{ blocks: [] }]);
  });
});

describe('finding the page a block landed on', () => {
  const pages = [{ blocks: [0, 1] }, { blocks: [2, 3] }];

  it('reports the 1-based page', () => {
    expect(pageOfMeasuredBlock(pages, 0)).toBe(1);
    expect(pageOfMeasuredBlock(pages, 3)).toBe(2);
  });

  it('falls back to the first page for a block that is not there', () => {
    expect(pageOfMeasuredBlock(pages, 99)).toBe(1);
  });
});
