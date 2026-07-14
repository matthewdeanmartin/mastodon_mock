/** Mastodon's default per-status character limit. */
export const MAX_POST_CHARS = 500;

/**
 * Split `text` into thread-sized chunks of at most `limit` characters, breaking at
 * word boundaries where possible. Chunks after the first are meant to be posted as
 * self-replies. When splitting occurs, every chunk gets an ` (i/n)` marker that is
 * included in the limit.
 *
 * Returns a single-element array (unmarked) when the text already fits.
 */
export function splitPost(text: string, limit: number = MAX_POST_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return [trimmed];
  }

  // The (i/n) suffix consumes part of the limit; its width depends on the final chunk
  // count, which depends on the width. Iterate until the count stabilises.
  let count = 2;
  for (;;) {
    const suffixWidth = ` (${count}/${count})`.length;
    const chunks = chunkAtWords(trimmed, Math.max(1, limit - suffixWidth));
    if (chunks.length <= count) {
      return chunks.map((c, i) => `${c} (${i + 1}/${chunks.length})`);
    }
    count = chunks.length;
  }
}

/** Greedily cut `text` into pieces of at most `size` chars, preferring whitespace cuts. */
function chunkAtWords(text: string, size: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(' ', size);
    // No space in range (one giant word): hard-cut at the limit.
    if (cut <= 0) {
      cut = size;
    }
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}
