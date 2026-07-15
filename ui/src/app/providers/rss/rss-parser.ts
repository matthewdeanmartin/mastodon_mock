// RSS 2.0 / Atom parsing via the browser's DOMParser. No dependencies.

export interface ParsedItem {
  /** Stable id within the feed (guid / atom:id, falling back to link or content hash). */
  guid: string;
  title: string;
  link: string | null;
  /** ISO 8601, or null when the item has no (parseable) date. */
  publishedAt: string | null;
  /** Raw item HTML (content:encoded / description / atom:content) — NOT yet sanitized. */
  html: string;
  /** Enclosure/media URLs with their MIME type when declared. */
  enclosures: { url: string; type: string | null }[];
}

export interface ParsedFeed {
  title: string;
  /** The feed's homepage link, when declared. */
  link: string | null;
  items: ParsedItem[];
}

/** Direct children of `parent` with the given local name (namespace-agnostic). */
function children(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((el) => el.localName === localName);
}

function childText(parent: Element, localName: string): string {
  return children(parent, localName)[0]?.textContent?.trim() ?? '';
}

function toIso(raw: string): string | null {
  if (!raw) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Tiny non-cryptographic hash for guid-less items (djb2). */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Atom `<link>`: prefer rel="alternate" (or no rel), which is the human page. */
function atomLink(parent: Element): string | null {
  const links = children(parent, 'link');
  const alternate = links.find(
    (l) => !l.getAttribute('rel') || l.getAttribute('rel') === 'alternate',
  );
  return (alternate ?? links[0])?.getAttribute('href')?.trim() || null;
}

function parseRssItem(item: Element): ParsedItem {
  const title = childText(item, 'title');
  const link = childText(item, 'link') || null;
  // content:encoded (full HTML) beats description (often a summary).
  const html = childText(item, 'encoded') || childText(item, 'description');
  const enclosures = children(item, 'enclosure')
    .map((e) => ({ url: e.getAttribute('url') ?? '', type: e.getAttribute('type') }))
    .filter((e) => e.url);
  return {
    guid: childText(item, 'guid') || link || hash(title + html),
    title,
    link,
    publishedAt: toIso(childText(item, 'pubDate')) ?? toIso(childText(item, 'date')),
    html,
    enclosures,
  };
}

function parseAtomEntry(entry: Element): ParsedItem {
  const title = childText(entry, 'title');
  const link = atomLink(entry);
  const html = childText(entry, 'content') || childText(entry, 'summary');
  return {
    guid: childText(entry, 'id') || link || hash(title + html),
    title,
    link,
    publishedAt: toIso(childText(entry, 'published')) ?? toIso(childText(entry, 'updated')),
    html,
    enclosures: [],
  };
}

/**
 * Parse an RSS 2.0 or Atom document. Throws with a human-readable message when
 * the text isn't a recognizable feed (shown verbatim in the add-feed form).
 */
export function parseFeed(xml: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Not valid XML — is this really a feed URL?');
  }
  const root = doc.documentElement;

  if (root.localName === 'rss' || root.localName === 'RDF') {
    const channel = children(root, 'channel')[0];
    if (!channel) {
      throw new Error('RSS document has no <channel>.');
    }
    // RSS 1.0 (RDF) keeps items outside <channel>; RSS 2.0 inside. Accept both.
    const items = [...children(channel, 'item'), ...children(root, 'item')];
    return {
      title: childText(channel, 'title') || 'Untitled feed',
      link: childText(channel, 'link') || null,
      items: items.map(parseRssItem),
    };
  }

  if (root.localName === 'feed') {
    return {
      title: childText(root, 'title') || 'Untitled feed',
      link: atomLink(root),
      items: children(root, 'entry').map(parseAtomEntry),
    };
  }

  throw new Error(`Unrecognized feed format (root element <${root.localName}>).`);
}
