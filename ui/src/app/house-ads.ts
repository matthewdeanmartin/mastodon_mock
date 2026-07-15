/**
 * House ads shown in the right rail (all of them, stacked, top of the rail).
 *
 * This file IS the ad inventory — to add, remove or reword an ad, edit the
 * array below and rebuild. No other code changes needed.
 */
export interface HouseAd {
  /** Headline, shown bold. Lead with an emoji if you want one. */
  title: string;
  /** One or two short sentences of body copy. */
  text: string;
  /** Where clicking the ad goes (opened in a new tab). */
  url: string;
  /** Call-to-action line, e.g. "Get it on GitHub ↗". */
  cta: string;
}

export const HOUSE_ADS: HouseAd[] = [
  {
    title: '📝 MIMB — Mastodon Is My Blog',
    text: 'An advanced desktop Mastodon client with more of a blog interface.',
    url: 'https://github.com/matthewdeanmartin/mastodon_is_my_blog/',
    cta: 'Get it on GitHub ↗',
  },
  {
    title: '🪶 MIMB lite',
    text: 'The blog-style Mastodon reader, right in your browser. No install, no build.',
    url: 'https://matthewdeanmartin.github.io/mastodon_is_my_blog/mimb_lite/index.html',
    cta: 'Open MIMB lite ↗',
  },
  {
    title: '📺 YouTuber Finder',
    text: 'Find the YouTube channels behind the people you follow.',
    url: 'https://matthewdeanmartin.github.io/youtuberfinder/',
    cta: 'Try YouTuber Finder ↗',
  },
];
