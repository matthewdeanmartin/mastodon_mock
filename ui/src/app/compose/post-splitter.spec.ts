import { describe, expect, it } from 'vitest';
import { MAX_POST_CHARS, splitPost } from './post-splitter';

describe('splitPost', () => {
  it('returns short text unchanged and unmarked', () => {
    expect(splitPost('hello world')).toEqual(['hello world']);
  });

  it('trims surrounding whitespace', () => {
    expect(splitPost('  hi  ')).toEqual(['hi']);
  });

  it('returns exactly-at-limit text as a single chunk', () => {
    const text = 'a'.repeat(MAX_POST_CHARS);
    expect(splitPost(text)).toEqual([text]);
  });

  it('splits over-limit text into (i/n)-marked chunks that all fit', () => {
    const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    expect(text.length).toBeGreaterThan(MAX_POST_CHARS);

    const chunks = splitPost(text);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.length).toBeLessThanOrEqual(MAX_POST_CHARS);
      expect(chunk).toMatch(new RegExp(`\\(${i + 1}/${chunks.length}\\)$`));
    });
  });

  it('reassembles to the original words (markers aside)', () => {
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`);
    const chunks = splitPost(words.join(' '));
    const recovered = chunks
      .map((c) => c.replace(/ \(\d+\/\d+\)$/, ''))
      .join(' ')
      .split(/\s+/);
    expect(recovered).toEqual(words);
  });

  it('prefers word boundaries (no mid-word cuts for normal prose)', () => {
    const text = 'lorem ipsum '.repeat(100);
    for (const chunk of splitPost(text)) {
      const body = chunk.replace(/ \(\d+\/\d+\)$/, '');
      for (const word of body.split(' ')) {
        expect(['lorem', 'ipsum']).toContain(word);
      }
    }
  });

  it('hard-cuts a single word longer than the limit', () => {
    const text = 'a'.repeat(1200);
    const chunks = splitPost(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_POST_CHARS);
    }
    // Nothing lost.
    const total = chunks.map((c) => c.replace(/ \(\d+\/\d+\)$/, '')).join('');
    expect(total).toBe(text);
  });

  it('respects a custom limit', () => {
    const chunks = splitPost('one two three four five six seven eight nine ten', 20);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
    expect(chunks.length).toBeGreaterThan(2);
  });
});
