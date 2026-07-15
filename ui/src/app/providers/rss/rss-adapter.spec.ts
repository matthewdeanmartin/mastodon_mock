import { describe, expect, it } from 'vitest';
import { feedToStatuses, itemToStatus, feedAccount, sanitizeFeedHtml } from './rss-adapter';
import { ParsedFeed, ParsedItem } from './rss-parser';

const FETCHED_AT = '2026-07-14T12:00:00.000Z';

function makeItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    guid: 'g1',
    title: 'A post title',
    link: 'https://blog.example.com/post',
    publishedAt: '2026-07-13T10:00:00.000Z',
    html: '<p>Body text</p>',
    enclosures: [],
    ...overrides,
  };
}

function makeFeed(items: ParsedItem[]): ParsedFeed {
  return { title: 'My Blog', link: 'https://blog.example.com', items };
}

describe('sanitizeFeedHtml', () => {
  it('drops scripts outright and unwraps unknown block elements', () => {
    const { html } = sanitizeFeedHtml(
      '<div class="wrap"><script>alert(1)</script><p onclick="x()">keep <em>me</em></p></div>',
    );
    expect(html).toBe('<p>keep <em>me</em></p>');
  });

  it('extracts images into the images list and out of the markup', () => {
    const { html, images } = sanitizeFeedHtml(
      '<p>text <img src="https://x.example/a.png"> more</p><img src="javascript:evil()">',
    );
    expect(images).toEqual(['https://x.example/a.png']);
    expect(html).not.toContain('<img');
    expect(html).toContain('text');
  });

  it('keeps only http(s) hrefs on links and strips every other attribute', () => {
    const { html } = sanitizeFeedHtml(
      '<a href="https://ok.example" target="_top" onmouseover="x()">ok</a>' +
        '<a href="javascript:evil()">bad</a>',
    );
    expect(html).toBe('<a href="https://ok.example">ok</a><a>bad</a>');
  });
});

describe('itemToStatus', () => {
  const account = feedAccount('https://blog.example.com/feed.xml', makeFeed([]));

  it('produces a Mastodon-shaped, rss-tagged, namespaced status', () => {
    const status = itemToStatus(
      makeItem(),
      'https://blog.example.com/feed.xml',
      account,
      FETCHED_AT,
    );
    expect(status.provider).toBe('rss');
    expect(status.id).toBe('rss:https://blog.example.com/feed.xml::g1');
    expect(status.created_at).toBe('2026-07-13T10:00:00.000Z');
    expect(status.url).toBe('https://blog.example.com/post');
    expect(status.visibility).toBe('public');
    expect(status.account.display_name).toBe('My Blog');
    expect(status.account.acct).toBe('blog.example.com');
  });

  it('leads with the bold title when the body does not start with it', () => {
    const status = itemToStatus(
      makeItem(),
      'https://blog.example.com/feed.xml',
      account,
      FETCHED_AT,
    );
    expect(status.content).toBe('<p><strong>A post title</strong></p><p>Body text</p>');
  });

  it('skips the title when the body already starts with it (microblog feeds)', () => {
    const status = itemToStatus(
      makeItem({ title: 'Body text', html: '<p>Body text and more</p>' }),
      'https://blog.example.com/feed.xml',
      account,
      FETCHED_AT,
    );
    expect(status.content).toBe('<p>Body text and more</p>');
  });

  it('turns inline and enclosure images into media attachments, deduped', () => {
    const status = itemToStatus(
      makeItem({
        html: '<p>pic: <img src="https://x.example/a.png"></p>',
        enclosures: [
          { url: 'https://x.example/a.png', type: 'image/png' },
          { url: 'https://x.example/b.jpg', type: 'image/jpeg' },
          { url: 'https://x.example/audio.mp3', type: 'audio/mpeg' },
        ],
      }),
      'https://blog.example.com/feed.xml',
      account,
      FETCHED_AT,
    );
    expect(status.media_attachments.map((m) => m.url)).toEqual([
      'https://x.example/a.png',
      'https://x.example/b.jpg',
    ]);
    expect(status.media_attachments[0].type).toBe('image');
  });

  it('falls back to fetch time for undated items', () => {
    const status = itemToStatus(
      makeItem({ publishedAt: null }),
      'https://blog.example.com/feed.xml',
      account,
      FETCHED_AT,
    );
    expect(status.created_at).toBe(FETCHED_AT);
  });
});

describe('feedToStatuses', () => {
  it('adapts every item, newest first', () => {
    const feed = makeFeed([
      makeItem({ guid: 'old', publishedAt: '2026-07-01T00:00:00.000Z' }),
      makeItem({ guid: 'new', publishedAt: '2026-07-13T00:00:00.000Z' }),
    ]);
    const statuses = feedToStatuses('https://blog.example.com/feed.xml', feed, FETCHED_AT);
    expect(statuses.map((s) => s.id)).toEqual([
      'rss:https://blog.example.com/feed.xml::new',
      'rss:https://blog.example.com/feed.xml::old',
    ]);
  });
});
