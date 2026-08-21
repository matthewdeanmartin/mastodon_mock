import { describe, expect, it } from 'vitest';
import { Status } from '../../models';
import { articleTarget, outboundLinks } from './article-target';

function status(content: string, extra: Partial<Status> = {}): Status {
  return { content, url: null, provider: undefined, ...extra } as Status;
}

describe('outboundLinks', () => {
  it('finds an ordinary outbound link', () => {
    expect(outboundLinks('<p>see <a href="https://blog.example/post">this</a></p>')).toEqual([
      'https://blog.example/post',
    ]);
  });

  it('ignores mentions and hashtags', () => {
    const html =
      '<p><a href="https://mastodon.social/@someone" class="u-url mention">@someone</a> ' +
      '<a href="https://mastodon.social/tags/rust" class="hashtag">#rust</a></p>';
    expect(outboundLinks(html)).toEqual([]);
  });

  it('ignores links back to social hosts', () => {
    expect(outboundLinks('<a href="https://x.com/someone/status/1">tweet</a>')).toEqual([]);
    expect(outboundLinks('<a href="https://bsky.app/profile/x">post</a>')).toEqual([]);
  });

  it('deduplicates a repeated link', () => {
    const html = '<a href="https://e.com/a">one</a><a href="https://e.com/a">two</a>';
    expect(outboundLinks(html)).toHaveLength(1);
  });

  it('ignores non-http schemes', () => {
    expect(outboundLinks('<a href="javascript:alert(1)">x</a>')).toEqual([]);
    expect(outboundLinks('<a href="mailto:a@b.c">mail</a>')).toEqual([]);
  });
});

describe('articleTarget', () => {
  it('uses an RSS item’s own URL', () => {
    // The item *is* the article; this is the case the feature exists for.
    const post = status('<p>summary</p>', {
      provider: 'rss',
      url: 'https://blog.example/post',
    });
    expect(articleTarget(post)).toBe('https://blog.example/post');
  });

  it('takes the single outbound link from an ordinary post', () => {
    expect(articleTarget(status('<p>read <a href="https://e.com/a">this</a></p>'))).toBe(
      'https://e.com/a',
    );
  });

  it('refuses to guess between several links', () => {
    // Picking the first would silently expand a footnote while the reader
    // watched — and it would spend their quota doing it.
    const html = '<a href="https://e.com/a">a</a> <a href="https://e.com/b">b</a>';
    expect(articleTarget(status(html))).toBeNull();
  });

  it('returns null when there is no link at all', () => {
    expect(articleTarget(status('<p>just words</p>'))).toBeNull();
  });
});
