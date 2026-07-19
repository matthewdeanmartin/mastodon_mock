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
    title: '🦣 Mastodon Mock',
    text: 'Mock Mastodon server, mock the REST API for testing. MIT',
    url: 'https://github.com/matthewdeanmartin/mastodon_mock/',
    cta: 'Get it on GitHub ↗',
  },
  {
    title: '🪶 MIMB lite',
    text: 'The blog-style Mastodon reader, right in your browser.',
    url: 'https://matthewdeanmartin.github.io/mastodon_is_my_blog/mimb_lite/index.html',
    cta: 'Open MIMB lite ↗',
  },
  {
    title: '📺 YouTuber Finder',
    text: 'Find people that are big on YouTube and Mastodon.',
    url: 'https://matthewdeanmartin.github.io/youtuberfinder/',
    cta: 'Try YouTuber Finder ↗',
  },
];
