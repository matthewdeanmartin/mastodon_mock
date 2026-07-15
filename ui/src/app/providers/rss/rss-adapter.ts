// Adapts parsed RSS/Atom items into Mastodon-shaped Status objects so the rest
// of the app renders them like any other post.

import { Account, MediaAttachment, Status } from '../../models';
import { ParsedFeed, ParsedItem } from './rss-parser';

/** Classic RSS icon as an inline SVG data URI — no external favicon fetches. */
export const RSS_AVATAR =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="7" fill="#f26522"/>' +
      '<circle cx="10" cy="22" r="3" fill="#fff"/>' +
      '<path d="M7 13a12 12 0 0 1 12 12h-4a8 8 0 0 0-8-8z" fill="#fff"/>' +
      '<path d="M7 6a19 19 0 0 1 19 19h-4A15 15 0 0 0 7 10z" fill="#fff"/>' +
      '</svg>',
  );

/**
 * Post content keeps only what Mastodon posts contain; everything else is
 * unwrapped (element dropped, children kept). Feed HTML is arbitrary and
 * untrusted — images are extracted into media_attachments (so the images
 * on/off pref applies) and dangerous subtrees are removed outright.
 */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'a',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'blockquote',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
]);
const DROPPED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'svg',
  'math',
]);

export interface SanitizedContent {
  html: string;
  /** http(s) image URLs pulled out of the markup, in document order. */
  images: string[];
}

function isSafeHttpUrl(url: string | null): url is string {
  return !!url && /^https?:\/\//i.test(url.trim());
}

/** Reduce arbitrary feed HTML to the Mastodon-post tag set; harvest images. */
export function sanitizeFeedHtml(rawHtml: string): SanitizedContent {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const images: string[] = [];

  const walk = (node: Node): void => {
    // Iterate over a copy: unwrapping mutates childNodes.
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const el = child as Element;
      const tag = el.localName;
      if (tag === 'img') {
        const src = el.getAttribute('src');
        if (isSafeHttpUrl(src)) {
          images.push(src.trim());
        }
        el.remove();
      } else if (DROPPED_TAGS.has(tag)) {
        el.remove();
      } else if (ALLOWED_TAGS.has(tag)) {
        stripAttributes(el);
        walk(el);
      } else {
        // Unknown/block element (div, h1, table, figure…): keep its children.
        walk(el);
        el.replaceWith(...Array.from(el.childNodes));
      }
    }
  };

  walk(doc.body);
  return { html: doc.body.innerHTML.trim(), images };
}

function stripAttributes(el: Element): void {
  const keepHref = el.localName === 'a' && isSafeHttpUrl(el.getAttribute('href'));
  const href = keepHref ? el.getAttribute('href')!.trim() : null;
  for (const attr of Array.from(el.attributes)) {
    el.removeAttribute(attr.name);
  }
  if (href) {
    el.setAttribute('href', href);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The synthetic Mastodon-shaped account a feed's items are attributed to. */
export function feedAccount(feedUrl: string, feed: ParsedFeed): Account {
  const host = hostOf(feedUrl);
  return {
    id: `rss:${feedUrl}`,
    username: host,
    acct: host,
    display_name: feed.title,
    note: '',
    url: feed.link ?? feedUrl,
    avatar: RSS_AVATAR,
    avatar_static: RSS_AVATAR,
    header: '',
    followers_count: 0,
    following_count: 0,
    statuses_count: feed.items.length,
    bot: true,
    locked: false,
    fields: [],
  };
}

/** Normalize for the "is the title already the first line of the body?" check. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function itemToStatus(
  item: ParsedItem,
  feedUrl: string,
  account: Account,
  fetchedAt: string,
): Status {
  const { html, images } = sanitizeFeedHtml(item.html);

  // Feed items have titles, posts don't: lead with the title in bold unless the
  // body already starts with it (common in Nitter/microblog feeds).
  let content = html;
  const title = item.title.trim();
  if (title && !squash(html.replace(/<[^>]+>/g, ' ')).startsWith(squash(title).slice(0, 80))) {
    content = `<p><strong>${escapeHtml(title)}</strong></p>${content}`;
  }

  const enclosureImages = item.enclosures
    .filter((e) => (e.type ?? '').startsWith('image/') && isSafeHttpUrl(e.url))
    .map((e) => e.url);
  const media: MediaAttachment[] = [...images, ...enclosureImages]
    .filter((url, i, all) => all.indexOf(url) === i)
    .map((url, i) => ({
      id: `rss-media:${item.guid}:${i}`,
      type: 'image',
      url,
      preview_url: url,
      description: null,
    }));

  return {
    provider: 'rss',
    id: `rss:${feedUrl}::${item.guid}`,
    created_at: item.publishedAt ?? fetchedAt,
    edited_at: null,
    content,
    spoiler_text: '',
    visibility: 'public',
    url: item.link,
    account,
    reblog: null,
    quote: null,
    in_reply_to_id: null,
    replies_count: 0,
    reblogs_count: 0,
    favourites_count: 0,
    favourited: false,
    reblogged: false,
    bookmarked: false,
    muted: false,
    pinned: false,
    sensitive: false,
    poll: null,
    quote_approval_policy: null,
    media_attachments: media,
  };
}

/** Adapt a whole parsed feed, newest first. */
export function feedToStatuses(feedUrl: string, feed: ParsedFeed, fetchedAt: string): Status[] {
  const account = feedAccount(feedUrl, feed);
  return feed.items
    .map((item) => itemToStatus(item, feedUrl, account, fetchedAt))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
