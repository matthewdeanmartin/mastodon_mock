import { describe, expect, it } from 'vitest';
import { parseFeed } from './rss-parser';

const RSS2 = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>My Blog</title>
    <link>https://blog.example.com</link>
    <item>
      <title>First post</title>
      <link>https://blog.example.com/first</link>
      <guid>tag:blog,2026:first</guid>
      <pubDate>Mon, 13 Jul 2026 10:00:00 GMT</pubDate>
      <description>Short summary</description>
      <content:encoded><![CDATA[<p>Full <b>HTML</b> body</p>]]></content:encoded>
      <enclosure url="https://blog.example.com/pic.jpg" type="image/jpeg" length="1"/>
    </item>
    <item>
      <title>No guid, no date</title>
      <link>https://blog.example.com/second</link>
      <description>plain text</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link rel="self" href="https://atom.example.com/feed.xml"/>
  <link rel="alternate" href="https://atom.example.com"/>
  <entry>
    <title>Entry one</title>
    <id>urn:uuid:1</id>
    <link rel="alternate" href="https://atom.example.com/one"/>
    <published>2026-07-12T08:30:00Z</published>
    <content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('parses RSS 2.0 with content:encoded, guid, pubDate and enclosures', () => {
    const feed = parseFeed(RSS2);
    expect(feed.title).toBe('My Blog');
    expect(feed.link).toBe('https://blog.example.com');
    expect(feed.items).toHaveLength(2);

    const first = feed.items[0];
    expect(first.guid).toBe('tag:blog,2026:first');
    expect(first.link).toBe('https://blog.example.com/first');
    expect(first.publishedAt).toBe('2026-07-13T10:00:00.000Z');
    // content:encoded (full body) wins over description.
    expect(first.html).toBe('<p>Full <b>HTML</b> body</p>');
    expect(first.enclosures).toEqual([
      { url: 'https://blog.example.com/pic.jpg', type: 'image/jpeg' },
    ]);
  });

  it('falls back to link for missing guid and null for missing dates', () => {
    const second = parseFeed(RSS2).items[1];
    expect(second.guid).toBe('https://blog.example.com/second');
    expect(second.publishedAt).toBeNull();
    expect(second.html).toBe('plain text');
  });

  it('parses Atom, preferring the rel="alternate" link', () => {
    const feed = parseFeed(ATOM);
    expect(feed.title).toBe('Atom Feed');
    expect(feed.link).toBe('https://atom.example.com');
    const entry = feed.items[0];
    expect(entry.guid).toBe('urn:uuid:1');
    expect(entry.link).toBe('https://atom.example.com/one');
    expect(entry.publishedAt).toBe('2026-07-12T08:30:00Z'.replace('Z', '.000Z'));
    expect(entry.html).toBe('<p>Atom body</p>');
  });

  it('rejects non-XML with a human-readable message', () => {
    expect(() => parseFeed('<!doctype html><html><body>a web page</body></html>')).toThrow(
      /valid XML|Unrecognized/,
    );
  });

  it('rejects XML that is not a feed', () => {
    expect(() => parseFeed('<?xml version="1.0"?><opml></opml>')).toThrow(/Unrecognized feed/);
  });
});
