import { describe, expect, it } from 'vitest';
import { FeedCandidate, rankFeeds } from './feed-ranking';

const feed = (url: string, title = 'Feed'): FeedCandidate => ({ url, title });

describe('rankFeeds', () => {
  it('puts the main feed ahead of the comments feed', () => {
    // The WordPress default, and the case that matters most: all three of these
    // are valid rel=alternate declarations on one page.
    const ranked = rankFeeds([
      feed('https://blog.test/comments/feed/', 'Comments for The Blog'),
      feed('https://blog.test/feed/', 'The Blog'),
    ]);
    expect(ranked[0].url).toBe('https://blog.test/feed/');
  });

  it('demotes a comments feed identified only by its title', () => {
    const ranked = rankFeeds([
      feed('https://blog.test/f2.xml', 'The Blog — Comments'),
      feed('https://blog.test/f1.xml', 'The Blog'),
    ]);
    expect(ranked[0].title).toBe('The Blog');
  });

  it('prefers the whole site over one category', () => {
    const ranked = rankFeeds([
      feed('https://blog.test/category/rust/feed/', 'Rust'),
      feed('https://blog.test/feed/', 'The Blog'),
    ]);
    expect(ranked[0].url).toBe('https://blog.test/feed/');
  });

  it('prefers the shorter path when nothing else discriminates', () => {
    const ranked = rankFeeds([
      feed('https://blog.test/blog/tech/feed/'),
      feed('https://blog.test/feed/'),
    ]);
    expect(ranked[0].url).toBe('https://blog.test/feed/');
  });

  it('prefers a feed titled like the page', () => {
    const ranked = rankFeeds(
      [
        feed('https://blog.test/a/feed.xml', 'Random Other Thing'),
        feed('https://blog.test/b/feed.xml', 'Widget Weekly'),
      ],
      'Widget Weekly — a newsletter',
    );
    expect(ranked[0].title).toBe('Widget Weekly');
  });

  it('does not let the title nudge outweigh a comments demotion', () => {
    // "Comments for X" contains the page title, so rule 4 argues for it. Rule 1
    // must still win — otherwise a well-titled comments feed becomes the pick.
    const ranked = rankFeeds(
      [
        feed('https://blog.test/comments/feed/', 'Comments for Widget Weekly'),
        feed('https://blog.test/feed/', 'Widget Weekly'),
      ],
      'Widget Weekly',
    );
    expect(ranked[0].url).toBe('https://blog.test/feed/');
  });

  it('is deterministic on a tie', () => {
    const candidates = [
      feed('https://blog.test/b.xml'),
      feed('https://blog.test/a.xml'),
      feed('https://blog.test/c.xml'),
    ];
    const once = rankFeeds(candidates).map((f) => f.url);
    // Same input, same order — including from a different starting permutation.
    expect(rankFeeds([...candidates].reverse()).map((f) => f.url)).toEqual(once);
  });

  it('does not mutate its input', () => {
    const candidates = [feed('https://blog.test/z.xml'), feed('https://blog.test/a.xml')];
    const before = candidates.map((f) => f.url);
    rankFeeds(candidates);
    expect(candidates.map((f) => f.url)).toEqual(before);
  });

  it('handles the ordinary single-candidate and empty cases', () => {
    expect(rankFeeds([])).toEqual([]);
    expect(rankFeeds([feed('https://blog.test/feed/')])).toHaveLength(1);
  });

  it('sorts an unparseable url last instead of throwing', () => {
    const ranked = rankFeeds([feed('not a url'), feed('https://blog.test/feed/')]);
    expect(ranked[0].url).toBe('https://blog.test/feed/');
  });
});
