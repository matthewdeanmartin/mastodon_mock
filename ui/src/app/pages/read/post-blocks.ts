import { Status } from '../../models';

/**
 * Breaking the posts of a document into the units a page is built from.
 *
 * ## Why a post is not the unit
 *
 * The first attempt paginated the chain post by post, which works for a
 * tweetstorm and does nothing at all for the case the reader is named after: a
 * single long tweet. One post is one unit, so it lands on one page, and that
 * page is as tall as the post — which on a 2,000-character post is several
 * screens. Reported by the operator: *"I don't see page splitting for one long
 * tweet."*
 *
 * So the unit is a **block**: a paragraph, a heading, a list, an image. That is
 * the same unit `article-pages.ts` splits markdown into and the same one
 * highlight anchors index, so a document has one idea of what a block is
 * whatever it was made of.
 *
 * ## Why `<br>` runs are split too
 *
 * A post written as one paragraph with line breaks is extremely common — a
 * changelog, a list of links, a numbered thread written by hand. It arrives as
 * a single `<p>` holding a dozen `<br>`-separated lines, which is one block by
 * every structural measure and several screens tall by the only one that
 * matters. The operator's example
 * (`mastodon.social/api/v1/statuses/117136053979504519`) is exactly this: 14
 * paragraphs, two of which carry nine and eight `<br>`s and 1,454 characters.
 *
 * So a paragraph with line breaks is split at them, into one block per line.
 * The lines were already separate things — the author put the breaks there —
 * and a page boundary between two of them is a seam that already existed.
 *
 * ## Why the HTML is re-emitted rather than sliced
 *
 * A post's content is already-sanitised HTML from the server. Splitting it into
 * blocks means handing back several strings instead of one, and each of those
 * has to be safe on its own. They are, because each is the `outerHTML` of an
 * element that was already in the parsed tree — nothing is concatenated,
 * rewritten, or built from text. A block is a subtree of the document the
 * server sent, serialised back out.
 */

/** One renderable piece of a document, and which post it came from. */
export interface PostBlock {
  /** Index of the post in the chain, so media can stay with its post. */
  post: number;
  /** Safe HTML for this block — the `outerHTML` of an element already parsed. */
  html: string;
}

/**
 * Split one post's HTML into top-level blocks.
 *
 * A post whose content has no element children (bare text, which some servers
 * send) comes back as a single block wrapped in a paragraph, so the caller
 * never has to special-case it.
 */
export function splitPostHtml(html: string): string[] {
  if (typeof document === 'undefined') {
    return html.trim() ? [html] : [];
  }
  const holder = document.createElement('div');
  holder.innerHTML = html;

  const blocks: string[] = [];
  let looseText: string[] = [];

  const flushLoose = (): void => {
    const text = looseText.join('').trim();
    looseText = [];
    if (text) {
      blocks.push(`<p>${text}</p>`);
    }
  };

  for (const node of [...holder.childNodes]) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      // An inline element on its own is not a block; it belongs with the text
      // around it, or a sentence in italics would become a page of its own.
      if (isInline(element)) {
        looseText.push(element.outerHTML);
        continue;
      }
      flushLoose();
      blocks.push(...splitOnLineBreaks(element));
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      looseText.push(node.textContent ?? '');
    }
  }
  flushLoose();

  return blocks.length ? blocks : html.trim() ? [html] : [];
}

/**
 * A paragraph of `<br>`-separated lines, as one block per line.
 *
 * Returns the element unchanged when it holds no line breaks, which is the
 * common case and costs one property read. Each returned line is built by
 * cloning the original element and moving the nodes for that line into it, so
 * the wrapper keeps its tag and attributes and every child is a node that was
 * already in the parsed tree — the same safety property as the outer split.
 */
function splitOnLineBreaks(element: Element): string[] {
  if (!element.querySelector('br')) {
    return [element.outerHTML];
  }
  // Only direct children: a `<br>` nested inside a list item is that item's
  // business, and splitting there would tear the list apart.
  if (![...element.children].some((child) => child.tagName === 'BR')) {
    return [element.outerHTML];
  }

  const lines: string[] = [];
  let current: Node[] = [];

  const flush = (): void => {
    if (!current.some((node) => (node.textContent ?? '').trim())) {
      current = [];
      return;
    }
    const wrapper = element.cloneNode(false) as Element;
    for (const node of current) {
      wrapper.appendChild(node.cloneNode(true));
    }
    lines.push(wrapper.outerHTML);
    current = [];
  };

  for (const node of [...element.childNodes]) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      flush();
      continue;
    }
    current.push(node);
  }
  flush();

  return lines.length ? lines : [element.outerHTML];
}

/** Elements that flow with text rather than standing as their own block. */
const INLINE = new Set([
  'A',
  'B',
  'I',
  'EM',
  'STRONG',
  'SPAN',
  'CODE',
  'SMALL',
  'SUB',
  'SUP',
  'ABBR',
  'MARK',
  'S',
  'U',
  'BR',
  'IMG',
  'TIME',
  'Q',
  'CITE',
]);

function isInline(element: Element): boolean {
  return INLINE.has(element.tagName);
}

/** Every block of every post in the chain, in reading order. */
export function chainBlocks(chain: readonly Status[]): PostBlock[] {
  return chain.flatMap((status, post) =>
    splitPostHtml(status.content ?? '').map((html) => ({ post, html })),
  );
}
