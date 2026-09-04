/**
 * Deciding how much text is one page, by measuring rather than by counting.
 *
 * ## Why word counts do not work
 *
 * `article-pages.ts` slices at ~500 words and says in its own comment that this
 * is "about a screenful and a half". That is honest and it is the bug: in
 * page-flip mode the reader still has to scroll, so the page turn buys nothing
 * and the mode is indistinguishable from scrolling. A page is not a quantity of
 * words. It is *what fits*, and what fits depends on the type size, the line
 * height, the measure, the paper, and the height of the window — every one of
 * which the reader can change.
 *
 * So this measures. Given the height available and the rendered height of each
 * block, it fills a page until the next block would overflow, then starts a new
 * one. The arithmetic is trivial; the value is entirely in doing it against
 * real layout instead of a guess.
 *
 * ## What it deliberately does not do
 *
 * It does not break *inside* a block. A paragraph split across a page turn is
 * the worst of both worlds — you lose your place at the seam and gain nothing —
 * and a page that is a little short is much better than a sentence cut in half.
 * A single block taller than the page (a long code listing, a tall image) gets a
 * page of its own and is allowed to overflow it, because the alternative is
 * refusing to show it at all.
 */

/** A block and how tall it renders, in document order. */
export interface MeasuredBlock {
  /** Index into the document's block list. */
  index: number;
  /** Rendered height in pixels, including its own margins. */
  height: number;
}

/** One page as a run of block indices. */
export interface FittedPage {
  /** Indices of the blocks on this page, in order. */
  blocks: number[];
}

/**
 * How short a page is allowed to get before we stop respecting the limit.
 *
 * Without this a run of tall blocks produces a string of nearly-empty pages: a
 * block that is 60% of the page height would sit alone on each one, and the
 * reader would turn four pages to read what looks like two screens of text. At
 * that point overflowing slightly is the better trade, so a page always takes
 * at least one block and only *then* starts checking whether the next one fits.
 */
export const MIN_FILL = 0.55;

/**
 * Group measured blocks into pages that fit `available` pixels.
 *
 * Always returns at least one page so callers never special-case empty input.
 */
export function fitToPages(blocks: readonly MeasuredBlock[], available: number): FittedPage[] {
  if (!blocks.length) {
    return [{ blocks: [] }];
  }
  // A viewport we could not measure. One page is the honest answer: better to
  // hand back a single scrolling page than to invent a pagination from a
  // guessed height and have every page turn land somewhere arbitrary.
  if (!Number.isFinite(available) || available <= 0) {
    return [{ blocks: blocks.map((block) => block.index) }];
  }

  const pages: FittedPage[] = [];
  let current: number[] = [];
  let used = 0;

  for (const block of blocks) {
    // The first block on a page always goes on it, however tall — see the note
    // about a block taller than the page.
    if (!current.length) {
      current.push(block.index);
      used = block.height;
      continue;
    }
    if (used + block.height <= available) {
      current.push(block.index);
      used += block.height;
      continue;
    }
    // It does not fit. Take it anyway when the page is still mostly empty,
    // rather than leaving a page that is barely used.
    if (used < available * MIN_FILL) {
      current.push(block.index);
      used += block.height;
      continue;
    }
    pages.push({ blocks: current });
    current = [block.index];
    used = block.height;
  }

  if (current.length) {
    pages.push({ blocks: current });
  }
  return pages.length ? pages : [{ blocks: blocks.map((block) => block.index) }];
}

/**
 * Which page a block index landed on, 1-based.
 *
 * The same lookup `pageOfBlock` does for word-count pages, against measured
 * ones. Returns 1 for a block that is not on any page, which can only happen
 * for an anchor whose quote check has already failed.
 */
export function pageOfMeasuredBlock(pages: readonly FittedPage[], blockIndex: number): number {
  const found = pages.findIndex((page) => page.blocks.includes(blockIndex));
  return found === -1 ? 1 : found + 1;
}
